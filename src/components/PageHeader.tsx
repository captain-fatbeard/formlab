import type { ReactNode } from 'react'
import { useDashboard } from '~/lib/dashboard-context'
import { TIME_RANGE_LABELS, ACTIVITY_TYPE_LABELS } from '~/lib/labels'
import { formatNumber } from '~/lib/format'
import { pageTitle } from '~/lib/styles'

interface PageHeaderProps {
  title: string
  /** One line on what the page is for. Plan and Bike Fit already had one and
   *  read as markedly more finished for it. */
  description?: string
  /**
   * What the figures below are scoped to:
   * - `global` — follows the top-bar Time Range and Activity Type pills
   * - `lifetime` — deliberately ignores them (Overview's all-time totals)
   * - `none` — the page states its own scope per card
   */
  scope?: 'global' | 'lifetime' | 'none'
  /** Number of activities behind the page, shown at the end of the scope line. */
  count?: number
  /** Plural noun for the count; the singular is derived, `-ies` included. */
  countNoun?: string
  /** Page-level controls, right-aligned against the title. */
  actions?: ReactNode
}

/** `activities` → `activity`, `rides` → `ride`. */
function singular(noun: string): string {
  if (noun.endsWith('ies')) return `${noun.slice(0, -3)}y`
  return noun.replace(/s$/, '')
}

export function PageHeader({
  title,
  description,
  scope = 'global',
  count,
  countNoun = 'activities',
  actions,
}: PageHeaderProps) {
  const { timeRange, activityType } = useDashboard()

  const parts: string[] = []
  if (scope === 'global') {
    parts.push(TIME_RANGE_LABELS[timeRange], ACTIVITY_TYPE_LABELS[activityType])
  } else if (scope === 'lifetime') {
    parts.push('All time', 'All activities')
  }
  if (count != null) {
    parts.push(`${formatNumber(count)} ${count === 1 ? singular(countNoun) : countNoun}`)
  }

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className={pageTitle}>{title}</h1>
        {description && (
          <p className="text-sm text-text-secondary mt-1.5 max-w-[68ch] leading-relaxed">
            {description}
          </p>
        )}
        {parts.length > 0 && (
          <p className="text-[0.75rem] text-text-muted mt-2 tracking-wide">
            {parts.join(' · ')}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  )
}
