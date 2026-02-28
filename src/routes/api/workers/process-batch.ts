import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parse } from 'csv-parse'
import { Readable } from 'node:stream'
import { Client, Receiver } from '@upstash/qstash'
import { Redis } from '@upstash/redis'
import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'

import { db } from '#/db/index'
import {
  jurisdictions,
  taxRates,
  orders,
  taxLines,
  importJobs,
} from '#/db/schema/tax'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
})

const redis = Redis.fromEnv()

const BodySchema = z.object({
  jobId: z.string().uuid(),
  fileUrl: z.string().url(),
  startRow: z.number().int().min(0),
  endRow: z.number().int().min(1),
})

const OrderInputSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  subtotal: z.coerce.number().min(0),
  timestamp: z.coerce.date(),
})

type OrderInput = z.infer<typeof OrderInputSchema>

type JurRow = {
  id: string
  name: string
  kind: 'ADMINISTRATIVE' | 'SPECIAL'
  level: number | null
}

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

  return { compositeRate, activeJurs }
}

async function calculateOrderDetails(input: OrderInput) {
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

  const { compositeRate, activeJurs } = resolveTaxComponents(allJurs, ratesMap)

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
    composite_tax_rate: rateNum(compositeRate),
    tax_amount: moneyNum(totalTaxCents),
    total_amount: moneyNum(subtotalCents + totalTaxCents),
    rawPerLine,
  }
}

async function calculateAndSaveImportedOrder(
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

    const rows = details.rawPerLine.map((l: any) => ({
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

async function readCsvRange(fileUrl: string, startRow: number, endRow: number) {
  const res = await fetch(fileUrl)
  if (!res.ok) throw new Error(`failed_to_fetch_csv:${res.status}`)
  if (!res.body) throw new Error('no_body')

  const nodeStream = Readable.fromWeb(res.body as any)
  const parser = parse({
    columns: true,
    trim: true,
    skip_empty_lines: true,
  })

  nodeStream.pipe(parser)

  const out: Array<Record<string, unknown>> = []
  let idx = 0

  try {
    for await (const record of parser) {
      if (idx >= startRow && idx < endRow) out.push(record as any)
      idx++
      if (idx >= endRow) {
        nodeStream.destroy()
        break
      }
    }
  } finally {
    parser.destroy()
  }

  return out
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<void>,
) {
  let cursor = 0
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      await fn(items[i]!, i)
    }
  })
  await Promise.all(workers)
}

export const Route = createFileRoute('/api/workers/process-batch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // QStash verify
        const raw = await request.text()
        const sig =
          request.headers.get('Upstash-Signature') ??
          request.headers.get('upstash-signature') ??
          ''

        const allowUnverified = process.env.ALLOW_UNVERIFIED_WORKER === 'true'
        if (!allowUnverified) {
          const ok = await receiver.verify({
            signature: sig,
            body: raw,
            url: request.url,
          })
          if (!ok) return json({ error: 'invalid_signature' }, 401)
        }

        const payload = BodySchema.parse(JSON.parse(raw))
        const { jobId, fileUrl, startRow, endRow } = payload

        // batch idempotency (so retries don’t double count)
        const batchKey = `job:${jobId}:batch:${startRow}-${endRow}`
        const batchSet = await redis.set(batchKey, '1', {
          nx: true,
          ex: 60 * 60 * 24,
        })
        if (batchSet === null) return json({ ok: true, skipped: true })

        const jobKey = `job:${jobId}`

        // read target rows
        const rawRows = await readCsvRange(fileUrl, startRow, endRow)

        let attempted = rawRows.length
        let failed = 0
        let succeeded = 0

        const parsed: Array<{ input: OrderInput; rowNumber: number }> = []

        for (let i = 0; i < rawRows.length; i++) {
          const rowNumber = startRow + i + 1 // 1-based global row number
          try {
            const input = OrderInputSchema.parse(rawRows[i])
            parsed.push({ input, rowNumber })
          } catch {
            failed++
          }
        }

        // process with limited concurrency (spatial queries are heavy)
        await runWithConcurrency(parsed, 10, async (p) => {
          try {
            await calculateAndSaveImportedOrder(p.input, jobId, p.rowNumber)
            succeeded++
          } catch {
            failed++
          }
        })

        // progress updates (Redis)
        const newProcessed = await redis.hincrby(jobKey, 'processed', attempted)
        await redis.hincrby(jobKey, 'failed', failed)
        await redis.hset(jobKey, { status: 'PROCESSING' })

        // progress updates (DB, atomic increments)
        await db
          .update(importJobs)
          .set({
            status: 'PROCESSING',
            processedRows: sql`${importJobs.processedRows} + ${attempted}`,
            failedRows: sql`${importJobs.failedRows} + ${failed}`,
          })
          .where(eq(importJobs.id, jobId))

        const total = Number((await redis.hget(jobKey, 'total')) ?? 0)

        if (total > 0 && Number(newProcessed) >= total) {
          await redis.hset(jobKey, {
            status: 'COMPLETED',
            completedAt: new Date().toISOString(),
          })
          await db
            .update(importJobs)
            .set({ status: 'COMPLETED', completedAt: sql`now()` })
            .where(eq(importJobs.id, jobId))
        }

        return json({
          ok: true,
          jobId,
          attempted,
          succeeded,
          failed,
          processed: Number(newProcessed),
          total,
        })
      },
    },
  },
  component: () => null,
})
