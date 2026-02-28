// src/routes/api/orders.ts
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parse as parseCsv } from 'csv-parse/sync'
import {
    and,
    asc,
    desc,
    eq,
    gte,
    gt,
    inArray,
    isNull,
    lte,
    or,
    sql,
} from 'drizzle-orm'

import { db } from '#/db/index'
import { jurisdictions, taxRates, orders, taxLines } from '#/db/schema/tax'

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    })
}

// -----------------------------
// POST /api/orders schemas
// -----------------------------
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

// -----------------------------
// GET /api/orders schemas (pagination + filters)
// -----------------------------
const BoolQuery = z.preprocess((v) => {
    if (v === undefined || v === null) return undefined
    const s = String(v).toLowerCase().trim()
    if (s === '1' || s === 'true' || s === 'yes') return true
    if (s === '0' || s === 'false' || s === 'no') return false
    return v
}, z.boolean().optional())

const OrdersListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),

    sort: z
        .enum([
            'createdAtDesc',
            'createdAtAsc',
            'orderDateDesc',
            'orderDateAsc',
            'totalDesc',
            'totalAsc',
        ])
        .default('createdAtDesc'),

    // required filters:
    dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sumFrom: z.coerce.number().min(0).optional(),
    sumTo: z.coerce.number().min(0).optional(),

    // optional extras:
    includeLines: BoolQuery,
    hasSpecial: BoolQuery,
    minRate: z.coerce.number().min(0).max(1).optional(),
    maxRate: z.coerce.number().min(0).max(1).optional(),
    jurisdictionName: z.string().min(1).optional(),
    jurisdictionKind: z.enum(['ADMINISTRATIVE', 'SPECIAL']).optional(),
    jurisdictionLevel: z
        .coerce
        .number()
        .int()
        .refine((v) => [10, 20, 30].includes(v))
        .optional(),
})

function parseListQuery(request: Request) {
    const url = new URL(request.url)
    const obj: Record<string, string> = {}
    for (const [k, v] of url.searchParams.entries()) {
        if (!(k in obj)) obj[k] = v
    }
    return OrdersListQuerySchema.parse(obj)
}

// -----------------------------
// Money helpers
// -----------------------------
const toCents = (x: number) => Math.round(x * 100)
const moneyStr = (cents: number) => (cents / 100).toFixed(2)
const moneyNum = (cents: number) => Number((cents / 100).toFixed(2))
const rateNum = (r: number) => Number(r.toFixed(6))
const rateStr = (r: number) => r.toFixed(6)

// YYYY-MM-DD in America/New_York
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

// -----------------------------
// POST parsing (JSON or CSV)
// -----------------------------
async function parseOrdersFromRequest(request: Request): Promise<OrderInput[]> {
    const ct = request.headers.get('content-type') ?? ''

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

function allocateTaxCents(subtotalCents: number, lines: Array<{ jurId: string; rate: number }>) {
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
    const date = orderDateNY(input.timestamp)
    const point = sql`ST_SetSRID(ST_Point(${input.longitude}, ${input.latitude}), 4326)`

    // ADMIN
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
                sql<boolean>`ST_Intersects(${jurisdictions.boundary}, ${point})`,
            ),
        )) as JurRow[]

    // SPECIAL
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
                sql<boolean>`ST_Intersects(${jurisdictions.boundary}, ${point})`,
            ),
        )) as JurRow[]

    const { state, county, city } = splitAdmin(admin)
    if (!state) throw new Error('state_not_found_for_point')

    const allJurs = [state, county, city, ...specials].filter(Boolean) as JurRow[]
    const jurIds = allJurs.map((j) => j.id)

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

    const rateByJur = new Map<string, { taxRateId: string; rateSum: number }>()
    for (const r of rateRows) {
        const jurId = String(r.jurisdictionId)
        const prev = rateByJur.get(jurId)
        const rate = Number(r.rate)
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

// -----------------------------
// GET listOrders
// -----------------------------
async function listOrders(request: Request): Promise<Response> {
    const q = parseListQuery(request)
    const offset = (q.page - 1) * q.pageSize
    const limit = q.pageSize

    const whereParts: any[] = []

    if (q.dateFrom) whereParts.push(gte(orders.orderDate, q.dateFrom))
    if (q.dateTo) whereParts.push(lte(orders.orderDate, q.dateTo))

    // "sum" => total_amount
    if (q.sumFrom !== undefined) whereParts.push(gte(orders.totalAmount, String(q.sumFrom)))
    if (q.sumTo !== undefined) whereParts.push(lte(orders.totalAmount, String(q.sumTo)))

    if (q.minRate !== undefined) whereParts.push(gte(orders.compositeTaxRate, String(q.minRate)))
    if (q.maxRate !== undefined) whereParts.push(lte(orders.compositeTaxRate, String(q.maxRate)))

    if (q.hasSpecial !== undefined) {
        whereParts.push(
            q.hasSpecial
                ? sql<boolean>`
                        EXISTS (
              SELECT 1
              FROM tax_lines tl
              WHERE tl.order_id = ${orders.id}
                        AND tl.jurisdiction_kind = 'SPECIAL'
                        AND tl.amount > 0
                        )
                `
                : sql<boolean>`
                        NOT EXISTS (
              SELECT 1
              FROM tax_lines tl
              WHERE tl.order_id = ${orders.id}
                        AND tl.jurisdiction_kind = 'SPECIAL'
                        AND tl.amount > 0
                        )
                `,
        )
    }

    if (q.jurisdictionName) {
        const pattern = `%${q.jurisdictionName}%`
        whereParts.push(sql<boolean>`
            EXISTS (
        SELECT 1
        FROM tax_lines tl
        WHERE tl.order_id = ${orders.id}
            AND tl.jurisdiction_name ILIKE ${pattern}
            )
        `)
    }

    if (q.jurisdictionKind) {
        whereParts.push(sql<boolean>`
            EXISTS (
        SELECT 1
        FROM tax_lines tl
        WHERE tl.order_id = ${orders.id}
            AND tl.jurisdiction_kind = ${q.jurisdictionKind}
            )
        `)
    }

    if (q.jurisdictionLevel !== undefined) {
        whereParts.push(sql<boolean>`
            EXISTS (
        SELECT 1
        FROM tax_lines tl
        WHERE tl.order_id = ${orders.id}
            AND tl.jurisdiction_level = ${q.jurisdictionLevel}
            )
        `)
    }

    const whereCond = whereParts.length ? and(...whereParts) : undefined

    const orderBy =
        q.sort === 'createdAtAsc'
            ? asc(orders.createdAt)
            : q.sort === 'createdAtDesc'
                ? desc(orders.createdAt)
                : q.sort === 'orderDateAsc'
                    ? asc(orders.orderDate)
                    : q.sort === 'orderDateDesc'
                        ? desc(orders.orderDate)
                        : q.sort === 'totalAsc'
                            ? asc(orders.totalAmount)
                            : desc(orders.totalAmount)

    const [{ count }] = await (whereCond
        ? db.select({ count: sql<number>`count(*)` }).from(orders).where(whereCond)
        : db.select({ count: sql<number>`count(*)` }).from(orders))

    const total = Number(count)
    const totalPages = Math.ceil(total / limit)

    const baseSelect = {
        id: orders.id,
        latitude: orders.latitude,
        longitude: orders.longitude,
        orderDate: orders.orderDate,
        subtotalAmount: orders.subtotalAmount,
        compositeTaxRate: orders.compositeTaxRate,
        taxAmount: orders.taxAmount,
        totalAmount: orders.totalAmount,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
    }

    const items = await (whereCond
        ? db
            .select(baseSelect)
            .from(orders)
            .where(whereCond)
            .orderBy(orderBy)
            .limit(limit)
            .offset(offset)
        : db
            .select(baseSelect)
            .from(orders)
            .orderBy(orderBy)
            .limit(limit)
            .offset(offset))

    let linesByOrderId: Record<string, any[]> | undefined

    if (q.includeLines) {
        const ids = items.map((x) => x.id)
        if (ids.length) {
            const lines = await db
                .select({
                    id: taxLines.id,
                    orderId: taxLines.orderId,
                    taxRateId: taxLines.taxRateId,
                    jurisdictionId: taxLines.jurisdictionId,
                    jurisdictionName: taxLines.jurisdictionName,
                    jurisdictionKind: taxLines.jurisdictionKind,
                    jurisdictionLevel: taxLines.jurisdictionLevel,
                    rate: taxLines.rate,
                    amount: taxLines.amount,
                    createdAt: taxLines.createdAt,
                })
                .from(taxLines)
                .where(inArray(taxLines.orderId, ids))

            linesByOrderId = {}
            for (const l of lines) {
                const k = String(l.orderId)
                ;(linesByOrderId[k] ??= []).push({
                    ...l,
                    rate: Number(l.rate),
                    amount: Number(l.amount),
                })
            }
        }
    }

    const responseItems = items.map((x) => ({
        id: x.id,
        latitude: Number(x.latitude),
        longitude: Number(x.longitude),
        order_date: x.orderDate,
        subtotal_amount: Number(x.subtotalAmount),
        composite_tax_rate: Number(x.compositeTaxRate),
        tax_amount: Number(x.taxAmount),
        total_amount: Number(x.totalAmount),
        created_at: x.createdAt,
        updated_at: x.updatedAt,
        tax_lines: linesByOrderId ? linesByOrderId[String(x.id)] ?? [] : undefined,
    }))

    return json({
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages,
        items: responseItems,
    })
}

// =========================================================
// IMPORT LOGIC (kept in the SAME FILE, for unit tests)
// =========================================================

const ImportQuerySchema = z.object({
    dryRun: z.preprocess((v) => {
        if (v === undefined || v === null) return undefined
        const s = String(v).toLowerCase().trim()
        if (s === '1' || s === 'true' || s === 'yes') return true
        if (s === '0' || s === 'false' || s === 'no') return false
        return v
    }, z.boolean().optional()),
    maxReturn: z.coerce.number().int().min(0).max(200).default(50),
})

function parseImportQuery(request: Request) {
    const url = new URL(request.url)
    const obj: Record<string, string> = {}
    for (const [k, v] of url.searchParams.entries()) {
        if (!(k in obj)) obj[k] = v
    }
    return ImportQuerySchema.parse(obj)
}

type ImportError = { row: number; error: string }

async function readCsvTextFromRequest(request: Request): Promise<string> {
    const ct = request.headers.get('content-type') ?? ''

    if (ct.includes('multipart/form-data')) {
        const form = await request.formData()
        const maybeFile = form.get('file') ?? form.get('csv')
        if (!maybeFile) throw new Error('missing_file_field: expected form field "file" or "csv"')

        if (typeof maybeFile === 'string') return maybeFile

        // File / Blob
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const file = maybeFile as any
        if (typeof file.text !== 'function') throw new Error('invalid_file')
        return await file.text()
    }

    if (ct.includes('text/csv') || ct.includes('application/csv') || ct.includes('text/plain')) {
        return await request.text()
    }

    if (!ct) return await request.text()

    throw new Error(`unsupported_content_type: ${ct}`)
}

function parseOrdersFromCsvText(csvText: string): OrderInput[] {
    const records = parseCsv(csvText, {
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

// Exported for tests (since you want "same file")
export async function postOrdersImport(args: { request: Request }): Promise<Response> {
    try {
        const q = parseImportQuery(args.request)
        const dryRun = Boolean(q.dryRun)

        const csvText = await readCsvTextFromRequest(args.request)
        const inputs = parseOrdersFromCsvText(csvText)

        const results: Array<OrderOutput | (OrderOutput & { order_id: null })> = []
        const errors: ImportError[] = []

        for (let i = 0; i < inputs.length; i++) {
            try {
                if (dryRun) {
                    // compute only (no insert)
                    const input = inputs[i]
                    const date = orderDateNY(input.timestamp)
                    const point = sql`ST_SetSRID(ST_Point(${input.longitude}, ${input.latitude}), 4326)`

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
                                sql<boolean>`ST_Intersects(${jurisdictions.boundary}, ${point})`,
                            ),
                        )) as JurRow[]

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
                                sql<boolean>`ST_Intersects(${jurisdictions.boundary}, ${point})`,
                            ),
                        )) as JurRow[]

                    const { state, county, city } = splitAdmin(admin)
                    if (!state) throw new Error('state_not_found_for_point')

                    const allJurs = [state, county, city, ...specials].filter(Boolean) as JurRow[]
                    const jurIds = allJurs.map((j) => j.id)

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

                    const rateByJur = new Map<string, number>()
                    for (const r of rateRows) {
                        const jurId = String(r.jurisdictionId)
                        rateByJur.set(jurId, (rateByJur.get(jurId) ?? 0) + Number(r.rate))
                    }

                    const getRate = (j: JurRow | null) => (j ? rateByJur.get(j.id) ?? 0 : 0)

                    const stateRate = getRate(state)
                    const countyRate = getRate(county)
                    const cityRate = getRate(city)

                    const specialRates = specials
                        .map((s) => ({ jurisdiction_id: s.id, name: s.name, rate: getRate(s) }))
                        .filter((x) => x.rate > 0)

                    const subtotalCents = toCents(input.subtotal)

                    const linesToAllocate: Array<{ jurId: string; rate: number }> = []
                    if (stateRate > 0) linesToAllocate.push({ jurId: state.id, rate: stateRate })
                    if (county && countyRate > 0) linesToAllocate.push({ jurId: county.id, rate: countyRate })
                    if (city && cityRate > 0) linesToAllocate.push({ jurId: city.id, rate: cityRate })
                    for (const s of specials) {
                        const r = getRate(s)
                        if (r > 0) linesToAllocate.push({ jurId: s.id, rate: r })
                    }

                    const { totalRate, totalTax } = allocateTaxCents(subtotalCents, linesToAllocate)

                    const taxAmountCents = totalTax
                    const totalAmountCents = subtotalCents + taxAmountCents

                    if (results.length < q.maxReturn) {
                        results.push({
                            // @ts-expect-error - dry run
                            order_id: null,
                            composite_tax_rate: rateNum(totalRate),
                            tax_amount: moneyNum(taxAmountCents),
                            total_amount: moneyNum(totalAmountCents),
                            breakdown: {
                                state_rate: rateNum(stateRate),
                                county_rate: rateNum(countyRate),
                                city_rate: rateNum(cityRate),
                                special_rates: specialRates.map((x) => ({ ...x, rate: rateNum(x.rate) })),
                            },
                        })
                    }
                } else {
                    const out = await calculateAndStoreOne(inputs[i])
                    if (results.length < q.maxReturn) results.push(out)
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'unknown_error'
                errors.push({ row: i + 2, error: msg }) // +2: header row + 1-based
            }
        }

        return json({
            dryRun,
            imported: inputs.length - errors.length,
            failed: errors.length,
            returned: results.length,
            results,
            errors,
        })
    } catch (err) {
        if (err instanceof z.ZodError) {
            return json({ error: 'invalid_input', issues: err.issues }, 400)
        }
        const msg = err instanceof Error ? err.message : 'internal_error'
        return json({ error: msg }, 500)
    }
}

// -----------------------------
// Route export (ONLY /api/orders)
// -----------------------------
export const Route = createFileRoute('/api/orders')({
    server: {
        handlers: {
            GET: async ({ request }) => {
                try {
                    return await listOrders(request)
                } catch (err) {
                    if (err instanceof z.ZodError) {
                        return json({ error: 'invalid_query', issues: err.issues }, 400)
                    }
                    const msg = err instanceof Error ? err.message : 'internal_error'
                    return json({ error: msg }, 500)
                }
            },

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