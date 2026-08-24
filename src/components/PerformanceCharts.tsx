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
import { chartTheme, tooltipStyle, formatDateShort, activityTooltipLabel } from '~/lib/chart-theme'
import { isRide } from '~/lib/activities'
import { calculateTrendLine } from '~/lib/trend'
import { trendClasses } from '~/lib/styles'
import { RangeSelector } from './RangeSelector'
import { useLocalRange } from '~/lib/use-local-range'
import { InsufficientData, MIN_TREND_POINTS } from './InsufficientData'
import { MetricTerm } from './MetricTerm'
import { sectionCard, cardTitle } from '~/lib/styles'

interface PerformanceChartsProps {
  lifetimeActivities: StravaActivity[]
}

export function PerformanceCharts({ lifetimeActivities }: PerformanceChartsProps) {
  // Both cards start on the top-bar range and say so when pulled off it.
  const power = useLocalRange()
  const hr = useLocalRange()
  const powerDays = power.days
  const hrDays = hr.days

  const allPowerTrendData = useMemo(() => {
    const rides = lifetimeActivities
      .filter((a) => isRide(a) && a.average_watts)
      .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())

    return rides
      .map((ride) => ({
        fullDate: ride.start_date_local,
        avgPower: Math.round(ride.average_watts || 0),
        maxPower: ride.max_watts || 0,
        normalizedPower: ride.weighted_average_watts || undefined,
        name: ride.name,
      }))
      .filter((d) => d.avgPower > 0)
  }, [lifetimeActivities])

  const powerTrendData = useMemo(() => {
    if (powerDays === 0) return allPowerTrendData
    const cutoff = Date.now() - powerDays * 24 * 60 * 60 * 1000
    return allPowerTrendData.filter((d) => new Date(d.fullDate).getTime() >= cutoff)
  }, [allPowerTrendData, powerDays])

  const powerTrendLine = useMemo(
    () => calculateTrendLine(powerTrendData.map((d) => d.avgPower)),
    [powerTrendData],
  )

  const allHrTrendData = useMemo(() => {
    return lifetimeActivities
      .filter((a) => isRide(a) && a.average_heartrate)
      .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())
      .map((activity) => ({
        fullDate: activity.start_date_local,
        avgHR: Math.round(activity.average_heartrate || 0),
        maxHR: activity.max_heartrate || 0,
        name: activity.name,
      }))
  }, [lifetimeActivities])

  const hrTrendData = useMemo(() => {
    if (hrDays === 0) return allHrTrendData
    const cutoff = Date.now() - hrDays * 24 * 60 * 60 * 1000
    return allHrTrendData.filter((d) => new Date(d.fullDate).getTime() >= cutoff)
  }, [allHrTrendData, hrDays])

  const hasNoPowerData = allPowerTrendData.length === 0
  // A trend through three rides is noise drawn confidently — see F16.
  const powerBelowThreshold = powerTrendData.length < MIN_TREND_POINTS
  const hasNoHRData = allHrTrendData.length === 0
  const hrBelowThreshold = hrTrendData.length < MIN_TREND_POINTS

  return (
    <div className="flex flex-col gap-8">
      {/* Power Trend Chart */}
      <div className={sectionCard}>
        <div className="flex justify-between items-center mb-5 gap-3 max-md:flex-col max-md:items-start">
          <div className="flex items-center gap-4 flex-wrap">
            <h3 className={cardTitle}>Power trend</h3>
            {!hasNoPowerData && (
              <RangeSelector
                days={powerDays}
                onChange={power.setDays}
                globalDays={power.globalDays}
                isOverride={power.isOverride}
                onReset={power.reset}
              />
            )}
          </div>
          {!powerBelowThreshold && powerTrendLine && (
            <span className={`text-xs py-1.5 px-3.5 rounded-[var(--radius-sm)] font-semibold ${trendClasses[powerTrendLine.trend]}`}>
              {powerTrendLine.trend === 'improving' && '↑ Improving'}
              {powerTrendLine.trend === 'declining' && '↓ Declining'}
              {powerTrendLine.trend === 'stable' && '→ Stable'}
            </span>
          )}
        </div>
        {hasNoPowerData ? (
          <div className="text-text-muted text-center py-16 text-[0.9rem]">No power data available. Use a power meter or smart trainer.</div>
        ) : powerBelowThreshold ? (
          <InsufficientData
            count={powerTrendData.length}
            needed={MIN_TREND_POINTS}
            noun="rides with power"
          />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={powerTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="fullDate" stroke={chartTheme.axis} fontSize={12} tickFormatter={(value) => formatDateShort(value)} />
              <YAxis stroke={chartTheme.axis} fontSize={12} domain={['auto', 'auto']} />
              <Tooltip {...tooltipStyle} labelFormatter={activityTooltipLabel} formatter={(value: number, name: string) => [`${value} W`, name]} />
              <Legend />
              <Line
                type="monotone"
                dataKey="avgPower"
                stroke={chartTheme.colors.primary.main}
                strokeWidth={2}
                dot={{ r: 4, fill: chartTheme.colors.primary.main }}
                activeDot={{ r: 6, stroke: chartTheme.colors.primary.main, strokeWidth: 2 }}
                name="Avg Power"
              />
              {powerTrendData.some((d) => d.normalizedPower) && (
                <Line
                  type="monotone"
                  dataKey="normalizedPower"
                  stroke={chartTheme.colors.secondary.main}
                  strokeWidth={2}
                  dot={{ r: 3, fill: chartTheme.colors.secondary.main }}
                  name="Normalized Power"
                />
              )}
              {powerTrendLine && (
                <ReferenceLine
                  segment={[
                    { x: powerTrendData[0]?.fullDate, y: powerTrendLine.startValue },
                    { x: powerTrendData[powerTrendData.length - 1]?.fullDate, y: powerTrendLine.endValue },
                  ]}
                  stroke={chartTheme.colors.amber.main}
                  strokeDasharray="5 5"
                  strokeWidth={2}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
        {!hasNoPowerData && !powerBelowThreshold && (
          <p className="mt-4 text-[0.8125rem] text-text-muted leading-relaxed">
            Average power is the plain mean; <MetricTerm id="np">normalised power</MetricTerm> weights
            surges, so it is always equal to or higher.
          </p>
        )}
      </div>

      {/* Heart Rate Trend */}
      {!hasNoHRData && (
        <div className={sectionCard}>
          <div className="flex items-center gap-4 mb-5 flex-wrap">
            <h3 className={cardTitle}>Heart rate trend</h3>
            <RangeSelector
              days={hrDays}
              onChange={hr.setDays}
              globalDays={hr.globalDays}
              isOverride={hr.isOverride}
              onReset={hr.reset}
            />
          </div>
          {hrBelowThreshold ? (
            <InsufficientData
              count={hrTrendData.length}
              needed={MIN_TREND_POINTS}
              noun="rides with heart rate"
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
