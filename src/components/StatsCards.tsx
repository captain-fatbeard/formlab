import type { DashboardStats } from '~/lib/dashboard-context'
import { formatNumber, formatDistance, formatElevation, formatDuration } from '~/lib/format'
import { statCard, statValue, statValueAccent } from '~/lib/styles'
import { MetricTerm } from '~/components/MetricTerm'

interface StatsCardsProps {
  stats: DashboardStats
}

interface StatCardProps {
  value: string
  label: React.ReactNode
  hint: React.ReactNode
  accent?: boolean
}

function StatCard({ value, label, hint, accent = false }: StatCardProps) {
  return (
    <div
      className={
        accent
          ? 'relative bg-linear-to-br from-accent/[0.1] to-bg-secondary border border-accent/40 rounded-[var(--radius-lg)] p-6 flex flex-col gap-2 transition-all duration-200 shadow-[0_0_30px_rgba(20,184,166,0.08)] hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(20,184,166,0.15)] max-md:p-4 max-[480px]:p-3.5 overflow-hidden'
          : statCard
      }
    >
      {accent && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-linear-to-r from-transparent via-accent to-transparent" />
      )}
      {/* Every value sits at the same type size, so the row shares a baseline —
          the time card used to be two steps smaller to fit `715:46:14`. */}
      <span className={accent ? statValueAccent : statValue}>{value}</span>
      <span className="text-sm text-text-secondary font-medium">{label}</span>
      <span className="text-[0.75rem] text-text-muted">{hint}</span>
    </div>
  )
}

/**
 * The eight all-time totals on Overview.
 *
 * Fixed four-column grid rather than `auto-fit`: at 1440px auto-fit produced
 * seven columns for eight cards and stranded the eighth alone on its own row.
 */
export function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="card-stagger grid grid-cols-4 gap-5 max-lg:grid-cols-2 max-md:gap-3 max-[480px]:gap-2">
      <StatCard
        value={formatNumber(stats.totalActivities)}
        label="Activities"
        hint={`${formatNumber(stats.rides)} rides, ${formatNumber(stats.runs)} runs`}
      />
      <StatCard
        value={formatDistance(stats.totalDistance, 0)}
        label="Kilometres"
        hint="Total distance"
      />
      <StatCard
        value={formatElevation(stats.totalElevation)}
        label="Metres climbed"
        hint="Total elevation"
      />
      <StatCard
        value={formatDuration(stats.totalTime)}
        label="Time"
        hint="Total moving time"
      />

      {stats.ftp > 0 && (
        <StatCard
          accent
          value={formatNumber(stats.ftp)}
          label={<MetricTerm id="ftp">Est. FTP</MetricTerm>}
          hint="Functional Threshold Power"
        />
      )}
      {stats.wattsPerKilo > 0 && (
        <StatCard
          accent
          value={formatNumber(stats.wattsPerKilo, 2)}
          label={<MetricTerm id="wkg">W/kg</MetricTerm>}
          hint="Watts per kilogram"
        />
      )}
      {stats.avgPower > 0 && (
        <StatCard
          value={formatNumber(stats.avgPower)}
          label="Avg watts"
          hint="Average power"
        />
      )}
      {stats.avgHR > 0 && (
        <StatCard
          value={formatNumber(stats.avgHR)}
          label="Avg HR"
          hint="Average heart rate"
        />
      )}
    </div>
  )
}
