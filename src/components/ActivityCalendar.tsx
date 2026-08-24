import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { type StravaActivity, metersToKm } from '~/lib/strava'
import { useDashboard } from '~/lib/dashboard-context'
import { fitnessSeries } from '~/lib/fitness'
import {
  DAY_LABELS,
  LEVEL_LABELS,
  buildActivityCalendar,
  type CalendarDay,
  type CalendarMetric,
} from '~/lib/activity-calendar'
import { sectionCard, cardTitle } from '~/lib/styles'
import {
  formatNumber,
  formatDistance,
  formatElevation,
  formatClock,
  formatDateWithWeekday,
} from '~/lib/format'
import { pageRange } from '~/components/Pagination'

interface ActivityCalendarProps {
  activities: StravaActivity[]
}

/**
 * Sequential ramp — one hue, monotone lightness, dark-anchored for a dark
 * surface. Ordinal checks pass: monotone L, adjacent ΔL ≥ 0.06, dark end above
 * the contrast floor against both the card and the empty-day tone.
 *
 * One step per band in LOAD_BANDS, spread as wide as the checks allow. The
 * spread is the whole job: these steps carry the difference between an easy
 * spin and an epic, and anything tighter collapses the mid-range into mush at
 * cell size.
 *
 * Level 0 is a recessive surface tone, not a ramp step: an empty day is absence
 * of data, not the smallest amount of it. Easy sits deliberately close to it —
 * an easy day genuinely is barely more than a rest day.
 */
const LEVEL_FILL = [
  'var(--color-bg-tertiary)',
  '#115e59',
  '#0d9488',
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

function Tile({
  label,
  value,
  hint,
  comparison,
}: {
  label: string
  value: string
  hint?: string
  comparison?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.75rem] uppercase tracking-wider font-semibold text-text-muted">{label}</span>
      <span className="data-value text-xl font-medium text-text-primary leading-tight">{value}</span>
      {comparison && (
        <span className="text-[0.75rem] text-text-secondary data-value">{comparison}</span>
      )}
      {hint && <span className="text-[0.75rem] text-text-muted">{hint}</span>}
    </div>
  )
}

/** `+12% vs 2025`, or nothing when last year has no comparable total. */
function comparisonLabel(current: number, previous: number, previousYear: string): string | undefined {
  if (previous <= 0) return undefined
  const change = Math.round(((current - previous) / previous) * 100)
  const sign = change > 0 ? '+' : ''
  return `${sign}${change}% vs ${previousYear}`
}

export function ActivityCalendar({ activities }: ActivityCalendarProps) {
  const { profile } = useDashboard()
  const [metric, setMetric] = useState<CalendarMetric>('load')
  // `pinned` survives a mouse leaving the cell, which is the only way a touch
  // device can reach the detail line at all — the calendar used to instruct
  // the reader to hover on a device that cannot.
  const [hovered, setHovered] = useState<CalendarDay | null>(null)
  const [pinned, setPinned] = useState<CalendarDay | null>(null)
  const gridScroller = useRef<HTMLDivElement>(null)
  const detailContent = useRef<HTMLDivElement>(null)
  const [detailHeight, setDetailHeight] = useState<number>()

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

  // Same slice of the previous year, so the summary strip can say whether this
  // season is ahead. Twelve years of history sat behind the year pager with
  // nothing comparing them.
  const previousYear = String(Number(year) - 1)
  const previous = useMemo(() => {
    if (!years.includes(previousYear)) return null
    const now = new Date()
    const isCurrentYear = year === String(now.getFullYear())
    const from = new Date(`${previousYear}-01-01T00:00:00`)
    const to = isCurrentYear
      ? new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
      : new Date(`${previousYear}-12-31T00:00:00`)
    return buildActivityCalendar(activities, fitness, from, to, metric).summary
  }, [activities, fitness, year, previousYear, years, metric])

  const { summary } = calendar
  const consistency = summary.days > 0 ? Math.round((summary.activeDays / summary.days) * 100) : 0
  const detail = pinned ?? hovered

  // The detail line is one line for a rest day and five for a double day, so
  // moving across the grid used to make the block jump on every cell. Measure
  // the content and animate the wrapper to it instead.
  useLayoutEffect(() => {
    const element = detailContent.current
    if (!element) return
    const measure = () => setDetailHeight(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [detail])

  // The current year opens on January otherwise, so reaching today means
  // scrolling right past nine months of history every time.
  useEffect(() => {
    const scroller = gridScroller.current
    if (!scroller) return
    const isCurrentYear = year === String(new Date().getFullYear())
    scroller.scrollLeft = isCurrentYear ? scroller.scrollWidth : 0
  }, [year])

  if (activities.length === 0) return null

  return (
    <div className={sectionCard}>
      <div className="flex justify-between items-start gap-4 mb-6 flex-wrap">
        <div>
          <h3 className={cardTitle}>Training calendar</h3>
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
                className={`text-[0.75rem] font-semibold px-2.5 py-1 rounded-[var(--radius-sm)] transition-colors ${
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
      <div ref={gridScroller} className="overflow-x-auto pb-1">
        <div className="flex flex-col gap-1 min-w-[680px]">
          {/* Month axis */}
          <div
            className="grid gap-[3px] ml-[37px]"
            style={{ gridTemplateColumns: `repeat(${calendar.weeks.length}, minmax(0.5rem, 1fr))` }}
          >
            {calendar.weeks.map((_, i) => {
              const label = calendar.monthLabels.find((m) => m.weekIndex === i)
              return (
                <div key={i} className="min-w-0">
                  {label && (
                    <span className="text-[0.75rem] text-text-muted whitespace-nowrap">{label.label}</span>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex gap-[3px]">
            {/* Weekday axis — every other row, so the labels don't crowd.
                Rows share the cells' aspect-ratio height via the same grid. */}
            <div className="grid grid-rows-7 gap-[3px] w-[34px] shrink-0">
              {DAY_LABELS.map((d, i) => (
                <div key={d} className="flex items-center">
                  {i % 2 === 1 && <span className="text-[0.75rem] text-text-muted leading-none">{d}</span>}
                </div>
              ))}
            </div>

            <div
              className="grid grid-rows-7 grid-flow-col gap-[3px] flex-1 min-w-0"
              style={{ gridTemplateColumns: `repeat(${calendar.weeks.length}, minmax(0.5rem, 1fr))` }}
              onMouseLeave={() => setHovered(null)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(null)
              }}
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
                        className="aspect-square w-full rounded-[2px] opacity-25"
                        style={{ backgroundColor: LEVEL_FILL[0] }}
                      />
                    )
                  }

                  const isHovered = hovered?.date === day.date || pinned?.date === day.date
                  return (
                    <button
                      key={`${wi}-${di}`}
                      type="button"
                      onMouseEnter={() => setHovered(day)}
                      onFocus={() => setHovered(day)}
                      onClick={() => setPinned((p) => (p?.date === day.date ? null : day))}
                      aria-label={`${day.date}: ${day.count} ${day.count === 1 ? 'activity' : 'activities'}, ${formatHours(day.movingTime)}, ${Math.round(day.load)} load`}
                      className="aspect-square w-full rounded-[2px] transition-transform hover:scale-110 focus:scale-110 focus:outline-none"
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

        </div>
      </div>

      {/* Legend. Named bands rather than "Less → More": the steps are fixed
          sizes, so they can say what they mean — and Easy/Moderate/Solid/
          Hard/Epic are the same words the activity list badges rides with.
          Outside the scroller so it wraps on a phone rather than clipping
          mid-word. */}
      <div className="flex items-center gap-x-4 gap-y-1 mt-2 flex-wrap">
        {LEVEL_FILL.map((fill, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="size-3 rounded-[2px] shrink-0" style={{ backgroundColor: fill }} />
            <span className="text-[0.75rem] text-text-muted">{LEVEL_LABELS[i]}</span>
          </span>
        ))}
      </div>

      {/* Day detail. Its height is measured and animated rather than left to
          the content: a rest day is one line and a double day is five, so
          moving across a week used to make the whole block jump on every cell.
          Click pins a day, which is how a touch device reaches this at all. */}
      <div className="mt-4 border-t border-border-subtle pt-3">
        <div
          className="overflow-hidden transition-[height] duration-200 ease-out"
          style={{ height: detailHeight }}
        >
        <div ref={detailContent}>
        {detail ? (
          <div className="min-h-[1.25rem]">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-sm font-semibold text-text-primary">
                {formatDateWithWeekday(`${detail.date}T00:00:00`)}
              </span>
              {detail.count === 0 ? (
                <span className="text-xs text-text-muted">Rest day</span>
              ) : (
                <span className="text-xs text-text-secondary data-value">
                  {formatHours(detail.movingTime)} · {formatDistance(metersToKm(detail.distance))} km
                  {detail.elevation > 0 && ` · ${formatElevation(detail.elevation)} m`}
                  {detail.load > 0 && ` · ${formatNumber(detail.load)} load`}
                </span>
              )}
              {pinned && (
                <button
                  type="button"
                  onClick={() => setPinned(null)}
                  className="text-[0.75rem] text-text-muted hover:text-text-secondary cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
            {detail.count > 0 && (
              <div className="flex flex-col gap-0.5 mt-1">
                {detail.activities.map((a) => (
                  <Link
                    key={a.id}
                    to="/activities/$activityId"
                    params={{ activityId: String(a.id) }}
                    className="text-xs text-text-muted hover:text-accent no-underline w-fit"
                  >
                    {a.name} <span className="data-value">· {formatClock(a.moving_time)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-text-muted">Select a day for detail.</p>
        )}
        </div>
        </div>
      </div>

      {/* Period summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mt-5 pt-5 border-t border-border-subtle">
        <Tile
          label="Activities"
          value={formatNumber(summary.activities)}
          comparison={previous ? comparisonLabel(summary.activities, previous.activities, previousYear) : undefined}
          hint={`${consistency}% of days active`}
        />
        <Tile
          label="Time"
          value={formatHours(summary.movingTime)}
          comparison={previous ? comparisonLabel(summary.movingTime, previous.movingTime, previousYear) : undefined}
          hint={summary.activeDays > 0 ? `${formatHours(Math.round(summary.movingTime / summary.activeDays))} per active day` : undefined}
        />
        <Tile
          label="Distance"
          value={`${formatDistance(metersToKm(summary.distance), 0)} km`}
          comparison={previous ? comparisonLabel(summary.distance, previous.distance, previousYear) : undefined}
          hint={`${formatElevation(summary.elevation)} m climbed`}
        />
        <Tile
          label="Load"
          value={formatNumber(summary.load)}
          comparison={previous ? comparisonLabel(summary.load, previous.load, previousYear) : undefined}
          hint={summary.longestStreak > 0 ? `${formatNumber(summary.longestStreak)}-day best streak` : undefined}
        />
      </div>
    </div>
  )
}
