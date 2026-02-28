import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { queryOptions } from '@tanstack/react-query'

export type ImportJobStatus = 'queued' | 'processing' | 'done' | 'failed'

export type ImportJobStatusResult = {
  jobId: string
  status: ImportJobStatus
  /** Overall progress percentage 0–100 */
  progress: number
  /** Human-readable status message */
  message: string
  /** Total rows in the CSV (available once parsing begins) */
  totalRows?: number
  /** Rows processed so far */
  processedRows?: number
}

const getImportJobStatusSchema = z.object({
  jobId: z.string().uuid(),
})

/**
 * In-memory store simulating Redis job state for the stub.
 * Each jobId gets a start timestamp so we can progress it over time.
 *
 * TODO: Replace with real Redis reads:
 *  - HGETALL `import:job:<jobId>` → { status, progress, totalRows, processedRows, message }
 */
const jobStartTimes = new Map<string, number>()

/**
 * TODO: Replace stub logic with real implementation:
 *  1. Read job state from Redis key `import:job:<jobId>`
 *  2. Return { status, progress, totalRows, processedRows, message }
 *  3. The worker (BullMQ processor) writes updates to Redis as it processes rows
 */
export const getImportJobStatus = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => getImportJobStatusSchema.parse(input))
  .handler(async ({ data }): Promise<ImportJobStatusResult> => {
    const { jobId } = data

    // Stub: simulate progress over ~12 seconds since the job was first polled
    if (!jobStartTimes.has(jobId)) {
      jobStartTimes.set(jobId, Date.now())
    }

    const elapsed = Date.now() - jobStartTimes.get(jobId)!
    const totalRows = 500

    if (elapsed < 1500) {
      return {
        jobId,
        status: 'queued',
        progress: 0,
        message: 'Waiting in queue…',
        totalRows,
        processedRows: 0,
      }
    }

    if (elapsed < 10000) {
      const processedRows = Math.min(
        Math.floor(((elapsed - 1500) / 8500) * totalRows),
        totalRows,
      )
      const progress = Math.round((processedRows / totalRows) * 100)
      return {
        jobId,
        status: 'processing',
        progress,
        message: `Processing rows… (${processedRows} / ${totalRows})`,
        totalRows,
        processedRows,
      }
    }

    // Clean up stub memory after job completes
    jobStartTimes.delete(jobId)

    return {
      jobId,
      status: 'done',
      progress: 100,
      message: `Successfully imported ${totalRows} orders.`,
      totalRows,
      processedRows: totalRows,
    }
  })

// ─── TanStack Query options ────────────────────────────────────────────────────

export function importJobStatusQueryOptions(jobId: string | null) {
  return queryOptions({
    queryKey: ['import-job-status', jobId],
    queryFn: () => getImportJobStatus({ data: { jobId: jobId! } }),
    enabled: jobId !== null,
    // Stop refetching once the job reaches a terminal state
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'done' || status === 'failed') return false
      return 2000
    },
  })
}
