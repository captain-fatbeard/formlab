import { useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts'
import { type StravaActivity } from '~/lib/strava'
import { fitnessSeries } from '~/lib/fitness'
import { useDashboard } from '~/lib/dashboard-context'
import { chartTheme, tooltipStyle, formatDateShort, formatDateFull } from '~/lib/chart-theme'
import { RangeSelector } from './RangeSelector'

interface FitnessChartProps {
  activities: StravaActivity[]
}

function getCTLLevel(ctl: number): { label: string; color: string } {
  if (ctl >= 100) return { label: 'Elite', color: chartTheme.colors.semantic.positive }
  if (ctl >= 70) return { label: 'Well-Trained', color: chartTheme.colors.primary.main }
  if (ctl >= 40) return { label: 'Trained', color: chartTheme.colors.primary.light }
  if (ctl >= 20) return { label: 'Building', color: chartTheme.colors.amber.main }
  return { label: 'Getting Started', color: chartTheme.colors.neutral[400] }
}

function getATLLevel(atl: number): { label: string; color: string } {
  if (atl >= 100) return { label: 'Very Heavy', color: chartTheme.colors.semantic.negative }
  if (atl >= 60) return { label: 'Heavy', color: chartTheme.colors.amber.main }
  if (atl >= 30) return { label: 'Moderate', color: chartTheme.colors.primary.main }
  return { label: 'Light', color: chartTheme.colors.neutral[400] }
}

export function FitnessChart({ activities }: FitnessChartProps) {
  const [days, setDays] = useState(30)
  const { profile } = useDashboard()

  // Full history once — CTL/ATL build up from the earliest activity.
  const series = useMemo(() => fitnessSeries(activities, profile), [activities, profile])

  // Slice to the selected time range for display only
  const fitnessData = useMemo(() => {
    if (days === 0) return series.days
    return series.days.slice(-days)
  }, [series, days])

  if (fitnessData.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 transition-all duration-200 hover:border-border max-md:p-4 max-[480px]:p-3.5">
        <h3 className="text-lg font-semibold mb-5 text-text-primary max-[480px]:text-base">Fitness & Form</h3>
        <div className="text-text-muted text-center py-16 text-[0.9rem]">
          Need activities with power or heart rate to calculate fitness trends.
        </div>
      </div>
    )
  }

  const latestData = fitnessData[fitnessData.length - 1]
  const ctlLevel = getCTLLevel(latestData.ctl)
  const atlLevel = getATLLevel(latestData.atl)
  const formStatus =
    latestData.tsb > 25
      ? { label: 'Detraining', color: chartTheme.colors.neutral[500], hint: 'You may be losing fitness' }
      : latestData.tsb > 15
        ? { label: 'Fresh', color: chartTheme.colors.amber.main, hint: 'Great for race day' }
        : latestData.tsb > 5
          ? { label: 'Optimal', color: chartTheme.colors.semantic.positive, hint: 'Peak performance zone' }
          : latestData.tsb > -10
            ? { label: 'Neutral', color: chartTheme.colors.amber.light, hint: 'Normal training load' }
            : latestData.tsb > -25
              ? { label: 'Tired', color: chartTheme.colors.neutral[400], hint: 'Absorbing training' }
              : { label: 'Overreached', color: chartTheme.colors.semantic.negative, hint: 'Risk of overtraining' }

  return (
    <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 transition-all duration-200 hover:border-border max-md:p-4 max-[480px]:p-3.5">
      <div className="flex justify-between items-center mb-5 max-md:flex-col max-md:items-start max-md:gap-3">
        <div className="flex items-center gap-4">
          <h3 className="text-lg font-semibold text-text-primary max-[480px]:text-base">Fitness & Form</h3>
          <RangeSelector days={days} onChange={setDays} />
        </div>
        <div className="flex gap-8 flex-wrap max-md:gap-4">
          <span className="flex flex-col items-center">
            <span className="text-[0.65rem] text-text-muted uppercase font-semibold tracking-wider">CTL</span>
            <span className="data-value text-2xl font-medium" style={{ color: chartTheme.colors.primary.main }}>{latestData.ctl.toFixed(1)}</span>
            <span className="text-[0.625rem] font-medium mt-0.5 rounded-full px-2 py-0.5" style={{ color: ctlLevel.color, backgroundColor: `${ctlLevel.color}15` }}>{ctlLevel.label}</span>
          </span>
          <span className="flex flex-col items-center">
            <span className="text-[0.65rem] text-text-muted uppercase font-semibold tracking-wider">ATL</span>
            <span className="data-value text-2xl font-medium" style={{ color: chartTheme.colors.secondary.main }}>{latestData.atl.toFixed(1)}</span>
            <span className="text-[0.625rem] font-medium mt-0.5 rounded-full px-2 py-0.5" style={{ color: atlLevel.color, backgroundColor: `${atlLevel.color}15` }}>{atlLevel.label}</span>
          </span>
          <span className="flex flex-col items-center">
            <span className="text-[0.65rem] text-text-muted uppercase font-semibold tracking-wider">Form</span>
            <span className="data-value text-2xl font-medium" style={{ color: formStatus.color }}>
              {latestData.tsb.toFixed(1)}
            </span>
            <span className="text-[0.625rem] font-medium mt-0.5 rounded-full px-2 py-0.5" style={{ color: formStatus.color, backgroundColor: `${formStatus.color}15` }}>{formStatus.label}</span>
          </span>
          <span className="flex flex-col items-center">
            <span className="text-[0.65rem] text-text-muted uppercase font-semibold tracking-wider">FTP</span>
            <span className="data-value text-2xl font-medium text-text-primary">{latestData.ftp}W</span>
            <span className="text-[0.625rem] font-medium mt-0.5 rounded-full px-2 py-0.5 text-text-muted bg-bg-tertiary">Estimated</span>
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={fitnessData}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
          <XAxis
            dataKey="date"
            stroke={chartTheme.axis}
            fontSize={12}
            tickFormatter={(date) => formatDateShort(date)}
            interval="preserveStartEnd"
          />
          <YAxis stroke={chartTheme.axis} fontSize={12} />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(date) => formatDateFull(date as string)}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const data = payload[0]?.payload
              return (
                <div style={tooltipStyle.contentStyle}>
                  <p style={{ margin: '0 0 4px', color: tooltipStyle.labelStyle?.color }}>{formatDateFull(label as string)}</p>
                  {payload.map((entry) => (
                    <p key={entry.dataKey as string} style={{ margin: '2px 0', color: entry.color }}>
                      {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
                    </p>
                  ))}
                  {data?.ftp && (
                    <p style={{ margin: '2px 0', color: chartTheme.colors.neutral[400] }}>
                      FTP: {data.ftp}W
                    </p>
                  )}
                </div>
              )
            }}
          />
          <Legend />
          <ReferenceLine y={0} stroke={chartTheme.colors.neutral[500]} strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="ctl"
            stroke={chartTheme.colors.primary.main}
            fill={chartTheme.fills.primary.main}
            name="Fitness (CTL)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="atl"
            stroke={chartTheme.colors.secondary.main}
            fill={chartTheme.fills.secondary.main}
            name="Fatigue (ATL)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="tsb"
            stroke={chartTheme.colors.amber.main}
            fill={chartTheme.fills.amber.main}
            name="Form (TSB)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-5 p-5 bg-bg-tertiary rounded-[var(--radius-md)] text-[0.8rem] text-text-secondary leading-relaxed">
        <div className="mb-4">
          <p className="mb-1">
            <strong className="text-accent">CTL</strong> (Fitness) — built over ~6 weeks of training
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.72rem] text-text-muted ml-3">
            <span>0–20 Getting Started</span>
            <span>20–40 Building</span>
            <span>40–70 Trained</span>
            <span>70–100 Well-Trained</span>
            <span>100+ Elite</span>
          </div>
        </div>
        <div className="mb-4">
          <p className="mb-1">
            <strong className="text-accent">ATL</strong> (Fatigue) — recent load from the last ~week
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.72rem] text-text-muted ml-3">
            <span>0–30 Light</span>
            <span>30–60 Moderate</span>
            <span>60–100 Heavy</span>
            <span>100+ Very Heavy</span>
          </div>
        </div>
        <div>
          <p className="mb-1">
            <strong className="text-accent">Form</strong> (TSB = CTL − ATL) — {formStatus.hint}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.72rem] text-text-muted ml-3">
            <span>&gt;25 Detraining</span>
            <span>15–25 Fresh</span>
            <span>5–15 Optimal</span>
            <span>−10–5 Neutral</span>
            <span>−25–−10 Tired</span>
            <span>&lt;−25 Overreached</span>
          </div>
        </div>
      </div>

      <CTLTargets currentCtl={latestData.ctl} />
    </div>
  )
}

const CTL_TARGETS: { ctl: number; tier?: string }[] = [
  { ctl: 40, tier: 'Trained' },
  { ctl: 50 },
  { ctl: 60 },
  { ctl: 70, tier: 'Well-Trained' },
  { ctl: 85 },
  { ctl: 100, tier: 'Elite' },
]

function CTLTargets({ currentCtl }: { currentCtl: number }) {
  // CTL asymptotes to your daily-average TSS, so target CTL ≈ required TSS/day.
  const nextTarget = CTL_TARGETS.find((t) => t.ctl > currentCtl)?.ctl

  return (
    <div className="mt-5 p-5 bg-bg-tertiary rounded-[var(--radius-md)]">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <p className="text-[0.8rem] text-text-secondary">
          <strong className="text-accent">CTL Targets</strong> — TSS load needed to reach each fitness level
        </p>
        <span className="text-[0.72rem] text-text-muted">
          You're at <span className="data-value text-text-primary">{currentCtl.toFixed(1)}</span>
          {nextTarget != null && (
            <>
              {' '}· next: <span className="data-value text-text-primary">{nextTarget}</span>{' '}
              (+{(nextTarget - currentCtl).toFixed(1)} TSS/day)
            </>
          )}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left p-3 text-text-muted font-semibold text-[0.7rem] uppercase tracking-wide border-b border-border">Target CTL</th>
            <th className="text-left p-3 text-text-muted font-semibold text-[0.7rem] uppercase tracking-wide border-b border-border">Tier</th>
            <th className="text-right p-3 text-text-muted font-semibold text-[0.7rem] uppercase tracking-wide border-b border-border">TSS / day</th>
            <th className="text-right p-3 text-text-muted font-semibold text-[0.7rem] uppercase tracking-wide border-b border-border">TSS / week</th>
            <th className="text-right p-3 text-text-muted font-semibold text-[0.7rem] uppercase tracking-wide border-b border-border">vs you</th>
          </tr>
        </thead>
        <tbody>
          {CTL_TARGETS.map((t) => {
            const delta = t.ctl - currentCtl
            const isCurrent = t.ctl === nextTarget
            return (
              <tr
                key={t.ctl}
                className={isCurrent ? 'bg-bg-secondary' : ''}
              >
                <td className="p-3 border-b border-border-subtle data-value text-text-primary">
                  {t.ctl}
                  {isCurrent && (
                    <span
                      className="ml-2 text-[0.625rem] font-medium rounded-full px-2 py-0.5"
                      style={{ color: chartTheme.colors.primary.main, backgroundColor: `${chartTheme.colors.primary.main}15` }}
                    >
                      next
                    </span>
                  )}
                </td>
                <td className="p-3 border-b border-border-subtle text-text-secondary">{t.tier ?? '—'}</td>
                <td className="p-3 border-b border-border-subtle text-right data-value text-text-primary">{t.ctl}</td>
                <td className="p-3 border-b border-border-subtle text-right data-value text-text-primary">{t.ctl * 7}</td>
                <td
                  className="p-3 border-b border-border-subtle text-right data-value"
                  style={{
                    color:
                      delta <= 0
                        ? chartTheme.colors.semantic.positive
                        : delta <= 10
                          ? chartTheme.colors.amber.main
                          : chartTheme.colors.neutral[400],
                  }}
                >
                  {delta <= 0 ? 'reached' : `+${delta.toFixed(1)}/day`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[0.72rem] text-text-muted leading-relaxed">
        CTL converges toward your daily-average TSS. To move up, you need to sustain the required load for ~6 weeks.
      </p>
    </div>
  )
}
