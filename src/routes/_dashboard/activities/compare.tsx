import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useDashboard } from '~/lib/dashboard-context'
import { type StravaActivity, metersToKm } from '~/lib/strava'
import { calculateTSS, isRun } from '~/lib/tss'
import {
  formatNumber,
  formatDistance,
  formatElevation,
  formatDuration,
  formatTempo,
  formatDateFull,
} from '~/lib/format'
import { PageHeader } from '~/components/PageHeader'
import { MetricTerm } from '~/components/MetricTerm'
import { sectionCard, buttonSecondary } from '~/lib/styles'

export const Route = createFileRoute('/_dashboard/activities/compare')({
  head: () => ({ meta: [{ title: 'Compare activities · FormLab' }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    a: search.a != null && Number(search.a) ? Number(search.a) : undefined,
    b: search.b != null && Number(search.b) ? Number(search.b) : undefined,
  }),
  component: CompareActivitiesPage,
})

interface Row {
  label: React.ReactNode
  /** Raw values, for the delta; null when the activity has no such figure. */
  values: [number | null, number | null]
  format: (value: number) => string
  /** How to render the difference, when the value's own unit won't do — the
   *  difference between two paces is a speed, not a pace. */
  deltaFormat?: (value: number) => string
  /** Which direction counts as better, for the delta's colour. */
  better: 'higher' | 'lower' | 'neither'
}

function ActivityPicker({
  label,
  activities,
  value,
  onChange,
}: {
  label: string
  activities: StravaActivity[]
  value: number | undefined
  onChange: (id: number | undefined) => void
}) {
  const id = `compare-${label.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <div className="flex flex-col gap-2 min-w-0 flex-1">
      <label htmlFor={id} className="text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold">
        {label}
      </label>
      <select
        id={id}
        className="custom-select w-full bg-bg-tertiary border border-border text-text-primary py-2.5 pr-10 pl-4 rounded-[var(--radius-sm)] text-sm cursor-pointer transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      >
        <option value="">Choose an activity…</option>
        {activities.map((activity) => (
          <option key={activity.id} value={activity.id}>
            {formatDateFull(activity.start_date_local)} — {activity.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function CompareActivitiesPage() {
  const { activities, tssThresholds } = useDashboard()
  const { a, b } = Route.useSearch()
  const navigate = Route.useNavigate()

  const sorted = useMemo(
    () =>
      [...activities].sort(
        (x, y) => new Date(y.start_date_local).getTime() - new Date(x.start_date_local).getTime()
      ),
    [activities]
  )

  const left = sorted.find((activity) => activity.id === a)
  const right = sorted.find((activity) => activity.id === b)

  const rows = useMemo<Row[]>(() => {
    if (!left || !right) return []

    const sport = isRun(left) && isRun(right) ? ('run' as const) : ('ride' as const)
    const pair = <T,>(read: (activity: StravaActivity) => T): [T, T] => [read(left), read(right)]

    return [
      {
        label: 'Distance',
        values: pair((x) => metersToKm(x.distance)),
        format: (v) => `${formatDistance(v)} km`,
        better: 'neither',
      },
      {
        label: 'Moving time',
        values: pair((x) => x.moving_time),
        format: formatDuration,
        better: 'neither',
      },
      {
        label: sport === 'run' ? 'Pace' : 'Speed',
        // Compared as speed either way, so the delta means the same thing for
        // both sports even when the display unit is a pace.
        values: pair((x) => (x.moving_time > 0 ? x.distance / x.moving_time : null)),
        format: (metresPerSecond) => formatTempo(metresPerSecond * 3600, 3600, sport),
        deltaFormat: (metresPerSecond) => `${formatNumber(metresPerSecond * 3.6, 1)} km/h`,
        better: 'higher',
      },
      {
        label: 'Elevation',
        values: pair((x) => x.total_elevation_gain),
        format: (v) => `${formatElevation(v)} m`,
        better: 'neither',
      },
      {
        label: 'Avg power',
        values: pair((x) => x.average_watts ?? null),
        format: (v) => `${formatNumber(v)} W`,
        better: 'higher',
      },
      {
        label: <MetricTerm id="np">Normalised power</MetricTerm>,
        values: pair((x) => x.weighted_average_watts ?? null),
        format: (v) => `${formatNumber(v)} W`,
        better: 'higher',
      },
      {
        label: 'Avg HR',
        values: pair((x) => x.average_heartrate ?? null),
        format: (v) => `${formatNumber(v)} bpm`,
        better: 'lower',
      },
      {
        label: 'Max HR',
        values: pair((x) => x.max_heartrate ?? null),
        format: (v) => `${formatNumber(v)} bpm`,
        better: 'neither',
      },
      {
        label: <MetricTerm id="ef">Efficiency factor</MetricTerm>,
        values: pair((x) => {
          const power = x.weighted_average_watts || x.average_watts
          return power && x.average_heartrate ? power / x.average_heartrate : null
        }),
        format: (v) => formatNumber(v, 2),
        better: 'higher',
      },
      {
        label: <MetricTerm id="tss">Training load</MetricTerm>,
        values: pair((x) => calculateTSS(x, tssThresholds) || null),
        format: (v) => `${formatNumber(v)} TSS`,
        better: 'neither',
      },
    ]
  }, [left, right, tssThresholds])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Compare activities"
        description="Two rides or runs side by side — pace, power, heart rate and load, with the difference spelled out."
        scope="none"
        actions={
          <Link to="/activities" className={buttonSecondary}>
            Back to activities
          </Link>
        }
      />

      <div className={`${sectionCard} flex gap-5 items-end max-md:flex-col max-md:items-stretch`}>
        <ActivityPicker
          label="First activity"
          activities={sorted}
          value={a}
          onChange={(id) => navigate({ search: (prev) => ({ ...prev, a: id }) })}
        />
        <button
          type="button"
          aria-label="Swap the two activities"
          title="Swap"
          className={`${buttonSecondary} shrink-0 mb-0.5 max-md:w-full`}
          onClick={() => navigate({ search: () => ({ a: b, b: a }) })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 16H3m0 0 3-3m-3 3 3 3" />
            <path d="M17 8h4m0 0-3-3m3 3-3 3" />
          </svg>
          Swap
        </button>
        <ActivityPicker
          label="Second activity"
          activities={sorted}
          value={b}
          onChange={(id) => navigate({ search: (prev) => ({ ...prev, b: id }) })}
        />
      </div>

      {!left || !right ? (
        <div className={`${sectionCard} text-center py-16 text-text-muted text-[0.9rem]`}>
          Pick two activities to compare them.
        </div>
      ) : (
        <div className="bg-bg-secondary rounded-[var(--radius-lg)] border border-border-subtle overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="text-left p-4 px-5 bg-bg-tertiary text-text-muted font-semibold uppercase text-[0.75rem] tracking-wider first:rounded-tl-[var(--radius-lg)]">
                  Metric
                </th>
                {[left, right].map((activity) => (
                  <th
                    key={activity.id}
                    className="text-right p-4 px-5 bg-bg-tertiary font-semibold text-[0.75rem] tracking-wider max-w-[220px]"
                  >
                    <Link
                      to="/activities/$activityId"
                      params={{ activityId: String(activity.id) }}
                      className="text-text-primary no-underline hover:text-accent block truncate"
                      title={activity.name}
                    >
                      {activity.name}
                    </Link>
                    <span className="block text-text-muted font-normal normal-case tracking-normal">
                      {formatDateFull(activity.start_date_local)}
                    </span>
                  </th>
                ))}
                <th className="text-right p-4 px-5 bg-bg-tertiary text-text-muted font-semibold uppercase text-[0.75rem] tracking-wider last:rounded-tr-[var(--radius-lg)]">
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const [x, y] = row.values
                const delta = x != null && y != null ? y - x : null
                const tone =
                  delta == null || row.better === 'neither' || Math.abs(delta) < 1e-9
                    ? 'text-text-muted'
                    : (delta > 0) === (row.better === 'higher')
                      ? 'text-success'
                      : 'text-warning'

                return (
                  <tr key={i} className="hover:[&_td]:bg-bg-tertiary last:[&_td]:border-b-0">
                    <td className="p-4 px-5 border-b border-border-subtle text-text-secondary">{row.label}</td>
                    <td className="p-4 px-5 border-b border-border-subtle text-right data-value">
                      {x != null ? row.format(x) : '–'}
                    </td>
                    <td className="p-4 px-5 border-b border-border-subtle text-right data-value">
                      {y != null ? row.format(y) : '–'}
                    </td>
                    <td className={`p-4 px-5 border-b border-border-subtle text-right data-value ${tone}`}>
                      {delta == null
                        ? '–'
                        : `${delta > 0 ? '+' : '−'}${(row.deltaFormat ?? row.format)(Math.abs(delta))}`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
