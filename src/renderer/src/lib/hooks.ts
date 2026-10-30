import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export interface DraftState<T> {
  draft: T
  setDraft: Dispatch<SetStateAction<T>>
  reset: (next?: T) => void
  dirty: boolean
}

/**
 * Local editing copy of a server value. It intentionally does not reset on
 * background refetches, so a running worker cannot overwrite an unsaved draft.
 */
export function useDraft<T>(source: T): DraftState<T> {
  const [draft, setDraft] = useState<T>(source)
  const initial = useRef(source)
  const reset = useCallback(
    (next?: T) => {
      const value = next === undefined ? initial.current : next
      initial.current = value
      setDraft(value)
    },
    []
  )
  const dirty = JSON.stringify(draft) !== JSON.stringify(source)
  return { draft, setDraft, reset, dirty }
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial)
  const show = useCallback(() => setOpen(true), [])
  const hide = useCallback(() => setOpen(false), [])
  return { open, setOpen, show, hide }
}
