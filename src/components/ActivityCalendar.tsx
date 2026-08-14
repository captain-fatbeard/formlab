import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { type StravaActivity, metersToKm, secondsToHMS } from '~/lib/strava'
import { useDashboard } from '~/lib/dashboard-context'
import { fitnessSeries } from '~/lib/fitness'
import {
  DAY_LABELS,
  buildActivityCalendar,
  type CalendarDay,
  type CalendarMetric,
} from '~/lib/activity-calendar'
import { sectionCard } from '~/lib/styles'
import { pageRange } from '~/components/Pagination'

interface ActivityCalendarProps {
  activities: StravaActivity[]
}

/**
 * Sequential ramp — one hue, monotone lightness, dark-anchored for a dark
 * surface. Ordinal checks pass: monotone L, adjacent ΔL ≥ 0.06, dark end above
 * the contrast floor against both the card and the empty-day tone.
 *
 * Six steps rather than four. With four, the top band covered everything above
 * the 75th percentile, so a 160 km epic and a 50 km ride drew the same colour.
 * The extra steps only help paired with the tail-weighted cutoffs in
 * LEVEL_QUANTILES — more bands over a flat split would just have subdivided the
 * ordinary days.
 *
 * The near-white top is deliberate and depends on that rarity. At a quarter of
 * all days it read as "selected" and lost the teal identity; at the top 5% it
 * reads as "that was the big one", which is the signal wanted.
 *
 * Level 0 is a recessive surface tone, not a ramp step: an empty day is absence
 * of data, not the smallest amount of it.
 */
const LEVEL_FILL = [
  'var(--color-bg-tertiary)',
  '#115e59',
  '#0d9488',
  '#14b8a6',
  '#2dd4bf',
  '#5eead4',
  '#ccfbf1',
] as const

const METRICS: Array<{ id: CalendarMetric; label: string }> = [
  { id: 'load', label: 'Load' },
  { id: 'time', label: 'Time' },
]

function formatHours(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

/**
 * Year selector in the shape of the app's pagination: newest and oldest are
 * always reachable, the current year sits between its neighbours, and anything
 * further away collapses into a gap. A rider with ten seasons shouldn't get ten
 * buttons.
 */
function YearPager({
  years, selected, onSelect,
}: {
  years: string[]
  selected: string
  onSelect: (year: string) => void
}) {
  if (years.length <= 1) return null

  // years is newest-first, so index 0 is "page 1".
  const current = Math.max(1, years.indexOf(selected) + 1)
  const btnBase =
    'inline-flex items-center justify-center min-w-8 h-7 px-2 text-xs font-medium rounded-[var(--radius-sm)] border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'
  const btnIdle =
    'bg-bg-tertiary border-border-subtle text-text-secondary hover:bg-bg-elevated hover:text-text-primary hover:border-border'
  const btnActive = 'bg-accent/20 border-accent/40 text-accent'

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        type="button"
        className={`${btnBase} ${btnIdle}`}
        onClick={() => onSelect(years[current - 2])}
        disabled={current <= 1}
        aria-label="Later year"
      >
        ‹
      </button>
      {pageRange(current, years.length).map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} className="text-xs text-text-muted px-0.5">…</span>
        ) : (
          <button
            key={years[p - 1]}
            type="button"
            className={`${btnBase} ${p === current ? btnActive : btnIdle}`}
            onClick={() => onSelect(years[p - 1])}
            aria-current={p === current ? 'true' : undefined}
          >
            {years[p - 1]}
          </button>
        )
      )}
      <button
        type="button"
        className={`${btnBase} ${btnIdle}`}
        onClick={() => onSelect(years[current])}
        disabled={current >= years.length}
        aria-label="Earlier year"
      >
        ›
      </button>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.65rem] uppercase tracking-wider font-semibold text-text-muted">{label}</span>
      <span className="data-value text-xl font-medium text-text-primary leading-tight">{value}</span>
      {hint && <span className="text-[0.65rem] text-text-muted">{hint}</span>}
    </div>
  )
}

export function ActivityCalendar({ activities }: ActivityCalendarProps) {
  const { profile } = useDashboard()
  const [metric, setMetric] = useState<CalendarMetric>('load')
  const [hovered, setHovered] = useState<CalendarDay | null>(null)

  const years = useMemo(() => {
    const set = new Set<string>()
    for (const a of activities) set.add(a.start_date_local.slice(0, 4))
    return Array.from(set).sort().reverse()
  }, [activities])

  // Calendar years, newest first. Defaults to the most recent year with data.
  // Falls back to this year so the hooks below stay safe before data lands.
  const [selectedYear, setSelectedYear] = useState<string | null>(null)
  const year = selectedYear ?? years[0] ?? String(new Date().getFullYear())

  const fitness = useMemo(() => fitnessSeries(activities, profile), [activities, profile])

  const calendar = useMemo(() => {
    // Always the whole year, so every year draws at the same size and a season
    // in progress doesn't render wider cells than a finished one. Days that
    // haven't happened are dimmed rather than omitted.
    const from = new Date(`${year}-01-01T00:00:00`)
    const to = new Date(`${year}-12-31T00:00:00`)
    return buildActivityCalendar(activities, fitness, from, to, metric)
  }, [activities, fitness, year, metric])

  const { summary } = calendar
  const consistency = summary.days > 0 ? Math.round((summary.activeDays / summary.days) * 100) : 0

  if (activities.length === 0) return null

  return (
    <div className={sectionCard}>
      <div className="flex justify-between items-start gap-4 mb-6 flex-wrap">
        <div>
          <h3 className="text-lg font-semibold text-text-primary max-[480px]:text-base">Training calendar</h3>
          <p className="text-[0.8rem] text-text-secondary mt-0.5">
            {summary.activeDays} active {summary.activeDays === 1 ? 'day' : 'days'} of {summary.days}
            {' · '}
            <span className="text-text-muted">shaded by {metric === 'load' ? 'training load' : 'time'}</span>
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <div className="flex gap-1 bg-bg-tertiary rounded-[var(--radius-sm)] p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetric(m.id)}
                aria-pressed={metric === m.id}
                className={`text-[0.7rem] font-semibold px-2.5 py-1 rounded-[var(--radius-sm)] transition-colors ${
                  metric === m.id ? 'bg-accent text-bg-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <YearPager years={years} selected={year} onSelect={setSelectedYear} />
        </div>
      </div>

      {/* Grid. Columns are 1fr so the cells stretch to whatever width the page
          gives them — a year is a fixed 53 columns, so there's no reason to
          leave half the card empty. `minmax(0.5rem, 1fr)` keeps a hit target
          worth aiming at on narrow screens, and the container scrolls rather
          than squashing below that. */}
      <div className="overflow-x-auto pb-1">
        <div className="flex flex-col gap-1 min-w-[560px]">
          {/* Month axis */}
          <div
            className="grid gap-[3px] ml-[34px]"
            style={{ gridTemplateColumns: `repeat(${calendar.weeks.length}, minmax(0.5rem, 1fr))` }}
          >
            {calendar.weeks.map((_, i) => {
              const label = calendar.monthLabels.find((m) => m.weekIndex === i)
              return (
                <div key={i} className="min-w-0">
                  {label && (
                    <span className="text-[0.6rem] text-text-muted whitespace-nowrap">{label.label}</span>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex gap-[3px]">
            {/* Weekday axis — every other row, so the labels don't crowd.
                Rows share the cells' aspect-ratio height via the same grid. */}
            <div className="grid grid-rows-7 gap-[3px] w-[31px] shrink-0">
              {DAY_LABELS.map((d, i) => (
                <div key={d} className="flex items-center">
                  {i % 2 === 1 && <span className="text-[0.6rem] text-text-muted leading-none">{d}</span>}
                </div>
              ))}
            </div>

            <div
              className="grid grid-rows-7 grid-flow-col gap-[3px] flex-1 min-w-0"
              style={{ gridTemplateColumns: `repeat(${calendar.weeks.length}, minmax(0.5rem, 1fr))` }}
            >
              {calendar.weeks.map((week, wi) =>
                week.map((day, di) => {
                  if (!day) return <div key={`${wi}-${di}`} className="aspect-square" />

                  // A day that hasn't happened is drawn faintly and isn't
                  // interactive — it keeps the year's shape without inviting a
                  // hover that has nothing to show.
                  if (day.isFuture) {
                    return (
                      <div
                        key={`${wi}-${di}`}
                        aria-hidden="true"
                        className="aspect-square w-full rounded-[3px] opacity-25"
                        style={{ backgroundColor: LEVEL_FILL[0] }}
                      />
                    )
                  }

                  const isHovered = hovered?.date === day.date
                  return (
                    <button
                      key={`${wi}-${di}`}
                      type="button"
                      onMouseEnter={() => setHovered(day)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(day)}
                      onBlur={() => setHovered(null)}
                      aria-label={`${day.date}: ${day.count} ${day.count === 1 ? 'activity' : 'activities'}, ${formatHours(day.movingTime)}, ${Math.round(day.load)} load`}
                      className="aspect-square w-full rounded-[3px] transition-transform hover:scale-110 focus:scale-110 focus:outline-none"
                      style={{
                        backgroundColor: LEVEL_FILL[day.level],
                        // 2px surface ring on the hovered mark, per mark specs
                        boxShadow: isHovered ? '0 0 0 2px var(--color-bg-secondary), 0 0 0 3px var(--color-accent)' : undefined,
                      }}
                    />
                  )
                })
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-1.5 ml-[34px] mt-1">
            <span className="text-[0.6rem] text-text-muted mr-1">Less</span>
            {LEVEL_FILL.map((fill, i) => (
              <div key={i} className="size-3 rounded-[3px]" style={{ backgroundColor: fill }} />
            ))}
            <span className="text-[0.6rem] text-text-muted ml-1">More</span>
          </div>
        </div>
      </div>

      {/* Hover detail — reserves one line so the layout doesn't jump, and grows
          for a day with several activities */}
      <div className="mt-4 min-h-[2.25rem] border-t border-border-subtle pt-3">
        {hovered ? (
          <div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-sm font-semibold text-text-primary">
                {new Date(`${hovered.date}T00:00:00`).toLocaleDateString(undefined, {
                  weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                })}
              </span>
              {hovered.count === 0 ? (
                <span className="text-xs text-text-muted">Rest day</span>
              ) : (
                <span className="text-xs text-text-secondary data-value">
                  {formatHours(hovered.movingTime)} · {metersToKm(hovered.distance).toFixed(1)} km
                  {hovered.elevation > 0 && ` · ${Math.round(hovered.elevation)} m`}
                  {hovered.load > 0 && ` · ${Math.round(hovered.load)} load`}
                </span>
              )}
            </div>
            {hovered.count > 0 && (
              <div className="flex flex-col gap-0.5 mt-1">
                {hovered.activities.map((a) => (
                  <Link
                    key={a.id}
                    to="/activities/$activityId"
                    params={{ activityId: String(a.id) }}
                    className="text-xs text-text-muted hover:text-accent no-underline w-fit"
                  >
                    {a.name} <span className="data-value">· {secondsToHMS(a.moving_time)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-muted">Hover a day for detail.</p>
        )}
      </div>

      {/* Period summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mt-5 pt-5 border-t border-border-subtle">
        <Tile
          label="Activities"
          value={String(summary.activities)}
          hint={`${consistency}% of days active`}
        />
        <Tile
          label="Time"
          value={formatHours(summary.movingTime)}
          hint={summary.activeDays > 0 ? `${formatHours(Math.round(summary.movingTime / summary.activeDays))} per active day` : undefined}
        />
        <Tile
          label="Distance"
          value={`${Math.round(metersToKm(summary.distance)).toLocaleString()} km`}
          hint={`${Math.round(summary.elevation).toLocaleString()} m climbed`}
        />
        <Tile
          label="Load"
          value={Math.round(summary.load).toLocaleString()}
          hint={summary.longestStreak > 0 ? `${summary.longestStreak}-day best streak` : undefined}
        />
      </div>
    </div>
  )
}
