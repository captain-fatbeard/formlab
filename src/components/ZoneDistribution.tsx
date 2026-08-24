import { formatDuration } from '~/lib/format'

export interface ZoneRow {
  /** Z1…Z7 — the ordering label, shown in both bar and table. */
  key: string
  name: string
  /** The band itself: `120-160W`, `142-158 bpm`. */
  range: string
  seconds: number
  percentage: number
  color: string
}

interface ZoneDistributionProps {
  zones: ZoneRow[]
  /** Column header for the range column. */
  rangeHeader: string
  /** Described to screen readers as the bar's accessible name. */
  label: string
}

/**
 * Time-in-zone as a full-width stacked bar with the table beneath it.
 *
 * This replaces a ~150px donut sitting in a ~450px column, which spent half the
 * card on whitespace, ordered its legend differently from the table beside it,
 * and rendered an untouched zone as `-` — indistinguishable from "unknown".
 * Every zone gets a row here, at zero if that is what the data says.
 */
export function ZoneDistribution({ zones, rangeHeader, label }: ZoneDistributionProps) {
  const total = zones.reduce((sum, z) => sum + z.seconds, 0)

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div
          className="flex w-full h-9 rounded-[var(--radius-sm)] overflow-hidden bg-bg-tertiary"
          role="img"
          aria-label={`${label}: ${zones
            .filter((z) => z.seconds > 0)
            .map((z) => `${z.name} ${z.percentage}%`)
            .join(', ')}`}
        >
          {zones.map((zone) =>
            zone.seconds === 0 ? null : (
              <div
                key={zone.key}
                className="flex items-center justify-center text-[0.75rem] font-semibold text-bg-primary overflow-hidden"
                style={{ width: `${zone.percentage}%`, backgroundColor: zone.color }}
                title={`${zone.name} — ${formatDuration(zone.seconds)} (${zone.percentage}%)`}
              >
                {zone.percentage >= 8 ? `${zone.percentage}%` : ''}
              </div>
            )
          )}
        </div>
        <p className="text-[0.75rem] text-text-muted mt-2">
          {formatDuration(total)} recorded across {zones.length} zones
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2 px-3 text-text-muted font-semibold text-[0.75rem] uppercase tracking-wide border-b border-border">
                Zone
              </th>
              <th className="text-left py-2 px-3 text-text-muted font-semibold text-[0.75rem] uppercase tracking-wide border-b border-border">
                {rangeHeader}
              </th>
              <th className="text-right py-2 px-3 text-text-muted font-semibold text-[0.75rem] uppercase tracking-wide border-b border-border">
                Time
              </th>
              <th className="text-right py-2 px-3 text-text-muted font-semibold text-[0.75rem] uppercase tracking-wide border-b border-border">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {zones.map((zone) => (
              <tr key={zone.key} className={zone.seconds === 0 ? 'text-text-muted' : undefined}>
                <td className="py-2.5 px-3 border-b border-border-subtle whitespace-nowrap">
                  <span
                    className="inline-block size-3 rounded-full mr-2 align-middle"
                    style={{ backgroundColor: zone.color }}
                  />
                  <span className="text-text-muted mr-1.5">{zone.key}</span>
                  {zone.name}
                </td>
                <td className="py-2.5 px-3 border-b border-border-subtle text-text-secondary data-value whitespace-nowrap">
                  {zone.range}
                </td>
                <td className="py-2.5 px-3 border-b border-border-subtle text-right data-value whitespace-nowrap">
                  {zone.seconds === 0 ? '0m' : formatDuration(zone.seconds)}
                </td>
                <td className="py-2.5 px-3 border-b border-border-subtle text-right data-value font-medium">
                  {zone.percentage}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
