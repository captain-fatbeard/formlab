import { useMemo } from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { type StravaActivity } from '~/lib/strava'
import {
  getPowerZones,
  calculateZoneDistribution,
} from '~/lib/performance'
import { secondsToHMS } from '~/lib/strava'
import { useDashboard } from '~/lib/dashboard-context'
import { zoneColors, tooltipStyle } from '~/lib/chart-theme'

interface PowerZonesChartProps {
  activities: StravaActivity[]
}

export function PowerZonesChart({ activities }: PowerZonesChartProps) {
  // One FTP for the whole app — re-estimating it here from whatever slice this
  // chart was handed produced a different number to the one on every other page.
  const { profile } = useDashboard()
  const ftp = profile.ftp || null

  const zoneData = useMemo(() => {
    if (!ftp) return []
    const data = calculateZoneDistribution(activities, ftp)
    // Override colors with theme colors
    return data.map((d, i) => ({
      ...d,
      color: zoneColors[i] || d.color,
    }))
  }, [activities, ftp])

  const zones = useMemo(() => {
    if (!ftp) return []
    const z = getPowerZones(ftp)
    // Override colors with theme colors
    return z.map((zone, i) => ({
      ...zone,
      color: zoneColors[i] || zone.color,
    }))
  }, [ftp])

  if (!ftp || zoneData.length === 0) {
    return (
      <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 transition-all duration-200 hover:border-border max-md:p-4 max-[480px]:p-3.5">
        <h3 className="text-lg font-semibold mb-5 text-text-primary max-[480px]:text-base">Power Zones</h3>
        <div className="text-text-muted text-center py-16 text-[0.9rem]">
          Need rides with power data to show zone distribution.
        </div>
      </div>
    )
  }

  return (
    <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 transition-all duration-200 hover:border-border max-md:p-4 max-[480px]:p-3.5">
      <div className="flex justify-between items-center mb-5 max-md:flex-col max-md:items-start max-md:gap-3">
        <h3 className="text-lg font-semibold text-text-primary max-[480px]:text-base">Power Zones</h3>
        <span className="bg-linear-to-br from-accent to-accent-dark text-white py-1.5 px-4 rounded-full text-sm font-semibold shadow-[0_2px_8px_rgba(20,184,166,0.3)]">FTP: {ftp}W</span>
      </div>

      <div className="grid grid-cols-2 gap-8 items-start max-md:grid-cols-1">
        <div>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={zoneData}
                dataKey="time"
                nameKey="zone"
                cx="50%"
                cy="50%"
                outerRadius={90}
                innerRadius={50}
                paddingAngle={2}
                label={({ zone, percentage }) =>
                  percentage > 5 ? `${percentage}%` : ''
                }
                labelLine={false}
              >
                {zoneData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                {...tooltipStyle}
                formatter={(value: number, name: string) => [
                  secondsToHMS(value),
                  name,
                ]}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div>
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left p-3 text-text-muted font-semibold text-[0.7rem] uppercase tracking-wide border-b border-border">Zone</th>
                <th className="text-left p-3 text-text-muted font-semibold text-[0.7rem] uppercase tracking-wide border-b border-border">Power</th>
                <th className="text-left p-3 text-text-muted font-semibold text-[0.7rem] uppercase tracking-wide border-b border-border">Time</th>
              </tr>
            </thead>
            <tbody>
              {zones.map((zone) => {
                const data = zoneData.find((d) => d.zone === zone.name)
                return (
                  <tr key={zone.name}>
                    <td className="p-3 border-b border-border-subtle">
                      <span
                        className="inline-block size-3 rounded-full mr-2"
                        style={{ backgroundColor: zone.color }}
                      />
                      {zone.name}
                    </td>
                    <td className="p-3 border-b border-border-subtle">
                      {zone.min}-{zone.max === 9999 ? '∞' : zone.max}W
                    </td>
                    <td className="p-3 border-b border-border-subtle">{data ? secondsToHMS(data.time) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
