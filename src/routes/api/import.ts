import { createFileRoute } from '@tanstack/react-router'

import {
  ImportQuerySchema,
  processImportFile,
} from '#/lib/csv-import.server'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
          if (!(f instanceof File))
            return json({ error: 'file_required' }, 400)

          const baseUrl =
            process.env.PUBLIC_BASE_URL ?? new URL(request.url).origin

          const jobId = await processImportFile(f, q.batchSize, baseUrl)
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
