import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { getJobStatus } from '#/lib/csv-import.server'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/jobs/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const id = z.string().uuid().parse(params.id)
        const job = await getJobStatus(id)

        if (!job) return json({ error: 'not_found' }, 404)

        return json({ job })
      },
    },
  },
  component: () => null,
})
