import { z } from 'zod'
import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import { db } from '#/db/index'
import { jurisdictions, orders, taxLines, taxRates } from '#/db/schema/tax'

// ─── Schemas & Types ──────────────────────────────────────────────────────────

export const OrderInputSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  subtotal: z.coerce.number().min(0),
  timestamp: z.coerce.date(),
})

export type OrderInput = z.infer<typeof OrderInputSchema>

export type JurRow = {
  id: string
  name: string
  kind: 'ADMINISTRATIVE' | 'SPECIAL'
  level: number | null
}

export type OrderOutput = {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const toCents = (x: number) => Math.round(x * 100)
export const moneyStr = (cents: number) => (cents / 100).toFixed(2)
export const moneyNum = (cents: number) => Number((cents / 100).toFixed(2))
export const rateNum = (r: number) => Number(r.toFixed(6))
export const rateStr = (r: number) => r.toFixed(6)

export function orderDateNY(ts: Date) {
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

// ─── Tax Resolution ───────────────────────────────────────────────────────────

export function resolveTaxComponents(
  allJurs: Array<JurRow>,
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

  // City-vs-county priority: if city has a rate, county rate is zeroed out
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

// ─── Core Calculation ─────────────────────────────────────────────────────────

export async function calculateOrderDetails(
  input: OrderInput,
): Promise<
  OrderOutput & {
    rawPerLine: Array<{ jur: JurRow; rate: number; cents: number }>
  }
> {
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
    .where(
      sql`ST_Intersects(${jurisdictions.boundary}, ${point})`,
    )) as Array<JurRow>

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

  // Per-line penny rounding with adjustment to match total
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

// ─── Store a single manually-created order ────────────────────────────────────

export async function calculateAndStoreOne(
  input: OrderInput,
): Promise<OrderOutput> {
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

// ─── Store an imported order (idempotent via externalId) ──────────────────────

export async function calculateAndSaveImportedOrder(
  input: OrderInput,
  jobId: string,
  rowNumber: number,
) {
  const details = await calculateOrderDetails(input)
  const date = orderDateNY(input.timestamp)
  const externalId = `${jobId}:${rowNumber}`

  const insertedOrderId = await db.transaction(async (tx) => {
    const [o] = await tx
      .insert(orders)
      .values({
        importJobId: jobId,
        externalId,
        latitude: input.latitude.toFixed(6),
        longitude: input.longitude.toFixed(6),
        orderDate: date,
        subtotalAmount: moneyStr(toCents(input.subtotal)),
        compositeTaxRate: rateStr(details.composite_tax_rate),
        taxAmount: moneyStr(toCents(details.tax_amount)),
        totalAmount: moneyStr(toCents(details.total_amount)),
      })
      .onConflictDoUpdate({
        target: [orders.externalId],
        set: {
          updatedAt: sql`now()`,
          importJobId: jobId,
        },
      })
      .returning({ id: orders.id })

    // idempotent tax lines: wipe and insert again
    await tx.delete(taxLines).where(eq(taxLines.orderId, o.id))

    const rows = details.rawPerLine.map((l) => ({
      orderId: o.id,
      jurisdictionId: l.jur.id,
      jurisdictionName: l.jur.name,
      jurisdictionKind: l.jur.kind,
      jurisdictionLevel: l.jur.level,
      rate: rateStr(l.rate),
      amount: moneyStr(l.cents),
    }))

    if (rows.length) await tx.insert(taxLines).values(rows)
    return o.id
  })

  return insertedOrderId
}

// ─── Batch-write pre-calculated imported orders ───────────────────────────────

export type PreparedImportRow = {
  input: OrderInput
  details: Awaited<ReturnType<typeof calculateOrderDetails>>
  jobId: string
  rowNumber: number
}

/**
 * Flush an array of already-calculated orders to the DB in a single
 * transaction with bulk INSERT statements. Much faster than one
 * transaction per row when writing to a remote database.
 *
 * Idempotent via externalId (ON CONFLICT UPDATE).
 */
export async function saveImportedOrdersBatch(
  rows: Array<PreparedImportRow>,
): Promise<void> {
  if (rows.length === 0) return

  await db.transaction(async (tx) => {
    // 1) Bulk-insert all orders, returning their IDs in insertion order
    const orderValues = rows.map((r) => ({
      importJobId: r.jobId,
      externalId: `${r.jobId}:${r.rowNumber}`,
      latitude: r.input.latitude.toFixed(6),
      longitude: r.input.longitude.toFixed(6),
      orderDate: orderDateNY(r.input.timestamp),
      subtotalAmount: moneyStr(toCents(r.input.subtotal)),
      compositeTaxRate: rateStr(r.details.composite_tax_rate),
      taxAmount: moneyStr(toCents(r.details.tax_amount)),
      totalAmount: moneyStr(toCents(r.details.total_amount)),
    }))

    const inserted = await tx
      .insert(orders)
      .values(orderValues)
      .onConflictDoUpdate({
        target: [orders.externalId],
        set: {
          updatedAt: sql`now()`,
          importJobId: sql`excluded.import_job_id`,
        },
      })
      .returning({ id: orders.id })

    // 2) Delete old tax lines for all upserted orders in one query
    const orderIds = inserted.map((o) => o.id)
    await tx.delete(taxLines).where(inArray(taxLines.orderId, orderIds))

    // 3) Build all tax line rows and bulk-insert
    const allTaxLines: Array<typeof taxLines.$inferInsert> = []
    for (let i = 0; i < rows.length; i++) {
      const orderId = inserted[i].id
      for (const l of rows[i].details.rawPerLine) {
        allTaxLines.push({
          orderId,
          jurisdictionId: l.jur.id,
          jurisdictionName: l.jur.name,
          jurisdictionKind: l.jur.kind,
          jurisdictionLevel: l.jur.level,
          rate: rateStr(l.rate),
          amount: moneyStr(l.cents),
        })
      }
    }

    if (allTaxLines.length > 0) {
      await tx.insert(taxLines).values(allTaxLines)
    }
  })
}
