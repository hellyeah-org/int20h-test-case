import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parse as parseCsv } from 'csv-parse/sync'
import { and, desc, gte, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import { db } from '#/db/index'
import { jurisdictions, taxRates, orders, taxLines } from '#/db/schema/tax'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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

type JurRow = {
  id: string
  name: string
  kind: 'ADMINISTRATIVE' | 'SPECIAL'
  level: number | null
}

type OrderOutput = {
  order_id: string | null
  composite_tax_rate: number
  tax_amount: number
  total_amount: number
  breakdown: {
    state_rate: number
    county_rate: number
    city_rate: number
    special_rates: number
  }
  jurisdictions: Array<{
    id: string
    name: string
    kind: string
    level: number | null
    rate: number
  }>
}

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
  dateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  dateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sumFrom: z.coerce.number().min(0).optional(),
  sumTo: z.coerce.number().min(0).optional(),
  includeLines: BoolQuery,
  hasSpecial: BoolQuery,
  minRate: z.coerce.number().min(0).max(1).optional(),
  maxRate: z.coerce.number().min(0).max(1).optional(),
})

const toCents = (x: number) => Math.round(x * 100)
const moneyStr = (cents: number) => (cents / 100).toFixed(2)
const moneyNum = (cents: number) => Number((cents / 100).toFixed(2))
const rateNum = (r: number) => Number(r.toFixed(6))
const rateStr = (r: number) => r.toFixed(6)

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
  return `${y}-${m}-${d}`
}

function resolveTaxComponents(
  allJurs: JurRow[],
  ratesMap: Map<string, number>,
) {
  const stateJur = allJurs.find((j) => j.level === 10)
  const countyJur = allJurs.find((j) => j.level === 20)
  const cityJur = allJurs.find((j) => j.level === 30)
  const specialJurs = allJurs.filter(
    (j) => j.kind === 'SPECIAL' || j.level === null,
  )

  const stateRate = stateJur ? (ratesMap.get(stateJur.id) ?? 0) : 0
  const cityRateRaw = cityJur ? (ratesMap.get(cityJur.id) ?? 0) : 0
  const countyRateRaw = countyJur ? (ratesMap.get(countyJur.id) ?? 0) : 0

  let finalCityRate = 0
  let finalCountyRate = 0
  let activeLocalJur: JurRow | null = null

  if (cityJur && cityRateRaw > 0) {
    finalCityRate = cityRateRaw
    activeLocalJur = cityJur
  } else {
    finalCountyRate = countyRateRaw
    if (countyJur && countyRateRaw > 0) activeLocalJur = countyJur
  }

  const appliedSpecials = specialJurs
    .map((j) => ({ jur: j, rate: ratesMap.get(j.id) ?? 0 }))
    .filter((s) => s.rate > 0)

  const activeJurs: Array<{ jur: JurRow; rate: number }> = []
  if (stateJur && stateRate > 0)
    activeJurs.push({ jur: stateJur, rate: stateRate })
  if (activeLocalJur) {
    const rate = activeLocalJur.level === 30 ? finalCityRate : finalCountyRate
    if (rate > 0) activeJurs.push({ jur: activeLocalJur, rate })
  }
  appliedSpecials.forEach((s) => activeJurs.push(s))

  const specialRateSum = appliedSpecials.reduce((sum, s) => sum + s.rate, 0)

  const compositeRate =
    stateRate + finalCityRate + finalCountyRate + specialRateSum

  return {
    compositeRate,
    stateRate,
    finalCountyRate,
    finalCityRate,
    specialRateSum,
    activeJurs,
  }
}

async function calculateOrderDetails(
  input: OrderInput,
): Promise<OrderOutput & { rawPerLine: any[] }> {
  const date = orderDateNY(input.timestamp)
  const point = sql`ST_SetSRID(ST_Point(${input.longitude}, ${input.latitude}), 4326)`

  const allJurs = (await db
    .select({
      id: jurisdictions.id,
      name: jurisdictions.name,
      kind: jurisdictions.kind,
      level: jurisdictions.level,
    })
    .from(jurisdictions)
    .where(sql`ST_Intersects(${jurisdictions.boundary}, ${point})`)) as JurRow[]

  if (!allJurs.some((j) => j.level === 10))
    throw new Error('state_not_found_for_point')

  const jurIds = allJurs.map((j) => j.id)
  const rateRows = await db
    .select({ jurisdictionId: taxRates.jurisdictionId, rate: taxRates.rate })
    .from(taxRates)
    .where(
      and(
        inArray(taxRates.jurisdictionId, jurIds),
        lte(taxRates.effectiveFrom, date),
        or(isNull(taxRates.effectiveTo), gt(taxRates.effectiveTo, date)),
      ),
    )

  const ratesMap = new Map<string, number>()
  for (const r of rateRows) {
    ratesMap.set(
      r.jurisdictionId,
      (ratesMap.get(r.jurisdictionId) ?? 0) + Number(r.rate),
    )
  }

  const {
    compositeRate,
    stateRate,
    finalCountyRate,
    finalCityRate,
    specialRateSum,
    activeJurs,
  } = resolveTaxComponents(allJurs, ratesMap)

  const subtotalCents = toCents(input.subtotal)
  const totalTaxCents = Math.round(subtotalCents * compositeRate)

  const rawPerLine = activeJurs.map((a) => ({
    jur: a.jur,
    rate: a.rate,
    cents: Math.round(subtotalCents * a.rate),
  }))

  const sumLines = rawPerLine.reduce((a, b) => a + b.cents, 0)
  if (totalTaxCents !== sumLines && rawPerLine.length > 0) {
    rawPerLine[0].cents += totalTaxCents - sumLines
  }

  return {
    order_id: null,
    composite_tax_rate: rateNum(compositeRate),
    tax_amount: moneyNum(totalTaxCents),
    total_amount: moneyNum(subtotalCents + totalTaxCents),
    breakdown: {
      state_rate: rateNum(stateRate),
      county_rate: rateNum(finalCountyRate),
      city_rate: rateNum(finalCityRate),
      special_rates: rateNum(specialRateSum),
    },
    jurisdictions: activeJurs.map((a) => ({
      id: a.jur.id,
      name: a.jur.name,
      kind: a.jur.kind,
      level: a.jur.level,
      rate: rateNum(a.rate),
    })),
    rawPerLine,
  }
}

async function calculateAndStoreOne(input: OrderInput): Promise<OrderOutput> {
  const data = await calculateOrderDetails(input)
  const date = orderDateNY(input.timestamp)

  const inserted = await db.transaction(async (tx) => {
    const [o] = await tx
      .insert(orders)
      .values({
        latitude: input.latitude.toFixed(6),
        longitude: input.longitude.toFixed(6),
        orderDate: date,
        subtotalAmount: moneyStr(toCents(input.subtotal)),
        compositeTaxRate: rateStr(data.composite_tax_rate),
        taxAmount: moneyStr(toCents(data.tax_amount)),
        totalAmount: moneyStr(toCents(data.total_amount)),
      })
      .returning({ id: orders.id })

    const taxLineRows = data.rawPerLine.map((l) => ({
      orderId: o.id,
      jurisdictionId: l.jur.id,
      jurisdictionName: l.jur.name,
      jurisdictionKind: l.jur.kind,
      jurisdictionLevel: l.jur.level,
      rate: rateStr(l.rate),
      amount: moneyStr(l.cents),
    }))

    if (taxLineRows.length > 0) await tx.insert(taxLines).values(taxLineRows)
    return o
  })

  return { ...data, order_id: inserted.id }
}

async function listOrders(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const q = OrdersListQuerySchema.parse(
    Object.fromEntries(url.searchParams.entries()),
  )
  const offset = (q.page - 1) * q.pageSize

  const whereParts: any[] = []
  if (q.dateFrom) whereParts.push(gte(orders.orderDate, q.dateFrom))
  if (q.dateTo) whereParts.push(lte(orders.orderDate, q.dateTo))
  if (q.sumFrom !== undefined)
    whereParts.push(gte(orders.totalAmount, String(q.sumFrom)))
  if (q.sumTo !== undefined)
    whereParts.push(lte(orders.totalAmount, String(q.sumTo)))

  const whereCond = whereParts.length ? and(...whereParts) : undefined

  const items = await db
    .select()
    .from(orders)
    .where(whereCond)
    .limit(q.pageSize)
    .offset(offset)
    .orderBy(desc(orders.createdAt))
  const orderIds = items.map((i) => i.id)
  const allLines = orderIds.length
    ? await db
        .select()
        .from(taxLines)
        .where(inArray(taxLines.orderId, orderIds))
    : []

  const responseItems = items.map((o) => {
    const lines = allLines.filter((l) => l.orderId === o.id)

    const specialRateSum = lines
      .filter(
        (l) => l.jurisdictionKind === 'SPECIAL' || l.jurisdictionLevel === null,
      )
      .reduce((sum, l) => sum + Number(l.rate), 0)

    return {
      id: o.id,
      latitude: Number(o.latitude),
      longitude: Number(o.longitude),
      order_date: o.orderDate,
      subtotal_amount: Number(o.subtotalAmount),
      composite_tax_rate: Number(o.compositeTaxRate),
      tax_amount: Number(o.taxAmount),
      total_amount: Number(o.totalAmount),
      breakdown: {
        state_rate: Number(
          lines.find((l) => l.jurisdictionLevel === 10)?.rate ?? 0,
        ),
        county_rate: Number(
          lines.find((l) => l.jurisdictionLevel === 20)?.rate ?? 0,
        ),
        city_rate: Number(
          lines.find((l) => l.jurisdictionLevel === 30)?.rate ?? 0,
        ),
        special_rates: specialRateSum,
      },
      jurisdictions: lines.map((l) => ({
        id: l.jurisdictionId,
        name: l.jurisdictionName,
        kind: l.jurisdictionKind,
        level: l.jurisdictionLevel,
        rate: Number(l.rate),
      })),
    }
  })

  return json({ page: q.page, pageSize: q.pageSize, items: responseItems })
}

export const Route = createFileRoute('/api/orders')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await listOrders(request)
        } catch (err) {
          return json({ error: 'failed_to_list' }, 500)
        }
      },
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const dryRun = url.searchParams.get('dryRun') === 'true'
          const ct = request.headers.get('content-type') ?? ''

          let inputs: OrderInput[] = []
          if (ct.includes('csv')) {
            const text = await request.text()
            const records = parseCsv(text, {
              columns: true,
              skip_empty_lines: true,
              trim: true,
            })
            inputs = z.array(OrderInputSchema).parse(records)
          } else {
            const body = await request.json()
            const parsed = OrdersJsonSchema.parse(body)
            inputs = Array.isArray(parsed) ? parsed : parsed.orders
          }

          const results = []
          for (const input of inputs) {
            results.push(
              dryRun
                ? await calculateOrderDetails(input)
                : await calculateAndStoreOne(input),
            )
          }
          return json({ orders: results })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'internal_error'
          return json({ error: msg }, 400)
        }
      },
    },
  },
  component: () => null,
})
