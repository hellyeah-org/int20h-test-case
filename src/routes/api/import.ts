import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parse as parseCsv } from 'csv-parse/sync'
import { put } from '@vercel/blob'
import { Client } from '@upstash/qstash'
import { Redis } from '@upstash/redis'
import { eq } from 'drizzle-orm'

import { db } from '#/db/index'
import { importJobs } from '#/db/schema/tax'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const qstash = new Client({ token: process.env.QSTASH_TOKEN! })
const redis = Redis.fromEnv()

const ImportQuerySchema = z.object({
  batchSize: z.coerce.number().int().min(50).max(2000).default(500),
})

function sanitizeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 120)
}

async function publishInBatches<T>(
  items: T[],
  batchSize: number,
  publish: (batch: T, i: number) => Promise<void>,
  concurrency = 10,
) {
  let idx = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const i = idx++
      await publish(items[i]!, i)
    }
  })
  await Promise.all(workers)
}

export const Route = createFileRoute('/api/import')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url)
          const q = ImportQuerySchema.parse(
            Object.fromEntries(url.searchParams.entries()),
          )

          const ct = request.headers.get('content-type') ?? ''
          if (!ct.includes('multipart/form-data')) {
            return json({ error: 'expected_multipart_form_data' }, 415)
          }

          const form = await request.formData()
          const f = form.get('file')
          if (!(f instanceof File)) return json({ error: 'file_required' }, 400)

          const originalName = sanitizeFilename(f.name || 'orders.csv')

          // 1) upload to Vercel Blob
          const blob = await put(
            `imports/${crypto.randomUUID()}-${originalName}`,
            f,
            { access: 'public', contentType: 'text/csv' },
          )
          const fileUrl = blob.url

          // 2) count rows fast (parse once)
          const text = await f.text()
          const records = parseCsv(text, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
          }) as Array<Record<string, unknown>>

          const totalRows = records.length

          // 3) create DB job (id used as importJobId in orders)
          const [job] = await db
            .insert(importJobs)
            .values({
              fileName: fileUrl, // у тебе поле fileName notNull — збережемо url тут
              status: 'PENDING',
              totalRows,
              processedRows: 0,
              failedRows: 0,
              // errors лишаємо дефолт []
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
          const baseUrl =
            process.env.PUBLIC_BASE_URL ?? new URL(request.url).origin
          const workerUrl = `${baseUrl}/api/workers/process-batch`

          const batchSize = q.batchSize
          const ranges: Array<{ startRow: number; endRow: number }> = []
          for (let start = 0; start < totalRows; start += batchSize) {
            ranges.push({
              startRow: start,
              endRow: Math.min(start + batchSize, totalRows),
            })
          }

          // mark processing in DB/Redis now (or you can leave PENDING until first worker hits)
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

          return json({ jobId }, 202)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'internal_error'
          return json({ error: msg }, 500)
        }
      },
    },
  },
  component: () => null,
})
