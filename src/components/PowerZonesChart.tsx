import { useMemo } from 'react'
import { type StravaActivity } from '~/lib/strava'
import { getPowerZones, calculateZoneDistribution } from '~/lib/performance'
import { useDashboard } from '~/lib/dashboard-context'
import { zoneColors } from '~/lib/chart-theme'
import { ZoneDistribution, type ZoneRow } from './ZoneDistribution'
import { MetricTerm } from './MetricTerm'
import { sectionCard, cardTitle } from '~/lib/styles'
import { formatNumber } from '~/lib/format'

interface PowerZonesChartProps {
  activities: StravaActivity[]
}

export function PowerZonesChart({ activities }: PowerZonesChartProps) {
  // One FTP for the whole app — re-estimating it here from whatever slice this
  // chart was handed produced a different number to the one on every other page.
  const { profile } = useDashboard()
  const ftp = profile.ftp || null

  // Every zone, in Z1→Z7 order, including the ones with no time in them: a
  // zone you never touched is a fact about your training, not missing data.
  const zones = useMemo<ZoneRow[]>(() => {
    if (!ftp) return []
    const distribution = calculateZoneDistribution(activities, ftp)
    return getPowerZones(ftp).map((zone, i) => {
      const match = distribution.find((d) => d.zone === zone.name)
      return {
        key: `Z${i + 1}`,
        name: zone.name,
        range: `${formatNumber(zone.min)}–${zone.max === 9999 ? '∞' : formatNumber(zone.max)} W`,
        seconds: match?.time ?? 0,
        percentage: match?.percentage ?? 0,
        color: zoneColors[i] || zone.color,
      }
    })
  }, [activities, ftp])

  const hasTime = zones.some((z) => z.seconds > 0)

  if (!ftp || !hasTime) {
    return (
      <div className={sectionCard}>
        <h3 className={`${cardTitle} mb-5`}>Power zones</h3>
        <div className="text-text-muted text-center py-16 text-[0.9rem]">
          Need rides with power data to show zone distribution.
        </div>
      </div>
    )
  }

  return (
    <div className={sectionCard}>
      <div className="flex justify-between items-center mb-5 gap-3 max-md:flex-col max-md:items-start">
        <h3 className={cardTitle}>Power zones</h3>
        <span className="bg-accent/15 border border-accent/30 text-accent py-1 px-3.5 rounded-[var(--radius-sm)] text-[0.8125rem] font-semibold data-value">
          <MetricTerm id="ftp">FTP</MetricTerm> {formatNumber(ftp)} W
        </span>
      </div>

      <ZoneDistribution zones={zones} rangeHeader="Power" label="Time in power zones" />
    </div>
  )
}
