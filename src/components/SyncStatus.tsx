import { useEffect, useState } from 'react'
import { formatRelativeTime } from '~/lib/format'

interface SyncStatusProps {
  /** When the last successful sync committed, or null if none yet this session. */
  lastSyncedAt: number | null
  isSyncing: boolean
  onSync: () => void
}

/**
 * A quiet "synced 4 min ago" in the top bar. Sync runs in the background on
 * load and on refocus, and the only surface for it used to be a button inside
 * the settings drawer — so a number that looked stale had nothing to check
 * itself against.
 */
export function SyncStatus({ lastSyncedAt, isSyncing, onSync }: SyncStatusProps) {
  const [, setTick] = useState(0)

  // "4 min ago" has to keep being true.
  useEffect(() => {
    if (lastSyncedAt == null) return
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(id)
  }, [lastSyncedAt])

  const label = isSyncing
    ? 'Syncing…'
    : lastSyncedAt == null
      ? 'Not synced yet'
      : `Synced ${formatRelativeTime(lastSyncedAt)}`

  return (
    <button
      type="button"
      onClick={onSync}
      disabled={isSyncing}
      title="Sync new activities from intervals.icu"
      className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[0.75rem] font-medium text-text-muted border border-transparent cursor-pointer transition-colors duration-150 hover:text-text-secondary hover:border-border disabled:cursor-progress max-md:hidden"
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
        className={isSyncing ? 'animate-spin' : ''}
      >
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  )
}
