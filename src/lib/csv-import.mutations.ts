import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

export const uploadCsvFileSchema = z.object({
  // Base64-encoded file content — placeholder until real S3 multipart upload is wired
  filename: z.string().min(1),
  content: z.string().min(1),
})

export type UploadCsvFileInput = z.infer<typeof uploadCsvFileSchema>

export type UploadCsvFileResult = {
  jobId: string
}

/**
 * TODO: Replace stub logic with real implementation:
 *  1. Decode base64 `content` and upload the raw CSV bytes to S3
 *  2. Push a job onto the Redis/BullMQ queue referencing the S3 key
 *  3. Store initial status { status: 'queued', progress: 0 } in Redis under the jobId
 *  4. Return the jobId so the client can poll getImportJobStatus
 */
export const uploadCsvFile = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => uploadCsvFileSchema.parse(input))
  .handler(async ({ data }): Promise<UploadCsvFileResult> => {
    // Stub: generate a random jobId and return it immediately.
    // The real implementation uploads to S3 and queues a worker job here.
    const jobId = crypto.randomUUID()

    console.log(
      `[csv-import] Stub upload received: filename=${data.filename}, jobId=${jobId}`,
    )

    return { jobId }
  })
