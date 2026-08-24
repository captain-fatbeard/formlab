import { useMemo } from 'react'
import { useDashboard } from '~/lib/dashboard-context'
import { fitnessSeries } from '~/lib/fitness'
import { weekChanges } from '~/lib/week-changes'
import { MetricTerm } from './MetricTerm'

const toneClasses: Record<string, string> = {
  up: 'text-success',
  down: 'text-warning',
  flat: 'text-text-muted',
}

/**
 * What moved this week.
 *
 * The app computes CTL, TSB, weekly load and weight trends and used to open on
 * a page of lifetime totals — the same figures every day. This answers a
 * question instead of listing sums, and every tile names its own window.
 */
export function WeekChanges() {
  const { lifetimeMergedActivities, profile, weightEntries } = useDashboard()

  const fitness = useMemo(
    () => fitnessSeries(lifetimeMergedActivities, profile),
    [lifetimeMergedActivities, profile]
  )
  const changes = useMemo(
    () => weekChanges(lifetimeMergedActivities, fitness, weightEntries),
    [lifetimeMergedActivities, fitness, weightEntries]
  )

  if (changes.length === 0) return null

  return (
    <section>
      <h2 className="text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold mb-3">
        This week
      </h2>
      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
        {changes.map((change) => (
          <div
            key={change.id}
            className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-md)] p-4 flex flex-col gap-1"
          >
            <span className="text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold">
              {change.id === 'form' ? <MetricTerm id="tsb">Form</MetricTerm> : change.label}
            </span>
            <span className="flex items-baseline gap-2">
              <span className="data-value text-xl font-medium text-text-primary">{change.value}</span>
              {change.delta && (
                <span className={`data-value text-[0.8125rem] font-medium ${toneClasses[change.tone]}`}>
                  {change.delta}
                </span>
              )}
            </span>
            <span className="text-[0.75rem] text-text-muted">{change.hint}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
