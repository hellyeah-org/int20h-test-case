'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'

// ─── Context shape ────────────────────────────────────────────────────────────

interface ImportJobContextValue {
  /** The currently active import job ID (null = no import running). */
  activeJobId: string | null
  /** Set (or clear) the active import job. */
  setActiveJobId: (id: string | null) => void
}

const ImportJobContext = createContext<ImportJobContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ImportJobProvider({ children }: { children: React.ReactNode }) {
  const [activeJobId, setActiveJobIdRaw] = useState<string | null>(null)

  const setActiveJobId = useCallback((id: string | null) => {
    setActiveJobIdRaw(id)
  }, [])

  const value = useMemo<ImportJobContextValue>(
    () => ({ activeJobId, setActiveJobId }),
    [activeJobId, setActiveJobId],
  )

  return (
    <ImportJobContext.Provider value={value}>
      {children}
    </ImportJobContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useImportJob() {
  const ctx = useContext(ImportJobContext)
  if (!ctx) {
    throw new Error('useImportJob must be used within an <ImportJobProvider>')
  }
  return ctx
}
