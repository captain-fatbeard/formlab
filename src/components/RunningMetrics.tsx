import { useMemo } from 'react'
import { type StravaActivity } from '~/lib/strava'
import { calculateRunningMetrics, formatPace, getMotionistBenchmarks } from '~/lib/performance'
import { badgeClasses, cardTitle } from '~/lib/styles'
import { ComparisonBar } from './ComparisonBar'
import type { Gender } from '~/lib/dashboard-context'

interface RunningMetricsProps {
  activities: StravaActivity[]
  age: number
  gender: Gender
}

export function RunningMetrics({ activities, age, gender }: RunningMetricsProps) {
  const metrics = useMemo(() => calculateRunningMetrics(activities, age, gender), [activities, age, gender])
  const benchmarks = useMemo(() => getMotionistBenchmarks(age, gender), [age, gender])

  if (metrics.totalRuns === 0) {
    return (
      <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-5">
        <h3 className={`${cardTitle} mb-6`}>Running metrics</h3>
        <p className="text-text-muted text-center py-16 text-[0.9rem]">Need running data to calculate metrics</p>
      </div>
    )
  }

  return (
    <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-5">
      <h3 className={`${cardTitle} mb-6`}>Running metrics</h3>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5 max-md:grid-cols-1">
        {/* Est. VO2max (Running) */}
        {metrics.vo2max > 0 && (
          <div className="bg-linear-to-br from-accent/10 to-bg-tertiary border border-accent rounded-[var(--radius-md)] p-5 flex flex-col gap-2 relative transition-all duration-200 hover:border-border">
            <div className="size-9 bg-bg-secondary rounded-[var(--radius-sm)] flex items-center justify-center mb-2">
              <svg className="size-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="data-value text-[2rem] font-medium leading-tight text-text-primary">{metrics.vo2max}</span>
              <span className="text-sm text-text-secondary mt-1 font-medium">Est. VO2max (Running)</span>
              <span className="text-xs text-text-muted">ml/kg/min</span>
            </div>
            <span className={`absolute top-4 right-4 text-[0.75rem] py-1 px-2.5 rounded-[var(--radius-sm)] font-bold uppercase tracking-wide ${badgeClasses[metrics.vo2maxCategory.toLowerCase().replace(' ', '-')] || ''}`}>
              {metrics.vo2maxCategory}
            </span>
            <ComparisonBar
              value={metrics.vo2max}
              benchmark={benchmarks.vo2max}
              goodThreshold={benchmarks.vo2maxGood}
              unit="ml/kg/min"
              label={`Avg age ${age}`}
            />
          </div>
        )}

        {/* Best Pace */}
        {metrics.bestPace > 0 && (
          <div className="bg-bg-tertiary border border-border-subtle rounded-[var(--radius-md)] p-5 flex flex-col gap-2 relative transition-all duration-200 hover:border-border">
            <div className="size-9 bg-bg-secondary rounded-[var(--radius-sm)] flex items-center justify-center mb-2">
              <svg className="size-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="data-value text-[2rem] font-medium leading-tight text-text-primary">{formatPace(metrics.bestPace)}</span>
              <span className="text-sm text-text-secondary mt-1 font-medium">Best Pace</span>
              <span className="text-xs text-text-muted">min/km (runs 5km+)</span>
            </div>
          </div>
        )}

        {/* Avg Pace */}
        <div className="bg-bg-tertiary border border-border-subtle rounded-[var(--radius-md)] p-5 flex flex-col gap-2 relative transition-all duration-200 hover:border-border">
          <div className="size-9 bg-bg-secondary rounded-[var(--radius-sm)] flex items-center justify-center mb-2">
            <svg className="size-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="data-value text-[2rem] font-medium leading-tight text-text-primary">{formatPace(metrics.avgPace)}</span>
            <span className="text-sm text-text-secondary mt-1 font-medium">Avg Pace</span>
            <span className="text-xs text-text-muted">min/km across {metrics.totalRuns} runs</span>
          </div>
          <span className="text-xs text-text-muted mt-auto pt-3 border-t border-border-subtle">
            {metrics.totalDistance} km total
          </span>
        </div>

        {/* Avg Cadence */}
        {metrics.avgCadence > 0 && (
          <div className="bg-bg-tertiary border border-border-subtle rounded-[var(--radius-md)] p-5 flex flex-col gap-2 relative transition-all duration-200 hover:border-border">
            <div className="size-9 bg-bg-secondary rounded-[var(--radius-sm)] flex items-center justify-center mb-2">
              <svg className="size-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3v18h18" />
                <path d="M7 16l4-8 4 5 4-9" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="data-value text-[2rem] font-medium leading-tight text-text-primary">{metrics.avgCadence}</span>
              <span className="text-sm text-text-secondary mt-1 font-medium">Avg Cadence</span>
              <span className="text-xs text-text-muted">steps/min</span>
            </div>
            <span className="text-xs text-text-muted mt-auto pt-3 border-t border-border-subtle">
              {metrics.avgCadence >= 180 ? 'Optimal range' :
               metrics.avgCadence >= 170 ? 'Good range' : 'Consider increasing'}
            </span>
          </div>
        )}

        {/* Avg Heart Rate */}
        {metrics.avgHR > 0 && (
          <div className="bg-bg-tertiary border border-border-subtle rounded-[var(--radius-md)] p-5 flex flex-col gap-2 relative transition-all duration-200 hover:border-border">
            <div className="size-9 bg-bg-secondary rounded-[var(--radius-sm)] flex items-center justify-center mb-2">
              <svg className="size-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="data-value text-[2rem] font-medium leading-tight text-text-primary">{metrics.avgHR}</span>
              <span className="text-sm text-text-secondary mt-1 font-medium">Avg Heart Rate</span>
              <span className="text-xs text-text-muted">bpm across runs</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
