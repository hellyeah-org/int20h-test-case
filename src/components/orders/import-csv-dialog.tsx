'use client'

import { useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2Icon,
  FileTextIcon,
  Loader2Icon,
  UploadCloudIcon,
  XCircleIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import type { ImportJobStatus } from '#/lib/csv-import.queries'
import { uploadCsvFile } from '#/lib/csv-import.mutations'
import { importJobStatusQueryOptions } from '#/lib/csv-import.queries'
import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import { Progress } from '#/components/ui/progress'

// ─── Types ────────────────────────────────────────────────────────────────────

type ModalPhase = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

// ─── Status icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: ImportJobStatus }) {
  if (status === 'done')
    return <CheckCircle2Icon className="size-5 shrink-0 text-green-500" />
  if (status === 'failed')
    return <XCircleIcon className="text-destructive size-5 shrink-0" />
  return (
    <Loader2Icon className="text-muted-foreground size-5 shrink-0 animate-spin" />
  )
}

// ─── DropZone ─────────────────────────────────────────────────────────────────

interface DropZoneProps {
  file: File | null
  isDragging: boolean
  disabled: boolean
  onFileSelect: (file: File) => void
  onFileClear: () => void
  onDragEnter: () => void
  onDragLeave: () => void
}

function DropZone({
  file,
  isDragging,
  disabled,
  onFileSelect,
  onFileClear,
  onDragEnter,
  onDragLeave,
}: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    onDragLeave()
    if (disabled) return
    const dropped = e.dataTransfer.files[0]
    if (dropped && isCsvFile(dropped)) {
      onFileSelect(dropped)
    } else {
      toast.error('Only .csv files are accepted.')
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (selected) onFileSelect(selected)
    // Reset so the same file can be re-selected after clearing
    e.target.value = ''
  }

  if (file) {
    return (
      <div className="border-border flex items-center gap-3 rounded-lg border px-4 py-3">
        <FileTextIcon className="text-muted-foreground size-5 shrink-0" />
        <span className="flex-1 truncate text-sm">{file.name}</span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {formatFileSize(file.size)}
        </span>
        {!disabled && (
          <Button
            aria-label="Remove file"
            className="shrink-0"
            size="icon-xs"
            type="button"
            variant="ghost"
            onClick={onFileClear}
          >
            <XIcon />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      aria-disabled={disabled}
      className={cn(
        'border-border flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 transition-colors select-none',
        isDragging
          ? 'border-primary bg-primary/5'
          : 'hover:border-primary/60 hover:bg-accent/40',
        disabled && 'pointer-events-none opacity-50',
      )}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && inputRef.current?.click()}
      onDragEnter={(e) => {
        e.preventDefault()
        if (!disabled) onDragEnter()
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        onDragLeave()
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled)
          inputRef.current?.click()
      }}
    >
      <div
        className={cn(
          'bg-muted flex size-12 items-center justify-center rounded-full transition-colors',
          isDragging && 'bg-primary/10',
        )}
      >
        <UploadCloudIcon
          className={cn(
            'size-6 transition-colors',
            isDragging ? 'text-primary' : 'text-muted-foreground',
          )}
        />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">
          Drop your CSV here{' '}
          <span className="text-primary underline-offset-2 hover:underline">
            or click to browse
          </span>
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Only .csv files are accepted
        </p>
      </div>
      <input
        ref={inputRef}
        aria-hidden
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        type="file"
        onChange={handleInputChange}
      />
    </div>
  )
}

// ─── JobProgress ──────────────────────────────────────────────────────────────

function JobProgress({ jobId }: { jobId: string }) {
  const { data } = useQuery(importJobStatusQueryOptions(jobId))

  const status = data?.status ?? 'queued'
  const progress = data?.progress ?? 0
  const message = data?.message ?? 'Waiting in queue…'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <StatusIcon status={status} />
        <p className="text-sm">{message}</p>
      </div>
      <Progress value={progress} />
      <p className="text-muted-foreground text-right text-xs">{progress}%</p>
    </div>
  )
}

// ─── ImportCsvDialog ──────────────────────────────────────────────────────────

export function ImportCsvDialog() {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<ModalPhase>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Keep a ref to the active jobId so the status query can be started before
  // the state update re-renders.
  const jobStatusQuery = useQuery(importJobStatusQueryOptions(jobId))
  const jobStatus = jobStatusQuery.data?.status

  // Sync phase with job status changes coming from the polling query
  const prevJobStatus = useRef<typeof jobStatus>(undefined)
  if (jobStatus !== prevJobStatus.current) {
    prevJobStatus.current = jobStatus
    if (jobStatus === 'done' && phase === 'processing') setPhase('done')
    if (jobStatus === 'failed' && phase === 'processing') {
      setPhase('error')
      setErrorMessage(
        jobStatusQuery.data?.message ?? 'Processing failed. Please try again.',
      )
    }
  }

  const handleFileSelect = useCallback((selected: File) => {
    setFile(selected)
    setErrorMessage(null)
  }, [])

  const handleFileClear = useCallback(() => {
    setFile(null)
    setErrorMessage(null)
  }, [])

  async function handleUpload() {
    if (!file) return
    setPhase('uploading')
    setErrorMessage(null)

    try {
      const content = await readFileAsBase64(file)
      const result = await uploadCsvFile({
        data: { filename: file.name, content },
      })
      setJobId(result.jobId)
      setPhase('processing')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Upload failed. Please try again.'
      setErrorMessage(message)
      setPhase('error')
    }
  }

  function handleOpenChange(next: boolean) {
    // Prevent accidental close while uploading
    if (!next && phase === 'uploading') return
    setOpen(next)
    if (!next) resetState()
  }

  function resetState() {
    setPhase('idle')
    setFile(null)
    setJobId(null)
    setErrorMessage(null)
    setIsDragging(false)
  }

  const isProcessingInFlight =
    phase === 'processing' && jobStatus !== 'done' && jobStatus !== 'failed'

  const uploadDisabled = phase !== 'idle' && phase !== 'error'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UploadCloudIcon className="mr-1.5 size-4" />
          Import CSV
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Orders from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file to bulk-import orders. The file will be saved to
            S3 and processed in the background.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Drop zone — hidden once a job is running */}
          {(phase === 'idle' || phase === 'error') && (
            <DropZone
              disabled={uploadDisabled}
              file={file}
              isDragging={isDragging}
              onDragEnter={() => setIsDragging(true)}
              onDragLeave={() => setIsDragging(false)}
              onFileClear={handleFileClear}
              onFileSelect={handleFileSelect}
            />
          )}

          {/* Uploading spinner */}
          {phase === 'uploading' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2Icon className="text-primary size-8 animate-spin" />
              <p className="text-muted-foreground text-sm">
                Uploading{' '}
                <span className="text-foreground font-medium">
                  {file?.name}
                </span>
                …
              </p>
            </div>
          )}

          {/* Job progress — visible during and after processing */}
          {(phase === 'processing' || phase === 'done') && jobId && (
            <JobProgress jobId={jobId} />
          )}

          {/* Success message */}
          {phase === 'done' && (
            <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-400">
              <CheckCircle2Icon className="size-4 shrink-0" />
              Import complete. The table will reflect new data on the next
              refresh.
            </div>
          )}

          {/* Error message */}
          {(phase === 'error' ||
            (phase === 'processing' && jobStatus === 'failed')) &&
            errorMessage && (
              <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg px-4 py-3 text-sm">
                <XCircleIcon className="size-4 shrink-0" />
                {errorMessage}
              </div>
            )}
        </div>

        <DialogFooter>
          {/* In-flight warning */}
          {isProcessingInFlight && (
            <p className="text-muted-foreground mr-auto text-xs">
              Processing will continue in the background if you close this.
            </p>
          )}

          {/* Upload button — only shown before processing starts */}
          {(phase === 'idle' || phase === 'error') && (
            <Button disabled={!file} type="button" onClick={handleUpload}>
              Upload
            </Button>
          )}

          {/* Always-available close */}
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
          >
            {phase === 'done' ? 'Done' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isCsvFile(file: File): boolean {
  return (
    file.type === 'text/csv' ||
    file.type === 'application/vnd.ms-excel' ||
    file.name.toLowerCase().endsWith('.csv')
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Strip the data URL prefix (e.g. "data:text/csv;base64,")
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
