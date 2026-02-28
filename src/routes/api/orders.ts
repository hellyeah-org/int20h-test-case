// src/routes/orders.ts
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parse as parseCsv } from 'csv-parse/sync'
import { and, eq, inArray, isNull, lte, gt, or, sql } from 'drizzle-orm'

import { db } from '#/db/index'
import { jurisdictions, taxRates, orders, taxLines } from '#/db/schema/tax'

/**
 * POST /orders
 *
 * Input per order:
 * - latitude, longitude
 * - subtotal (pre-tax)
 * - timestamp
 *
 * Output per order:
 * - composite_tax_rate
 * - tax_amount
 * - total_amount
 * - breakdown: state/county/city + special_rates
 *
 * Side effect:
 * - inserts into orders + tax_lines
 */

const OrderInputSchema = z.object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    subtotal: z.coerce.number().min(0),
    timestamp: z.coerce.date(),
})

const OrdersJsonSchema = z.union([
    z.array(OrderInputSchema),
    z.object({ orders: z.array(OrderInputSchema) }),
])

type OrderInput = z.infer<typeof OrderInputSchema>

type Breakdown = {
    state_rate: number
    county_rate: number
    city_rate: number
    special_rates: Array<{ jurisdiction_id: string; name: string; rate: number }>
}

type OrderOutput = {
    order_id: string
    composite_tax_rate: number
    tax_amount: number
    total_amount: number
    breakdown: Breakdown
}

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

// ---------- helpers: money in cents ----------
const toCents = (x: number) => Math.round(x * 100)
const moneyStr = (cents: number) => (cents / 100).toFixed(2) // for DB numeric(12,2)
const moneyNum = (cents: number) => Number((cents / 100).toFixed(2)) // for response
const rateNum = (r: number) => Number(r.toFixed(6)) // numeric(10,6)
const rateStr = (r: number) => r.toFixed(6)

// YYYY-MM-DD in America/New_York (order_date)
function orderDateNY(ts: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(ts)

    const y = parts.find((p) => p.type === 'year')?.value
    const m = parts.find((p) => p.type === 'month')?.value
    const d = parts.find((p) => p.type === 'day')?.value
    if (!y || !m || !d) throw new Error('failed_to_format_date')
    return `${y}-${m}-${d}`
}

async function parseOrdersFromRequest(request: Request): Promise<OrderInput[]> {
    const ct = request.headers.get('content-type') ?? ''

    // CSV
    if (ct.includes('text/csv') || ct.includes('application/csv')) {
        const text = await request.text()
        const records = parseCsv(text, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
        }) as Array<Record<string, string>>

        const mapped = records.map((r) => ({
            latitude: r.latitude,
            longitude: r.longitude,
            subtotal: r.subtotal,
            timestamp: r.timestamp,
        }))

        return z.array(OrderInputSchema).parse(mapped)
    }

    // JSON
    const body = await request.json().catch(() => null)
    const parsed = OrdersJsonSchema.safeParse(body)
    if (!parsed.success) throw parsed.error
    return Array.isArray(parsed.data) ? parsed.data : parsed.data.orders
}

type JurRow = {
    id: string
    name: string
    kind: 'ADMINISTRATIVE' | 'SPECIAL'
    level: number | null
}

function splitAdmin(jurs: JurRow[]) {
    const state = jurs.find((j) => j.kind === 'ADMINISTRATIVE' && j.level === 10) ?? null
    const county = jurs.find((j) => j.kind === 'ADMINISTRATIVE' && j.level === 20) ?? null
    const city = jurs.find((j) => j.kind === 'ADMINISTRATIVE' && j.level === 30) ?? null
    return { state, county, city }
}

/**
 * Allocate tax cents per line so that:
 * sum(line.amount) == total tax amount (after rounding)
 */
function allocateTaxCents(
    subtotalCents: number,
    lines: Array<{ jurId: string; rate: number }>,
) {
    const totalRate = lines.reduce((a, x) => a + x.rate, 0)
    const totalTax = Math.round(subtotalCents * totalRate)

    const perLine = lines.map((x) => ({
        jurId: x.jurId,
        rate: x.rate,
        cents: Math.round(subtotalCents * x.rate),
    }))

    const sumLines = perLine.reduce((a, x) => a + x.cents, 0)
    const diff = totalTax - sumLines

    if (diff !== 0 && perLine.length > 0) {
        // add diff to the last non-zero line (or last line)
        let idx = perLine.length - 1
        for (let i = perLine.length - 1; i >= 0; i--) {
            if (perLine[i].rate > 0) {
                idx = i
                break
            }
        }
        perLine[idx].cents += diff
    }

    return { totalRate, totalTax, perLine }
}

async function calculateAndStoreOne(input: OrderInput): Promise<OrderOutput> {
    const date = orderDateNY(input.timestamp) // YYYY-MM-DD

    const point = sql`ST_SetSRID(ST_Point(${input.longitude}, ${input.latitude}), 4326)`

    // 1) find ADMIN jurisdictions (state/county/city) by point
    const admin = (await db
        .select({
            id: jurisdictions.id,
            name: jurisdictions.name,
            kind: jurisdictions.kind,
            level: jurisdictions.level,
        })
        .from(jurisdictions)
        .where(
            and(
                eq(jurisdictions.kind, 'ADMINISTRATIVE'),
                // covers includes boundary edges (usually better for delivery points)
                sql<boolean>`ST_Covers(${jurisdictions.boundary}, ${point})`,
            ),
        )) as JurRow[]

    // 2) find SPECIAL jurisdictions by point
    const specials = (await db
        .select({
            id: jurisdictions.id,
            name: jurisdictions.name,
            kind: jurisdictions.kind,
            level: jurisdictions.level,
        })
        .from(jurisdictions)
        .where(
            and(
                eq(jurisdictions.kind, 'SPECIAL'),
                sql<boolean>`ST_Covers(${jurisdictions.boundary}, ${point})`,
            ),
        )) as JurRow[]

    const { state, county, city } = splitAdmin(admin)
    if (!state) throw new Error('state_not_found_for_point')

    const allJurs = [state, county, city, ...specials].filter(Boolean) as JurRow[]
    const jurIds = allJurs.map((j) => j.id)

    // 3) fetch effective tax rates for these jurisdictions as-of order date
    const rateRows = await db
        .select({
            id: taxRates.id,
            jurisdictionId: taxRates.jurisdictionId,
            rate: taxRates.rate,
        })
        .from(taxRates)
        .where(
            and(
                inArray(taxRates.jurisdictionId, jurIds),
                lte(taxRates.effectiveFrom, date),
                or(isNull(taxRates.effectiveTo), gt(taxRates.effectiveTo, date)),
            ),
        )

    // group by jurisdictionId (usually 1 row because you have overlap exclusion)
    const rateByJur = new Map<string, { taxRateId: string; rateSum: number }>()
    for (const r of rateRows) {
        const jurId = String(r.jurisdictionId)
        const prev = rateByJur.get(jurId)
        const rate = Number(r.rate) // numeric can be string
        if (!prev) rateByJur.set(jurId, { taxRateId: String(r.id), rateSum: rate })
        else rateByJur.set(jurId, { taxRateId: prev.taxRateId, rateSum: prev.rateSum + rate })
    }

    const getRate = (j: JurRow | null) => (j ? rateByJur.get(j.id)?.rateSum ?? 0 : 0)
    const getTaxRateId = (j: JurRow | null) => (j ? rateByJur.get(j.id)?.taxRateId ?? null : null)

    const stateRate = getRate(state)
    const countyRate = getRate(county)
    const cityRate = getRate(city)

    const specialRates = specials
        .map((s) => ({ jurisdiction_id: s.id, name: s.name, rate: getRate(s) }))
        .filter((x) => x.rate > 0)

    // 4) compute totals (cents)
    const subtotalCents = toCents(input.subtotal)

    const linesToAllocate: Array<{ jurId: string; rate: number }> = []
    if (stateRate > 0) linesToAllocate.push({ jurId: state.id, rate: stateRate })
    if (county && countyRate > 0) linesToAllocate.push({ jurId: county.id, rate: countyRate })
    if (city && cityRate > 0) linesToAllocate.push({ jurId: city.id, rate: cityRate })
    for (const s of specials) {
        const r = getRate(s)
        if (r > 0) linesToAllocate.push({ jurId: s.id, rate: r })
    }

    const { totalRate, totalTax, perLine } = allocateTaxCents(subtotalCents, linesToAllocate)

    const taxAmountCents = totalTax
    const totalAmountCents = subtotalCents + taxAmountCents

    // 5) persist
    const inserted = await db.transaction(async (tx) => {
        const [o] = await tx
            .insert(orders)
            .values({
                latitude: input.latitude.toFixed(6),
                longitude: input.longitude.toFixed(6),
                orderDate: date,
                subtotalAmount: moneyStr(subtotalCents),
                compositeTaxRate: rateStr(totalRate),
                taxAmount: moneyStr(taxAmountCents),
                totalAmount: moneyStr(totalAmountCents),
            })
            .returning({ id: orders.id })

        const jurById = new Map(allJurs.map((j) => [j.id, j]))

        const taxLineRows = perLine.map((l) => {
            const jur = jurById.get(l.jurId)
            if (!jur) throw new Error('internal_missing_jurisdiction')

            return {
                orderId: o.id,
                taxRateId: getTaxRateId(jur),
                jurisdictionId: jur.id,
                rate: rateStr(l.rate),
                amount: moneyStr(l.cents),
                jurisdictionName: jur.name,
                jurisdictionKind: jur.kind,
                jurisdictionLevel: jur.level,
            }
        })

        if (taxLineRows.length > 0) {
            await tx.insert(taxLines).values(taxLineRows)
        }

        return o
    })

    return {
        order_id: inserted.id,
        composite_tax_rate: rateNum(totalRate),
        tax_amount: moneyNum(taxAmountCents),
        total_amount: moneyNum(totalAmountCents),
        breakdown: {
            state_rate: rateNum(stateRate),
            county_rate: rateNum(countyRate),
            city_rate: rateNum(cityRate),
            special_rates: specialRates.map((x) => ({ ...x, rate: rateNum(x.rate) })),
        },
    }
}

export const Route = createFileRoute('/api/orders')({
    server: {
        handlers: {
            POST: async ({ request }) => {
                try {
                    const inputs = await parseOrdersFromRequest(request)

                    const results: OrderOutput[] = []
                    for (const input of inputs) {
                        results.push(await calculateAndStoreOne(input))
                    }

                    return json({ orders: results })
                } catch (err) {
                    if (err instanceof z.ZodError) {
                        return json({ error: 'invalid_input', issues: err.issues }, 400)
                    }
                    const msg = err instanceof Error ? err.message : 'internal_error'
                    return json({ error: msg }, msg === 'state_not_found_for_point' ? 422 : 500)
                }
            },
        },
    },
    component: () => null,
})