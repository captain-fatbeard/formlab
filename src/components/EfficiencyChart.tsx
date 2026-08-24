import { useMemo } from 'react'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  ComposedChart,
  Area,
} from 'recharts'
import { type StravaActivity } from '~/lib/strava'
import { calculateEF } from '~/lib/performance'
import { chartTheme, tooltipStyle, formatDateShort, activityTooltipLabel } from '~/lib/chart-theme'
import { isRide } from '~/lib/activities'
import { calculateTrendLine } from '~/lib/trend'
import { trendClasses, sectionCard, cardTitle } from '~/lib/styles'
import { RangeSelector } from './RangeSelector'
import { useLocalRange } from '~/lib/use-local-range'
import { InsufficientData, MIN_TREND_POINTS } from './InsufficientData'
import { MetricTerm } from './MetricTerm'

interface EfficiencyChartProps {
  lifetimeActivities: StravaActivity[]
}

export function EfficiencyChart({ lifetimeActivities }: EfficiencyChartProps) {
  const range = useLocalRange()
  const efDays = range.days

  const allEfficiencyData = useMemo(() => {
    const rides = lifetimeActivities
      .filter((a) => isRide(a) && a.average_watts && a.average_heartrate)
      .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())

    return rides.map((ride) => {
      const np = ride.weighted_average_watts || ride.average_watts || 0
      const ef = calculateEF(np, ride.average_heartrate || 0)
      return {
        fullDate: ride.start_date_local,
        ef,
        np,
        avgHR: ride.average_heartrate,
        name: ride.name,
      }
    })
  }, [lifetimeActivities])

  const efficiencyData = useMemo(() => {
    if (efDays === 0) return allEfficiencyData
    const cutoff = Date.now() - efDays * 24 * 60 * 60 * 1000
    return allEfficiencyData.filter((d) => new Date(d.fullDate).getTime() >= cutoff)
  }, [allEfficiencyData, efDays])

  const efTrendLine = useMemo(
    () => calculateTrendLine(efficiencyData.map((d) => d.ef), 0.01),
    [efficiencyData],
  )

  const hasNoData = allEfficiencyData.length === 0
  const belowThreshold = efficiencyData.length < MIN_TREND_POINTS

  return (
    <div className={sectionCard}>
      <div className="flex justify-between items-center mb-5 gap-3 max-md:flex-col max-md:items-start">
        <div className="flex items-center gap-4 flex-wrap">
          <h3 className={cardTitle}>Efficiency factor over time</h3>
          {!hasNoData && (
            <RangeSelector
              days={efDays}
              onChange={range.setDays}
              globalDays={range.globalDays}
              isOverride={range.isOverride}
              onReset={range.reset}
            />
          )}
        </div>
        {!belowThreshold && efTrendLine && (
          <span className={`text-xs py-1.5 px-3.5 rounded-full font-semibold ${trendClasses[efTrendLine.trend]}`}>
            {efTrendLine.trend === 'improving' && '↑ Improving'}
            {efTrendLine.trend === 'declining' && '↓ Declining'}
            {efTrendLine.trend === 'stable' && '→ Stable'}
          </span>
        )}
      </div>
      {hasNoData ? (
        <div className="text-text-muted text-center py-16 text-[0.9rem]">
          Need rides with both power and heart rate data to calculate efficiency.
        </div>
      ) : belowThreshold ? (
        <InsufficientData
          count={efficiencyData.length}
          needed={MIN_TREND_POINTS}
          noun="rides with power and heart rate"
        />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={efficiencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="fullDate" stroke={chartTheme.axis} fontSize={12} tickFormatter={(value) => formatDateShort(value)} />
              <YAxis
                yAxisId="ef"
                stroke={chartTheme.axis}
                fontSize={12}
                domain={['auto', 'auto']}
                label={{ value: 'EF', angle: -90, position: 'insideLeft', fill: chartTheme.axis }}
              />
              <Tooltip
                {...tooltipStyle}
                labelFormatter={activityTooltipLabel}
                formatter={(value: number, name: string) => {
                  if (name === 'Efficiency Factor') return [value.toFixed(2), 'Efficiency Factor']
                  return [value, name]
                }}
              />
              <Legend />
              <Area
                yAxisId="ef"
                type="monotone"
                dataKey="ef"
                stroke={chartTheme.colors.primary.main}
                fill={chartTheme.fills.primary.main}
                strokeWidth={2}
                dot={{ r: 4, fill: chartTheme.colors.primary.main }}
                name="Efficiency Factor"
              />
              {efTrendLine && (
                <ReferenceLine
                  yAxisId="ef"
                  segment={[
                    { x: efficiencyData[0]?.fullDate, y: efTrendLine.startValue },
                    { x: efficiencyData[efficiencyData.length - 1]?.fullDate, y: efTrendLine.endValue },
                  ]}
                  stroke={chartTheme.colors.amber.main}
                  strokeDasharray="5 5"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
          <p className="mt-4 text-[0.8125rem] text-text-muted leading-relaxed">
            <MetricTerm id="ef">EF</MetricTerm> is normalised power divided by average heart rate —
            higher is better. A rising trend means more power for the same heartbeat.
          </p>
        </>
      )}
    </div>
  )
}
