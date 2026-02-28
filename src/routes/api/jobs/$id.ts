import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
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

const redis = Redis.fromEnv()

export const Route = createFileRoute('/api/jobs/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = z.string().uuid().parse(params.id)
        const key = `job:${id}`

        const hash = await redis.hgetall<Record<string, any>>(key)
        if (hash && Object.keys(hash).length) {
          return json({
            job: {
              id,
              status: hash.status,
              total: Number(hash.total ?? 0),
              processed: Number(hash.processed ?? 0),
              failed: Number(hash.failed ?? 0),
              fileUrl: hash.fileUrl,
              completedAt: hash.completedAt ?? null,
            },
          })
        }

        // fallback to DB (якщо Redis TTL пройшов)
        const [job] = await db
          .select()
          .from(importJobs)
          .where(eq(importJobs.id, id))
          .limit(1)
        if (!job) return json({ error: 'not_found' }, 404)

        return json({
          job: {
            id: job.id,
            status: job.status,
            total: job.totalRows,
            processed: job.processedRows,
            failed: job.failedRows,
            fileUrl: job.fileName,
            completedAt: job.completedAt ?? null,
          },
        })
      },
    },
  },
  component: () => null,
})
