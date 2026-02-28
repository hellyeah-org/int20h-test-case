'use client'

import { toast } from 'sonner'

import type { ImportJobStatusResult } from '#/lib/csv-import.queries'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max individual error toasts before switching to a grouped one. */
const MAX_INDIVIDUAL_ERRORS = 5

/** Sonner toast ID for the grouped error toast. */
const GROUPED_ERROR_TOAST_ID = 'import-errors-grouped'

// ─── State ────────────────────────────────────────────────────────────────────

/** Tracks all individual error toast IDs so we can dismiss them on grouping. */
const errorToastIds: Array<string | number> = []
let errorCount = 0

// ─── Progress toast ───────────────────────────────────────────────────────────

/**
 * Fire a persistent loading toast for an in-flight import job.
 * Returns the toast ID so callers can update / dismiss it later.
 */
export function showImportProgressToast(
  jobId: string,
  onCancel: () => void,
): string | number {
  const id = `import-progress-${jobId}`
  toast.loading('Import queued…', {
    id,
    duration: Infinity,
    action: {
      label: 'Stop',
      onClick: onCancel,
    },
  })
  return id
}

/**
 * Update the persistent progress toast as poll data arrives.
 * Transitions to success/error when the job reaches a terminal state.
 */
export function updateImportProgressToast(
  toastId: string | number,
  data: ImportJobStatusResult,
  onCancel: () => void,
): void {
  if (data.status === 'done') {
    toast.success(data.message, {
      id: toastId,
      duration: 4000,
    })
    return
  }

  if (data.status === 'failed') {
    toast.error(data.message, {
      id: toastId,
      duration: Infinity,
      action: {
        label: 'Dismiss',
        onClick: () => toast.dismiss(toastId),
      },
    })
    return
  }

  // Still in progress — keep the loading toast alive
  const progressLabel =
    data.status === 'processing' && data.totalRows
      ? `Importing… ${data.processedRows ?? 0} / ${data.totalRows} rows`
      : data.message

  toast.loading(progressLabel, {
    id: toastId,
    duration: Infinity,
    action: {
      label: 'Stop',
      onClick: onCancel,
    },
  })
}

/**
 * Dismiss the persistent progress toast (e.g. when the dialog resets without
 * ever starting a job, or when the job context is cleared externally).
 */
export function dismissImportProgressToast(toastId: string | number): void {
  toast.dismiss(toastId)
}

// ─── Error toasts ─────────────────────────────────────────────────────────────

/**
 * Show an import error toast.
 *
 * - First 5 calls: individual `toast.error` toasts.
 * - 6th call onward: creates/updates a single grouped toast showing the total
 *   count with a "Dismiss all" action that clears every tracked error toast.
 */
export function showImportErrorToast(message: string): void {
  errorCount++

  if (errorCount <= MAX_INDIVIDUAL_ERRORS) {
    const id = toast.error(message, { duration: 6000 })
    errorToastIds.push(id)
    return
  }

  // We're past the limit — move to the grouped toast.
  // Dismiss all individual toasts on the first overflow.
  if (errorCount === MAX_INDIVIDUAL_ERRORS + 1) {
    for (const id of errorToastIds) {
      toast.dismiss(id)
    }
  }

  toast.error(`${errorCount} import errors occurred`, {
    id: GROUPED_ERROR_TOAST_ID,
    duration: Infinity,
    description: message,
    action: {
      label: 'Dismiss all',
      onClick: () => {
        toast.dismiss(GROUPED_ERROR_TOAST_ID)
        resetImportErrorState()
      },
    },
  })
}

/**
 * Reset error tracking state. Call this when a new import job starts so the
 * counter is clean for the next run.
 */
export function resetImportErrorState(): void {
  errorCount = 0
  errorToastIds.length = 0
  toast.dismiss(GROUPED_ERROR_TOAST_ID)
}
