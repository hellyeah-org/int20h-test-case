import { z } from 'zod'
import { parse as parseCsv } from 'csv-parse/sync'
import { eq, sql } from 'drizzle-orm'

import { db } from '#/db/index'
import { importJobs } from '#/db/schema/tax'
import {
  OrderInputSchema,
  calculateOrderDetails,
  saveImportedOrdersBatch,
  type PreparedImportRow,
} from '#/lib/tax-engine.server'

// ─── Lazy cloud clients (only initialised when the cloud path is used) ───────

let _qstash: import('@upstash/qstash').Client | null = null
function getQStash() {
  if (!_qstash) {
    const { Client } = require('@upstash/qstash') as typeof import('@upstash/qstash')
    _qstash = new Client({ token: process.env.QSTASH_TOKEN! })
  }
  return _qstash
}

let _redis: import('@upstash/redis').Redis | null = null
function getRedis() {
  if (!_redis) {
    const { Redis } = require('@upstash/redis') as typeof import('@upstash/redis')
    _redis = Redis.fromEnv()
  }
  return _redis
}

const isLocalImport = () => process.env.LOCAL_IMPORT === 'true'

// ─── In-process cancellation (LOCAL_IMPORT only) ──────────────────────────────

/** Jobs that the user has requested to stop. Checked in the processing loop. */
const cancelledJobs = new Set<string>()

/**
 * Mark a job as cancelled so the in-process loop will stop at the next chunk
 * boundary. Also updates the DB status to FAILED.
 */
export async function markJobCancelled(jobId: string) {
  cancelledJobs.add(jobId)
  await db
    .update(importJobs)
    .set({ status: 'FAILED', completedAt: sql`now()` })
    .where(eq(importJobs.id, jobId))
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const ImportQuerySchema = z.object({
  batchSize: z.coerce.number().int().min(50).max(2000).default(500),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120)
}

async function runWithConcurrency<T>(
  items: Array<T>,
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

async function publishInBatches<T>(
  items: Array<T>,
  _batchSize: number,
  publish: (item: T, i: number) => Promise<void>,
  concurrency = 10,
) {
  let idx = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const i = idx++
      await publish(items[i], i)
    }
  })
  await Promise.all(workers)
}

// ─── Local Import (no Blob / QStash / Redis) ─────────────────────────────────

const CALC_CONCURRENCY = 20
const FLUSH_BATCH_SIZE = 50
const DB_UPDATE_INTERVAL = 50

async function processImportFileLocal(file: File): Promise<string> {
  const text = await file.text()
  const records = parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Record<string, unknown>>

  const totalRows = records.length

  // Create DB job
  const [job] = await db
    .insert(importJobs)
    .values({
      fileName: file.name || 'orders.csv',
      status: 'PROCESSING',
      totalRows,
      processedRows: 0,
      failedRows: 0,
    })
    .returning({ id: importJobs.id })

  const jobId = job.id

  // Fire-and-forget: process rows in the background so the server function
  // returns immediately with the jobId (frontend polls for progress).
  void (async () => {
    let processed = 0
    let failed = 0

    // Parse and validate all rows first
    const parsed: Array<{
      input: z.infer<typeof OrderInputSchema>
      rowNumber: number
    }> = []

    for (let i = 0; i < records.length; i++) {
      try {
        const input = OrderInputSchema.parse(records[i])
        parsed.push({ input, rowNumber: i + 1 })
      } catch {
        processed++
        failed++
      }
    }

    // Process in chunks: calculate with high concurrency, then flush writes
    // in a single bulk transaction per chunk.
    for (let start = 0; start < parsed.length; start += FLUSH_BATCH_SIZE) {
      // Check for cancellation at the start of each chunk
      if (cancelledJobs.has(jobId)) {
        cancelledJobs.delete(jobId)
        // DB status already set to FAILED by markJobCancelled — just stop.
        return
      }

      const chunk = parsed.slice(start, start + FLUSH_BATCH_SIZE)

      // Phase 1: Calculate all order details concurrently (read-only DB queries)
      const prepared: Array<PreparedImportRow> = []
      const chunkFailed: Array<boolean> = new Array(chunk.length).fill(false)

      await runWithConcurrency(chunk, CALC_CONCURRENCY, async (p, i) => {
        try {
          const details = await calculateOrderDetails(p.input)
          prepared.push({
            input: p.input,
            details,
            jobId,
            rowNumber: p.rowNumber,
          })
        } catch {
          chunkFailed[i] = true
        }
      })

      failed += chunkFailed.filter(Boolean).length

      // Phase 2: Batch-write all successfully calculated rows in one transaction
      if (prepared.length > 0) {
        try {
          await saveImportedOrdersBatch(prepared)
        } catch {
          // If the whole batch fails, count all as failed
          failed += prepared.length
          prepared.length = 0
        }
      }

      processed += chunk.length

      // Update DB progress
      if (processed % DB_UPDATE_INTERVAL === 0 || start + FLUSH_BATCH_SIZE >= parsed.length) {
        await db
          .update(importJobs)
          .set({
            processedRows: processed,
            failedRows: failed,
          })
          .where(eq(importJobs.id, jobId))
      }
    }

    // Final DB update
    await db
      .update(importJobs)
      .set({
        status: 'COMPLETED',
        processedRows: processed,
        failedRows: failed,
        completedAt: sql`now()`,
      })
      .where(eq(importJobs.id, jobId))
  })()

  return jobId
}

// ─── Cloud Import Orchestration ───────────────────────────────────────────────

/**
 * Orchestrates a CSV import:
 *
 * - LOCAL_IMPORT=true  -> process all rows in-process (no external services)
 * - Otherwise          -> Vercel Blob upload + QStash fan-out + Redis progress
 *
 * Returns the jobId.
 */
export async function processImportFile(
  file: File,
  batchSize: number,
  baseUrl: string,
): Promise<string> {
  if (isLocalImport()) {
    return processImportFileLocal(file)
  }

  const redis = getRedis()
  const qstash = getQStash()
  const { put } = await import('@vercel/blob')

  const originalName = sanitizeFilename(file.name || 'orders.csv')

  // 1) upload to Vercel Blob
  const blob = await put(
    `imports/${crypto.randomUUID()}-${originalName}`,
    file,
    { access: 'public', contentType: 'text/csv' },
  )
  const fileUrl = blob.url

  // 2) count rows fast (parse once)
  const text = await file.text()
  const records = parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  const totalRows = records.length

  // 3) create DB job
  const [job] = await db
    .insert(importJobs)
    .values({
      fileName: fileUrl,
      status: 'PENDING',
      totalRows,
      processedRows: 0,
      failedRows: 0,
    })
    .returning({ id: importJobs.id })

  const jobId = job.id

  // 4) init Redis job state (frontend poll)
  const jobKey = `job:${jobId}`
  await redis.hset(jobKey, {
    status: 'PENDING',
    total: totalRows,
    processed: 0,
    failed: 0,
    fileUrl,
  })
  await redis.expire(jobKey, 60 * 60 * 24) // 24h

  // 5) fan-out QStash messages by ranges
  const workerUrl = `${baseUrl}/api/workers/process-batch`

  const ranges: Array<{ startRow: number; endRow: number }> = []
  for (let start = 0; start < totalRows; start += batchSize) {
    ranges.push({
      startRow: start,
      endRow: Math.min(start + batchSize, totalRows),
    })
  }

  // mark processing in DB/Redis
  await db
    .update(importJobs)
    .set({ status: 'PROCESSING' })
    .where(eq(importJobs.id, jobId))
  await redis.hset(jobKey, { status: 'PROCESSING' })

  await publishInBatches(
    ranges,
    1,
    async (r) => {
      await qstash.publishJSON({
        url: workerUrl,
        body: {
          jobId,
          fileUrl,
          startRow: r.startRow,
          endRow: r.endRow,
        },
        retries: 10,
      })
    },
    10,
  )

  return jobId
}

// ─── Job Status Lookup ────────────────────────────────────────────────────────

export type JobStatusResult = {
  id: string
  status: string
  total: number
  processed: number
  failed: number
  fileUrl: string | null
  completedAt: string | null
}

/**
 * Look up job status.
 *
 * - LOCAL_IMPORT=true  -> DB only (no Redis)
 * - Otherwise          -> Redis first, DB fallback
 */
export async function getJobStatus(
  jobId: string,
): Promise<JobStatusResult | null> {
  // In local mode skip Redis entirely — all state lives in the DB
  if (!isLocalImport()) {
    try {
      const redis = getRedis()
      const key = `job:${jobId}`
      const hash = await redis.hgetall<Record<string, string>>(key)
      if (hash && Object.keys(hash).length) {
        return {
          id: jobId,
          status: hash.status,
          total: Number(hash.total ?? 0),
          processed: Number(hash.processed ?? 0),
          failed: Number(hash.failed ?? 0),
          fileUrl: hash.fileUrl ?? null,
          completedAt: hash.completedAt ?? null,
        }
      }
    } catch {
      // Redis unavailable — fall through to DB
    }
  }

  // DB fallback (always available)
  const [job] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, jobId))
    .limit(1)
  if (!job) return null

  return {
    id: job.id,
    status: job.status,
    total: job.totalRows,
    processed: job.processedRows,
    failed: job.failedRows,
    fileUrl: job.fileName,
    completedAt: job.completedAt?.toISOString() ?? null,
  }
}
