import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { queryOptions } from '@tanstack/react-query'

import { getJobStatus } from '#/lib/csv-import.server'

export type ImportJobStatus = 'queued' | 'processing' | 'done' | 'failed'

export type ImportJobStatusResult = {
  jobId: string
  status: ImportJobStatus
  /** Overall progress percentage 0-100 */
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
 * Map backend status strings to the frontend's ImportJobStatus union.
 */
function mapBackendStatus(backendStatus: string): ImportJobStatus {
  switch (backendStatus) {
    case 'PENDING':
      return 'queued'
    case 'PROCESSING':
      return 'processing'
    case 'COMPLETED':
      return 'done'
    case 'FAILED':
      return 'failed'
    default:
      return 'processing'
  }
}

export const getImportJobStatus = createServerFn({ method: 'GET' })
  .inputValidator(getImportJobStatusSchema)
  .handler(async ({ data }): Promise<ImportJobStatusResult> => {
    const { jobId } = data

    const job = await getJobStatus(jobId)

    if (!job) {
      return {
        jobId,
        status: 'failed',
        progress: 0,
        message: 'Job not found.',
      }
    }

    const status = mapBackendStatus(job.status)
    const total = job.total
    const processed = job.processed

    let progress = 0
    if (total > 0) {
      progress = Math.round((processed / total) * 100)
    }

    let message: string
    switch (status) {
      case 'queued':
        message = 'Waiting in queue\u2026'
        break
      case 'processing':
        message = `Processing rows\u2026 (${processed} / ${total})`
        break
      case 'done':
        message = `Successfully imported ${processed} orders.`
        break
      case 'failed':
        message = `Import failed. ${job.failed} rows failed out of ${total}.`
        break
      default:
        message = 'Unknown status.'
    }

    return {
      jobId,
      status,
      progress,
      message,
      totalRows: total,
      processedRows: processed,
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
