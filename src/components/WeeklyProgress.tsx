import { useMemo, useState } from 'react'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { startOfWeek, addWeeks, addDays, startOfDay } from 'date-fns'
import { type StravaActivity } from '~/lib/strava'
import { calculateWeeklySummaries } from '~/lib/performance'
import { useDashboard } from '~/lib/dashboard-context'
import { chartTheme, tooltipStyle } from '~/lib/chart-theme'
import { statCard, statCardAccent, statValue, statValueAccent, cardTitle, sectionCard } from '~/lib/styles'
import { formatNumber, formatDistance, formatDuration } from '~/lib/format'
import { MetricTerm } from './MetricTerm'

interface WeeklyProgressProps {
  activities: StravaActivity[]
}

const STREAK_THRESHOLD_HOURS = 2

/**
 * One series at a time, each with its own axis label.
 *
 * The chart used to plot distance (0–600), average power, hours (0–5) and
 * training stress against two unlabelled axes: hours rendered as a flat line
 * pinned to the floor, and training stress was in the legend but not findable
 * in the plot.
 */
const SERIES = [
  {
    id: 'totalTSS' as const,
    label: 'Training load',
    unit: 'TSS',
    color: chartTheme.colors.primary.main,
    format: (v: number) => formatNumber(v),
  },
  {
    id: 'totalDistance' as const,
    label: 'Distance',
    unit: 'km',
    color: chartTheme.colors.sky.main,
    format: (v: number) => `${formatDistance(v, 0)} km`,
  },
  {
    id: 'totalTime' as const,
    label: 'Time',
    unit: 'hours',
    color: chartTheme.colors.secondary.main,
    format: (v: number) => formatDuration(v),
  },
  {
    id: 'avgPower' as const,
    label: 'Avg power',
    unit: 'watts',
    color: chartTheme.colors.amber.main,
    format: (v: number) => `${formatNumber(v)} W`,
  },
]

type SeriesId = (typeof SERIES)[number]['id']

export function WeeklyProgress({ activities }: WeeklyProgressProps) {
  const { tssThresholds } = useDashboard()
  const [seriesId, setSeriesId] = useState<SeriesId>('totalTSS')
  const series = SERIES.find((s) => s.id === seriesId) ?? SERIES[0]

  const weeklyData = useMemo(
    () => calculateWeeklySummaries(activities, tssThresholds, 12),
    [activities, tssThresholds]
  )

  const { currentWeekStreak, longestStreak, avgActivitiesPerWeek, avgTimePerWeek, avgDistPerWeek, currentWeekHours, currentDayStreak, hasActivityToday } = useMemo(() => {
    if (activities.length === 0) {
      return { currentWeekStreak: 0, longestStreak: 0, avgActivitiesPerWeek: 0, avgTimePerWeek: 0, avgDistPerWeek: 0, currentWeekHours: 0, currentDayStreak: 0, hasActivityToday: false }
    }

    const now = new Date()
    const today = startOfDay(now)
    const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 })

    const sortedActivities = [...activities].sort(
      (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()
    )

    const earliestDate = new Date(sortedActivities[0].start_date)
    const earliestWeekStart = startOfWeek(earliestDate, { weekStartsOn: 1 })

    // Build weekly hours map for all weeks from earliest to current
    const weeklyHoursMap = new Map<string, number>()
    for (let ws = new Date(earliestWeekStart); ws <= currentWeekStart; ws = addWeeks(ws, 1)) {
      const we = addWeeks(ws, 1)
      const weekKey = ws.toISOString().split('T')[0]
      const hours = activities
        .filter((a) => {
          const d = new Date(a.start_date)
          return d >= ws && d < we
        })
        .reduce((sum, a) => sum + a.moving_time / 3600, 0)
      weeklyHoursMap.set(weekKey, hours)
    }

    // Find longest streak
    let longest = 0
    let streak = 0
    for (let ws = new Date(earliestWeekStart); ws <= currentWeekStart; ws = addWeeks(ws, 1)) {
      const weekKey = ws.toISOString().split('T')[0]
      const hours = weeklyHoursMap.get(weekKey) ?? 0
      if (hours >= STREAK_THRESHOLD_HOURS) {
        streak++
        if (streak > longest) longest = streak
      } else {
        streak = 0
      }
    }

    // Current week hours
    const currentWeekKey = currentWeekStart.toISOString().split('T')[0]
    const thisWeekHours = weeklyHoursMap.get(currentWeekKey) ?? 0

    // Find current weekly streak (count backward, skipping current week if not yet met)
    let current = 0
    const startFrom = thisWeekHours >= STREAK_THRESHOLD_HOURS
      ? new Date(currentWeekStart)
      : addWeeks(currentWeekStart, -1)

    for (let ws = new Date(startFrom); ws >= earliestWeekStart; ws = addWeeks(ws, -1)) {
      const weekKey = ws.toISOString().split('T')[0]
      const hours = weeklyHoursMap.get(weekKey) ?? 0
      if (hours >= STREAK_THRESHOLD_HOURS) {
        current++
      } else {
        break
      }
    }

    // Daily activity streak: count consecutive days with at least one activity
    const activityDays = new Set(
      activities.map((a) => startOfDay(new Date(a.start_date)).toISOString().split('T')[0])
    )
    const todayKey = today.toISOString().split('T')[0]
    const activityToday = activityDays.has(todayKey)
    let dayStreak = 0
    // Start from today, if no activity today start from yesterday
    let checkDay = activityToday ? today : addDays(today, -1)
    for (; ; checkDay = addDays(checkDay, -1)) {
      const dayKey = checkDay.toISOString().split('T')[0]
      if (activityDays.has(dayKey)) {
        dayStreak++
      } else {
        break
      }
    }

    // Avg per week from the chart data
    const weeksWithActivity = weeklyData.filter((d) => d.rides + d.runs > 0).length
    const totalActivities = weeklyData.reduce((s, d) => s + d.rides + d.runs, 0)
    const totalTime = weeklyData.reduce((s, d) => s + d.totalTime, 0)
    const totalDist = weeklyData.reduce((s, d) => s + d.totalDistance, 0)
    const avgPerWeek = weeksWithActivity > 0
      ? Math.round((totalActivities / weeksWithActivity) * 10) / 10
      : 0
    const avgTimePerWeek = weeksWithActivity > 0
      ? Math.round(totalTime / weeksWithActivity)
      : 0
    const avgDistPerWeek = weeksWithActivity > 0
      ? Math.round((totalDist / weeksWithActivity) * 10) / 10
      : 0

    return {
      currentWeekStreak: current,
      longestStreak: longest,
      avgActivitiesPerWeek: avgPerWeek,
      avgTimePerWeek,
      avgDistPerWeek,
      currentWeekHours: thisWeekHours,
      currentDayStreak: dayStreak,
      hasActivityToday: activityToday,
    }
  }, [activities, weeklyData])

  const chartData = weeklyData
  // Averaged over completed weeks only — including a two-day-old week drags
  // the average down for no reason.
  const average = useMemo(() => {
    const complete = weeklyData.filter((w) => !w.isCurrentWeek)
    if (complete.length === 0) return 0
    const total = complete.reduce((sum, w) => sum + (w[seriesId] as number), 0)
    return Math.round(total / complete.length)
  }, [weeklyData, seriesId])

  if (weeklyData.length === 0) {
    return null
  }

  return (
    <div className={sectionCard}>
      <h3 className={`${cardTitle} mb-1`}>Weekly training load</h3>
      <p className="text-[0.8125rem] text-text-muted mb-5">
        The last 12 weeks, one series at a time. Load is measured in{' '}
        <MetricTerm id="tss">TSS</MetricTerm>.
      </p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 mb-6">
        <div className={`${statCardAccent} text-center`}>
          <div className={statValueAccent}>
            {currentWeekStreak}
          </div>
          <div className="text-sm text-text-secondary font-medium">Week streak</div>
          <div className="text-[0.75rem] text-text-muted">weeks</div>
          {currentWeekHours < STREAK_THRESHOLD_HOURS && (
            <div className="text-[0.75rem] text-warning font-medium mt-1.5">
              Train {Math.ceil((STREAK_THRESHOLD_HOURS - currentWeekHours) * 60)}min more to {currentWeekStreak > 0 ? `continue ${currentWeekStreak} week streak` : 'start a streak'}
            </div>
          )}
          {currentWeekHours >= STREAK_THRESHOLD_HOURS && (
            <div className="text-[0.75rem] text-success font-medium mt-1.5">
              Streak secured this week
            </div>
          )}
        </div>
        <div className={`${statCard} text-center gap-1`}>
          <div className={statValue}>{currentDayStreak}</div>
          <div className="text-sm text-text-secondary font-medium">Day streak</div>
          <div className="text-[0.75rem] text-text-muted">days</div>
          {currentDayStreak > 0 && !hasActivityToday && (
            <div className="text-[0.75rem] text-warning font-medium mt-1.5">
              Train today for a {currentDayStreak + 1} day streak
            </div>
          )}
          {currentDayStreak > 0 && hasActivityToday && (
            <div className="text-[0.75rem] text-success font-medium mt-1.5">
              Streak extended today
            </div>
          )}
        </div>
        <div className={`${statCard} text-center gap-1`}>
          <div className={statValue}>{longestStreak}</div>
          <div className="text-sm text-text-secondary font-medium">Longest streak</div>
          <div className="text-[0.75rem] text-text-muted">weeks</div>
        </div>
        <div className={`${statCard} text-center gap-1`}>
          <div className={statValue}>{formatDuration(avgTimePerWeek)}</div>
          <div className="text-sm text-text-secondary font-medium">Avg per week</div>
          <div className="text-[0.75rem] text-text-muted">{avgActivitiesPerWeek} activities · {formatDistance(avgDistPerWeek, 0)} km</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex gap-1 bg-bg-tertiary rounded-[var(--radius-sm)] p-0.5">
          {SERIES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSeriesId(option.id)}
              aria-pressed={option.id === seriesId}
              className={`text-[0.75rem] font-semibold px-2.5 py-1 rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                option.id === seriesId
                  ? 'bg-accent text-bg-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-[0.75rem] text-text-muted">
          12-week average: <span className="data-value">{series.format(average)}</span>
        </span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
          <XAxis
            dataKey="week"
            stroke={chartTheme.axis}
            fontSize={12}
            label={{ value: 'Week beginning', position: 'insideBottom', offset: -14, fill: chartTheme.axis, fontSize: 12 }}
          />
          <YAxis
            stroke={chartTheme.axis}
            fontSize={12}
            width={64}
            tickFormatter={(value: number) =>
              seriesId === 'totalTime' ? String(Math.round(value / 3600)) : formatNumber(value)
            }
            label={{ value: series.unit, angle: -90, position: 'insideLeft', fill: chartTheme.axis, fontSize: 12 }}
          />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            labelFormatter={(label: string) => {
              const week = chartData.find((w) => w.week === label)
              return week?.isCurrentWeek
                ? `Week of ${label} — in progress, day ${week.daysElapsed} of 7`
                : `Week of ${label}`
            }}
            formatter={(value: number) => [series.format(value), series.label]}
          />
          <ReferenceLine
            y={average}
            stroke={chartTheme.colors.neutral[500]}
            strokeDasharray="4 4"
          />
          <Bar dataKey={seriesId} name={series.label} radius={[4, 4, 0, 0]}>
            {chartData.map((week) => (
              // The week in progress is dimmed rather than plotted as a
              // collapse: it is not a bad week, it is an unfinished one.
              <Cell
                key={week.weekStart}
                fill={series.color}
                fillOpacity={week.isCurrentWeek ? 0.35 : 1}
                stroke={week.isCurrentWeek ? series.color : undefined}
                strokeDasharray={week.isCurrentWeek ? '3 3' : undefined}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <p className="text-[0.75rem] text-text-muted mt-2">
        The dashed bar is this week, still in progress (day {chartData[chartData.length - 1]?.daysElapsed ?? 1} of 7).
        The dotted line is the 12-week average.
      </p>

      <div className="grid grid-cols-4 gap-5 mt-6 max-md:grid-cols-2 max-md:gap-3 max-[480px]:gap-2">
        {weeklyData.slice(-4).map((week) => (
          <div
            key={week.weekStart}
            className={`rounded-[var(--radius-md)] p-5 transition-all duration-200 max-[480px]:p-3.5 ${
              week.isCurrentWeek
                ? 'bg-bg-tertiary/50 border border-dashed border-border'
                : 'bg-bg-tertiary hover:bg-bg-elevated'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2 mb-4 pb-3 border-b border-border-subtle">
              <span className="text-sm font-semibold text-text-primary">{week.week}</span>
              {week.isCurrentWeek && (
                <span className="text-[0.75rem] text-text-muted whitespace-nowrap">
                  day {week.daysElapsed} of 7
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <span className="block data-value text-[1.375rem] font-medium text-text-primary max-md:text-lg max-[480px]:text-base">{formatNumber(week.rides + week.runs)}</span>
                <span className="text-[0.75rem] text-text-muted uppercase font-semibold tracking-wide">activities</span>
              </div>
              <div className="text-center">
                <span className="block data-value text-[1.375rem] font-medium text-text-primary max-md:text-lg max-[480px]:text-base">{formatDistance(week.totalDistance, 0)}</span>
                <span className="text-[0.75rem] text-text-muted uppercase font-semibold tracking-wide">km</span>
              </div>
              <div className="text-center">
                <span className="block data-value text-[1.375rem] font-medium text-text-primary max-md:text-lg max-[480px]:text-base">{formatDuration(week.totalTime)}</span>
                <span className="text-[0.75rem] text-text-muted uppercase font-semibold tracking-wide">time</span>
              </div>
              <div className="text-center">
                <span className="block data-value text-[1.375rem] font-medium text-text-primary max-md:text-lg max-[480px]:text-base">{formatNumber(week.totalTSS)}</span>
                <span className="text-[0.75rem] text-text-muted uppercase font-semibold tracking-wide">TSS</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
