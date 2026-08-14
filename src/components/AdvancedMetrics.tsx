import { useMemo, useState } from 'react'
import { type StravaActivity } from '~/lib/strava'
import { calculateAdvancedMetrics, estimateVO2max, getVO2maxCategory } from '~/lib/performance'
import { badgeClasses } from '~/lib/styles'
import { useDashboard, type Gender } from '~/lib/dashboard-context'

interface AdvancedMetricsProps {
  activities: StravaActivity[]
  weight: number
  age: number
  gender: Gender
}

export function AdvancedMetrics({ activities, weight, age, gender }: AdvancedMetricsProps) {
  const { profile } = useDashboard()
  const ftp = profile.ftp
  const [sliderWeight, setSliderWeight] = useState(weight)

  const metrics = useMemo(() => calculateAdvancedMetrics(activities, ftp, weight, age, gender), [activities, ftp, weight, age, gender])

  const sliderVo2max = useMemo(() => estimateVO2max(ftp, sliderWeight), [ftp, sliderWeight])
  const sliderVo2maxCategory = useMemo(() => getVO2maxCategory(sliderVo2max, age, gender), [sliderVo2max, age, gender])

  if (ftp === 0) return null

  return (
    <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1">
      {/* VO2max */}
      <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-6 flex flex-col gap-2 relative">
        <div className="flex items-start justify-between">
          <div className="size-9 bg-bg-tertiary rounded-[var(--radius-sm)] flex items-center justify-center">
            <svg className="size-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <span className={`text-[0.65rem] py-1 px-2.5 rounded-full font-bold uppercase tracking-wide ${badgeClasses[sliderVo2maxCategory.toLowerCase().replace(' ', '-')] || ''}`}>
            {sliderVo2maxCategory}
          </span>
        </div>
        <span className="data-value text-[2.5rem] font-medium leading-tight text-text-primary mt-2">{sliderVo2max}</span>
        <span className="text-sm text-text-secondary font-medium">Est. VO2max</span>
        <span className="text-xs text-text-muted">ml/kg/min · estimated from FTP & weight</span>

        <div className="mt-3 pt-3 border-t border-border-subtle">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-text-muted">Weight</span>
            <span className="text-xs font-semibold text-text-primary">{sliderWeight} kg</span>
          </div>
          <input
            type="range"
            min={40}
            max={150}
            step={0.5}
            value={sliderWeight}
            onChange={(e) => setSliderWeight(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-border-subtle accent-accent"
          />
          <div className="flex justify-between text-[0.6rem] text-text-muted mt-1">
            <span>40 kg</span>
            {sliderWeight !== weight ? (
              <button
                onClick={() => setSliderWeight(weight)}
                className="text-accent hover:text-accent/80 font-medium cursor-pointer"
              >
                Reset to {weight} kg
              </button>
            ) : (
              <span>Drag to see what-if</span>
            )}
            <span>150 kg</span>
          </div>
        </div>
      </div>

      {/* Efficiency Factor */}
      {metrics.avgEF > 0 ? (
        <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-6 flex flex-col gap-2 relative">
          <div className="flex items-start justify-between">
            <div className="size-9 bg-bg-tertiary rounded-[var(--radius-sm)] flex items-center justify-center">
              <svg className="size-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </div>
            <span className="text-[0.65rem] py-1 px-2.5 rounded-full font-bold uppercase tracking-wide text-text-muted bg-bg-tertiary">
              Best {metrics.bestEF}
            </span>
          </div>
          <span className="data-value text-[2.5rem] font-medium leading-tight text-text-primary mt-2">{metrics.avgEF}</span>
          <span className="text-sm text-text-secondary font-medium">Avg Efficiency Factor</span>
          <span className="text-xs text-text-muted">NP / Avg HR · higher means more power at the same effort</span>
        </div>
      ) : (
        <div className="bg-bg-secondary border border-border-subtle border-dashed rounded-[var(--radius-lg)] p-6 flex items-center justify-center text-sm text-text-muted">
          Need rides with power + heart rate for EF
        </div>
      )}
    </div>
  )
}
