import { useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Legend,
  ReferenceLine,
} from 'recharts'
import { type StravaActivity } from '~/lib/strava'
import { formatPace } from '~/lib/performance'
import { chartTheme, tooltipStyle, formatDateShort, activityTooltipLabel } from '~/lib/chart-theme'
import { isRun } from '~/lib/activities'
import { calculateTrendLine } from '~/lib/trend'
import { trendClasses, sectionCard, cardTitle } from '~/lib/styles'
import { InsufficientData, MIN_TREND_POINTS } from './InsufficientData'

interface RunningChartsProps {
  activities: StravaActivity[]
}

export function RunningCharts({ activities }: RunningChartsProps) {
  const runs = useMemo(
    () => activities.filter(isRun).sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()),
    [activities]
  )

  const paceTrendData = useMemo(() => {
    return runs
      .filter((r) => r.distance > 0)
      .map((run) => {
        const paceSecsPerKm = run.moving_time / (run.distance / 1000)
        return {
          fullDate: run.start_date_local,
          pace: Math.round(paceSecsPerKm * 10) / 10, // seconds per km
          paceFormatted: formatPace(paceSecsPerKm),
          distance: Math.round(run.distance / 100) / 10, // km with 1 decimal
          name: run.name,
        }
      })
  }, [runs])

  const paceTrendLine = useMemo(
    () => calculateTrendLine(paceTrendData.map((d) => d.pace), 1, true),
    [paceTrendData],
  )

  const hrTrendData = useMemo(() => {
    return runs
      .filter((r) => r.average_heartrate)
      .map((run) => ({
        fullDate: run.start_date_local,
        avgHR: Math.round(run.average_heartrate || 0),
        maxHR: run.max_heartrate || 0,
        name: run.name,
      }))
  }, [runs])

  if (runs.length === 0) return null

  // n = 2 is the problem, not n = 0: two runs drew a flat line across three
  // days and a wedge, both of which look like faults.
  const hasPaceTrend = paceTrendData.length >= MIN_TREND_POINTS
  const hasHRTrend = hrTrendData.length >= MIN_TREND_POINTS

  return (
    <div className="flex flex-col gap-8">
      {/* Pace Trend Chart */}
      <div className={sectionCard}>
        <div className="flex justify-between items-center mb-5 max-md:flex-col max-md:items-start max-md:gap-3">
          <h3 className={cardTitle}>Pace trend</h3>
          {hasPaceTrend && paceTrendLine && (
            <span className={`text-xs py-1.5 px-3.5 rounded-[var(--radius-sm)] font-semibold ${trendClasses[paceTrendLine.trend]}`}>
              {paceTrendLine.trend === 'improving' && '↑ Getting Faster'}
              {paceTrendLine.trend === 'declining' && '↓ Slowing Down'}
              {paceTrendLine.trend === 'stable' && '→ Stable'}
            </span>
          )}
        </div>
        {!hasPaceTrend ? (
          <InsufficientData count={paceTrendData.length} needed={MIN_TREND_POINTS} noun="runs" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={paceTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="fullDate" stroke={chartTheme.axis} fontSize={12} tickFormatter={(value) => formatDateShort(value)} />
              <YAxis
                stroke={chartTheme.axis}
                fontSize={12}
                reversed
                domain={[(min: number) => Math.floor(min / 30) * 30, (max: number) => Math.ceil(max / 30) * 30]}
                tickFormatter={(value: number) => formatPace(value)}
              />
              <Tooltip
                {...tooltipStyle}
                labelFormatter={activityTooltipLabel}
                formatter={(value: number, name: string) => {
                  if (name === 'Pace') return [formatPace(value) + ' /km', name]
                  return [`${value} km`, name]
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="pace"
                stroke={chartTheme.colors.primary.main}
                strokeWidth={2}
                dot={{ r: 4, fill: chartTheme.colors.primary.main }}
                activeDot={{ r: 6, stroke: chartTheme.colors.primary.main, strokeWidth: 2 }}
                name="Pace"
              />
              {paceTrendLine && (
                <ReferenceLine
                  segment={[
                    { x: paceTrendData[0]?.fullDate, y: paceTrendLine.startValue },
                    { x: paceTrendData[paceTrendData.length - 1]?.fullDate, y: paceTrendLine.endValue },
                  ]}
                  stroke={chartTheme.colors.amber.main}
                  strokeDasharray="5 5"
                  strokeWidth={2}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Heart Rate Trend (Runs) */}
      {hrTrendData.length > 0 && (
        <div className={sectionCard}>
          <h3 className={`${cardTitle} mb-5`}>Heart rate trend (runs)</h3>
          {!hasHRTrend ? (
            <InsufficientData
              count={hrTrendData.length}
              needed={MIN_TREND_POINTS}
              noun="runs with heart rate"
            />
          ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={hrTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="fullDate" stroke={chartTheme.axis} fontSize={12} tickFormatter={(value) => formatDateShort(value)} />
              <YAxis stroke={chartTheme.axis} fontSize={12} domain={['auto', 'auto']} />
              <Tooltip {...tooltipStyle} labelFormatter={activityTooltipLabel} formatter={(value: number, name: string) => [`${value} bpm`, name]} />
              <Legend />
              <Area
                type="monotone"
                dataKey="maxHR"
                stroke={chartTheme.colors.secondary.main}
                fill={chartTheme.fills.secondary.main}
                strokeWidth={2}
                name="Max HR"
              />
              <Area
                type="monotone"
                dataKey="avgHR"
                stroke={chartTheme.colors.primary.main}
                fill={chartTheme.fills.primary.main}
                strokeWidth={2}
                name="Avg HR"
              />
            </AreaChart>
          </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  )
}
