import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { processImportFile, markJobCancelled } from '#/lib/csv-import.server'

export const uploadCsvFileSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
})

export type UploadCsvFileInput = z.infer<typeof uploadCsvFileSchema>

export type UploadCsvFileResult = {
  jobId: string
}

export const uploadCsvFile = createServerFn({ method: 'POST' })
  .inputValidator(uploadCsvFileSchema)
  .handler(async ({ data }): Promise<UploadCsvFileResult> => {
    // Decode base64 content back to a File object
    const binaryStr = atob(data.content)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    const file = new File([bytes], data.filename, { type: 'text/csv' })

    // Use PUBLIC_BASE_URL or fall back to localhost for dev
    const baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'

    const jobId = await processImportFile(file, 500, baseUrl)

    return { jobId }
  })

// ─── Cancel an in-progress import job ─────────────────────────────────────────

const cancelImportJobSchema = z.object({
  jobId: z.string().uuid(),
})

export const cancelImportJob = createServerFn({ method: 'POST' })
  .inputValidator(cancelImportJobSchema)
  .handler(async ({ data }) => {
    await markJobCancelled(data.jobId)
    return { success: true }
  })
