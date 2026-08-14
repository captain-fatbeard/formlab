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

interface ActivityCalendarProps {
  activities: StravaActivity[]
}

/**
 * Sequential ramp — one hue, monotone lightness, dark-anchored for a dark
 * surface. Ordinal checks: monotone L, adjacent ΔL ≥ 0.06, dark end 3.27:1
 * against the card surface, hue spread 6°, top step 14.2:1.
 *
 * The spread matters more than it looks. A tighter ramp (…#14b8a6, #2dd4bf)
 * also passes the numbers but collapses into roughly two visible states at
 * 11px, which defeats the point — the grid exists to show that a 3h endurance
 * day and a 40min spin are different. Steps 3 and 4 deliberately jump further
 * than the minimum. Going brighter still (#ccfbf1) separates best of all but
 * reads as white rather than teal, so the top step stops looking like "most"
 * and starts looking like "selected".
 *
 * Level 0 is a recessive surface tone, not a ramp step: an empty day is absence
 * of data, not the smallest amount of it.
 */
const LEVEL_FILL = [
  'var(--color-bg-tertiary)',
  '#0f766e',
  '#0d9488',
  '#2dd4bf',
  '#99f6e4',
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
    const from = new Date(`${year}-01-01T00:00:00`)
    const endOfYear = new Date(`${year}-12-31T00:00:00`)
    const today = new Date()
    // Don't draw the rest of the year as empty cells — it reads as missed days.
    const to = endOfYear > today ? today : endOfYear
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

          <div className="flex gap-1 bg-bg-tertiary rounded-[var(--radius-sm)] p-0.5 overflow-x-auto">
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                aria-pressed={year === y}
                className={`text-[0.7rem] font-semibold px-2.5 py-1 rounded-[var(--radius-sm)] transition-colors shrink-0 ${
                  year === y ? 'bg-accent text-bg-primary' : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid. Scrolls horizontally on narrow screens rather than squashing the
          cells below a usable hit target. */}
      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1 min-w-full">
          {/* Month axis */}
          <div className="flex gap-[3px] ml-[34px]">
            {calendar.weeks.map((_, i) => {
              const label = calendar.monthLabels.find((m) => m.weekIndex === i)
              return (
                <div key={i} className="w-[11px] shrink-0">
                  {label && (
                    <span className="text-[0.6rem] text-text-muted whitespace-nowrap">{label.label}</span>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex gap-[3px]">
            {/* Weekday axis — every other row, so the labels don't crowd */}
            <div className="flex flex-col gap-[3px] w-[31px] shrink-0">
              {DAY_LABELS.map((d, i) => (
                <div key={d} className="h-[11px] flex items-center">
                  {i % 2 === 1 && <span className="text-[0.6rem] text-text-muted leading-none">{d}</span>}
                </div>
              ))}
            </div>

            {calendar.weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((day, di) => {
                  if (!day) return <div key={di} className="size-[11px]" />
                  const isHovered = hovered?.date === day.date
                  return (
                    <button
                      key={di}
                      type="button"
                      onMouseEnter={() => setHovered(day)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(day)}
                      onBlur={() => setHovered(null)}
                      aria-label={`${day.date}: ${day.count} ${day.count === 1 ? 'activity' : 'activities'}, ${formatHours(day.movingTime)}, ${Math.round(day.load)} load`}
                      className="size-[11px] rounded-[2px] transition-transform hover:scale-125 focus:scale-125 focus:outline-none"
                      style={{
                        backgroundColor: LEVEL_FILL[day.level],
                        // 2px surface ring on the hovered mark, per mark specs
                        boxShadow: isHovered ? '0 0 0 2px var(--color-bg-secondary), 0 0 0 3px var(--color-accent)' : undefined,
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-1.5 ml-[34px] mt-1">
            <span className="text-[0.6rem] text-text-muted mr-1">Less</span>
            {LEVEL_FILL.map((fill, i) => (
              <div key={i} className="size-[11px] rounded-[2px]" style={{ backgroundColor: fill }} />
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
