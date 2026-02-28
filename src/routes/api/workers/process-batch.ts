import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parse } from 'csv-parse'
import { Readable } from 'node:stream'
import { Receiver } from '@upstash/qstash'
import { Redis } from '@upstash/redis'
import { eq, sql } from 'drizzle-orm'

import { db } from '#/db/index'
import { importJobs } from '#/db/schema/tax'
import {
  OrderInputSchema,
  type OrderInput,
  calculateAndSaveImportedOrder,
} from '#/lib/tax-engine.server'

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

        // batch idempotency (so retries don't double count)
        const batchKey = `job:${jobId}:batch:${startRow}-${endRow}`
        const batchSet = await redis.set(batchKey, '1', {
          nx: true,
          ex: 60 * 60 * 24,
        })
        if (batchSet === null) return json({ ok: true, skipped: true })

        const jobKey = `job:${jobId}`

        // read target rows
        const rawRows = await readCsvRange(fileUrl, startRow, endRow)

        const attempted = rawRows.length
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
