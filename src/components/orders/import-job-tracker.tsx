'use client'

import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useImportJob } from '#/lib/import-job-context'
import { importJobStatusQueryOptions } from '#/lib/csv-import.queries'

/**
 * Headless component that keeps the import job polling alive and handles
 * terminal-state side effects (orders invalidation, context reset) regardless
 * of whether the ImportCsvDialog is open.
 *
 * Mount once inside <ImportJobProvider> — it renders nothing.
 */
export function ImportJobTracker() {
  const queryClient = useQueryClient()
  const { activeJobId, setActiveJobId } = useImportJob()

  const { data } = useQuery(importJobStatusQueryOptions(activeJobId))
  const status = data?.status

  const prevStatus = useRef<typeof status>(undefined)

  useEffect(() => {
    if (prevStatus.current === status) return
    prevStatus.current = status

    if (status === 'done') {
      void queryClient.invalidateQueries({ queryKey: ['orders'] })
      // Auto-clear the active job after a short delay so the progress toast
      // has time to transition to success before everything resets.
      const timer = setTimeout(() => setActiveJobId(null), 4000)
      return () => clearTimeout(timer)
    }

    if (status === 'failed') {
      // Give the error toast a moment to appear, then clear the job context.
      const timer = setTimeout(() => setActiveJobId(null), 6000)
      return () => clearTimeout(timer)
    }
  }, [status, queryClient, setActiveJobId])

  return null
}
