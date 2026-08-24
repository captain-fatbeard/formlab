import { useMemo } from 'react'
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { type StravaActivity } from '~/lib/strava'
import { getHRZones, getHRZoneForBPM } from '~/lib/performance'
import {
  chartTheme,
  hrZoneColors,
  tooltipStyle,
  formatDateShort,
  activityTooltipLabel,
} from '~/lib/chart-theme'
import { ZoneDistribution, type ZoneRow } from './ZoneDistribution'
import { sectionCard, cardTitle } from '~/lib/styles'
import { formatNumber } from '~/lib/format'

interface HeartRateInsightsProps {
  activities: StravaActivity[]
  maxHR: number
  restingHR: number
}

// Calculate 5-activity rolling average
function rollingAverage(data: { avgHR: number }[], window: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < window - 1) return null
    const slice = data.slice(i - window + 1, i + 1)
    return Math.round(slice.reduce((sum, d) => sum + d.avgHR, 0) / window)
  })
}

// Determine trend from rolling average slope
function getTrend(data: (number | null)[]): 'Improving' | 'Stable' | 'Declining' {
  const valid = data.filter((v): v is number => v !== null)
  if (valid.length < 4) return 'Stable'

  // Compare first and last quarter averages
  const quarter = Math.max(2, Math.floor(valid.length / 4))
  const firstAvg = valid.slice(0, quarter).reduce((s, v) => s + v, 0) / quarter
  const lastAvg = valid.slice(-quarter).reduce((s, v) => s + v, 0) / quarter
  const diff = lastAvg - firstAvg

  if (diff < -2) return 'Improving' // lower avg HR = improving fitness
  if (diff > 2) return 'Declining'
  return 'Stable'
}

// A rising average heart rate at the same effort is worth noticing, not worth
// alarming about — it is exactly what a recovery block or a hot week looks
// like. Red is reserved for things that are actually wrong.
const trendBadgeClass: Record<string, string> = {
  Improving: 'bg-success-muted text-success',
  Stable: 'bg-bg-tertiary text-text-secondary',
  Declining: 'bg-warning-muted text-warning',
}

const trendExplanation: Record<string, string> = {
  Improving: 'Average heart rate is trending down across recent activities.',
  Stable: 'Average heart rate is holding steady across recent activities.',
  Declining: 'Average heart rate is trending up across recent activities.',
}

export function HeartRateInsights({ activities, maxHR, restingHR }: HeartRateInsightsProps) {
  // --- Heart Rate Trends Data ---
  const hrTrendData = useMemo(() => {
    const withHR = activities
      .filter((a) => a.average_heartrate && a.max_heartrate)
      .sort((a, b) => new Date(a.start_date_local).getTime() - new Date(b.start_date_local).getTime())

    const data = withHR.map((a) => ({
      date: a.start_date_local.split('T')[0],
      name: a.name,
      avgHR: a.average_heartrate!,
      maxHR: a.max_heartrate!,
    }))

    const rolling = rollingAverage(data, 5)

    return data.map((d, i) => ({
      ...d,
      rollingAvg: rolling[i],
    }))
  }, [activities])

  const trend = useMemo(
    () => getTrend(hrTrendData.map((d) => d.rollingAvg)),
    [hrTrendData]
  )

  // --- HR Zone Distribution Data ---
  // Every zone in Z1→Z5 order, zeros included: `-` for an untouched zone read
  // as "unknown" rather than "none".
  const zoneRows = useMemo<ZoneRow[]>(() => {
    if (!maxHR || !restingHR) return []

    const zones = getHRZones(maxHR, restingHR)
    const zoneTime: Record<string, number> = {}
    zones.forEach((z) => (zoneTime[z.name] = 0))

    activities
      .filter((a) => a.average_heartrate)
      .forEach((a) => {
        const zone = getHRZoneForBPM(a.average_heartrate!, maxHR, restingHR)
        if (zone) zoneTime[zone.name] += a.moving_time
      })

    const totalTime = Object.values(zoneTime).reduce((sum, t) => sum + t, 0)

    return zones.map((zone, i) => ({
      key: `Z${i + 1}`,
      name: zone.name.replace(/Zone \d+ \(/, '').replace(')', ''),
      range: `${formatNumber(zone.min)}–${formatNumber(zone.max)} bpm`,
      seconds: zoneTime[zone.name],
      percentage: totalTime > 0 ? Math.round((zoneTime[zone.name] / totalTime) * 100) : 0,
      color: hrZoneColors[i],
    }))
  }, [activities, maxHR, restingHR])

  const hasHRData = hrTrendData.length > 0
  const hasZoneData = zoneRows.some((z) => z.seconds > 0)

  if (!hasHRData && !hasZoneData) {
    return (
      <div className={sectionCard}>
        <h3 className={`${cardTitle} mb-5`}>Heart rate insights</h3>
        <div className="text-text-muted text-center py-16 text-[0.9rem]">
          No heart rate data available. Use a heart rate monitor during activities to see insights here.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Heart Rate Trends */}
      {hasHRData && (
        <div className={sectionCard}>
          <div className="flex justify-between items-start mb-5 gap-3 max-md:flex-col max-md:items-start">
            <div>
              <h3 className={cardTitle}>Heart rate trends</h3>
              <p className="text-[0.8125rem] text-text-muted mt-1">{trendExplanation[trend]}</p>
            </div>
            <span className={`py-1.5 px-4 rounded-full text-[0.8125rem] font-semibold shrink-0 ${trendBadgeClass[trend]}`}>
              {trend}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={hrTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis
                dataKey="date"
                stroke={chartTheme.axis}
                fontSize={12}
                tickFormatter={formatDateShort}
              />
              <YAxis
                stroke={chartTheme.axis}
                fontSize={12}
                domain={['auto', 'auto']}
                label={{ value: 'bpm', angle: -90, position: 'insideLeft', fill: chartTheme.axis }}
              />
              <Tooltip
                {...tooltipStyle}
                labelFormatter={activityTooltipLabel}
                formatter={(value: number, name: string) => {
                  if (value === null) return [null, null]
                  return [`${value} bpm`, name]
                }}
              />
              <Area
                type="monotone"
                dataKey="maxHR"
                fill={chartTheme.fills.coral.light}
                stroke={chartTheme.colors.coral.main}
                strokeWidth={1}
                name="Max HR"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="avgHR"
                stroke={chartTheme.colors.primary.main}
                strokeWidth={2}
                dot={{ r: 3, fill: chartTheme.colors.primary.main }}
                name="Avg HR"
              />
              <Line
                type="monotone"
                dataKey="rollingAvg"
                stroke={chartTheme.colors.amber.main}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
                name="5-Activity Avg"
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* HR Zone Distribution */}
      {hasZoneData && (
        <div className={sectionCard}>
          <h3 className={`${cardTitle} mb-5`}>HR zone distribution</h3>
          <ZoneDistribution zones={zoneRows} rangeHeader="Heart rate" label="Time in heart-rate zones" />
        </div>
      )}
    </div>
  )
}
