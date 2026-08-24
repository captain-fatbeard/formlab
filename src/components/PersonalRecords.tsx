import { useMemo } from 'react'
import { type StravaActivity } from '~/lib/strava'
import { calculatePersonalRecords } from '~/lib/performance'
import { formatDateFull } from '~/lib/chart-theme'
import { cardTitle } from '~/lib/styles'

interface PersonalRecordsProps {
  activities: StravaActivity[]
}

export function PersonalRecords({ activities }: PersonalRecordsProps) {
  const records = useMemo(() => calculatePersonalRecords(activities), [activities])

  if (records.length === 0) {
    return null
  }

  return (
    <div className="mb-10">
      <h3 className={`${cardTitle} mb-5`}>Personal records</h3>
      <div className="card-stagger grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-5 max-md:grid-cols-2 max-md:gap-3 max-[480px]:gap-2">
        {records.map((record, index) => (
          <div key={index} className="card-accent-top bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-6 text-center transition-all duration-200 min-w-0 overflow-hidden hover:border-border hover:-translate-y-0.5 hover:shadow-md max-[480px]:p-3.5">
            <div className="text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold mb-3 max-[480px]:text-[0.75rem] max-[480px]:mb-2">{record.type}</div>
            <div className="data-value text-4xl font-medium bg-linear-to-br from-accent-light to-accent bg-clip-text text-transparent leading-tight break-words max-md:text-[1.75rem] max-[480px]:text-[1.375rem]">
              {record.type === 'Best Pace (5km+)' ? record.unit : record.value}
              {record.type !== 'Best Pace (5km+)' && (
                <span className="font-[var(--font-display)] text-base font-medium text-text-secondary ml-1 max-[480px]:text-xs">{record.unit}</span>
              )}
            </div>
            <div className="text-sm text-text-primary mt-3 overflow-hidden text-ellipsis whitespace-nowrap font-medium min-w-0 max-[480px]:text-xs">
              {record.activity.name}
            </div>
            <div className="data-value text-xs text-text-muted mt-1">
              {formatDateFull(record.date)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
