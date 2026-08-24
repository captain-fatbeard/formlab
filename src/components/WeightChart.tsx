import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { format, startOfWeek } from 'date-fns'
import { chartTheme, tooltipStyle, formatDateShort, formatDateFull } from '~/lib/chart-theme'
import type { WeightEntry } from '~/lib/storage/supabase-client'
import { RangeSelector } from './RangeSelector'
import { formatNumber } from '~/lib/format'
import { useModalPanel } from '~/lib/use-modal-panel'
import { cardTitle, buttonPrimary } from '~/lib/styles'
import { useLocalRange } from '~/lib/use-local-range'

interface WeightChartProps {
  entries: WeightEntry[]
  onAddEntry: (weight: number, recordedAt: Date) => Promise<boolean>
  onDeleteEntry: (id: string) => Promise<boolean>
}

export function WeightChart({ entries, onAddEntry, onDeleteEntry }: WeightChartProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [newWeight, setNewWeight] = useState('')
  const [newWeightDate, setNewWeightDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Follows the top-bar range unless deliberately overridden — this card used
  // to sit on its own 90 days while the two charts below it obeyed the global
  // filter, with nothing marking the difference.
  const range = useLocalRange()
  const days = range.days
  // A deleted entry is held here so it can be put back. Deleting used to be one
  // click on a glyph that mirrors the modal's own close button, with no confirm
  // and no way back.
  const [undoEntry, setUndoEntry] = useState<WeightEntry | null>(null)
  const undoTimer = useRef<number | null>(null)

  const closeModal = useCallback(() => setIsModalOpen(false), [])
  const modalRef = useModalPanel<HTMLDivElement>(isModalOpen, closeModal)

  useEffect(() => () => {
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
  }, [])

  const handleDelete = useCallback(
    async (entry: WeightEntry) => {
      const deleted = await onDeleteEntry(entry.id)
      if (!deleted) return
      setUndoEntry(entry)
      if (undoTimer.current) window.clearTimeout(undoTimer.current)
      undoTimer.current = window.setTimeout(() => setUndoEntry(null), 10_000)
    },
    [onDeleteEntry]
  )

  const handleUndo = useCallback(async () => {
    if (!undoEntry) return
    await onAddEntry(undoEntry.weight, new Date(undoEntry.recordedAt))
    setUndoEntry(null)
  }, [undoEntry, onAddEntry])

  const rangedEntries = useMemo(() => {
    if (days === 0) return entries
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    return entries.filter((e) => new Date(e.recordedAt) >= cutoff)
  }, [entries, days])

  const chartData = useMemo(() => {
    if (rangedEntries.length === 0) return []

    const sorted = [...rangedEntries].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    )

    // Group by week and compute averages
    const weekGroups = new Map<string, number[]>()
    for (const entry of sorted) {
      const weekKey = startOfWeek(new Date(entry.recordedAt), { weekStartsOn: 1 }).toISOString()
      const group = weekGroups.get(weekKey)
      if (group) {
        group.push(entry.weight)
      } else {
        weekGroups.set(weekKey, [entry.weight])
      }
    }

    const weekAvgs = new Map<string, number>()
    for (const [key, weights] of weekGroups) {
      weekAvgs.set(key, weights.reduce((sum, w) => sum + w, 0) / weights.length)
    }

    return sorted.map((entry) => {
      const weekKey = startOfWeek(new Date(entry.recordedAt), { weekStartsOn: 1 }).toISOString()
      return {
        date: entry.recordedAt,
        weight: entry.weight,
        weeklyAvg: weekAvgs.get(weekKey),
      }
    })
  }, [rangedEntries])

  const { minWeight, maxWeight } = useMemo(() => {
    if (chartData.length === 0) return { minWeight: 60, maxWeight: 90 }
    const weights = chartData.map((d) => d.weight)
    const min = Math.min(...weights)
    const max = Math.max(...weights)
    const padding = (max - min) * 0.1 || 2
    return {
      minWeight: Math.floor(min - padding),
      maxWeight: Math.ceil(max + padding),
    }
  }, [chartData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const weightValue = parseFloat(newWeight)
    if (isNaN(weightValue) || weightValue < 40 || weightValue > 150) return

    setIsSubmitting(true)
    const success = await onAddEntry(weightValue, new Date(newWeightDate))
    if (success) {
      setNewWeight('')
      setNewWeightDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"))
      setIsModalOpen(false)
    }
    setIsSubmitting(false)
  }

  const latestEntry = entries[0]
  const oldestEntry = entries[entries.length - 1]
  const weightChange = entries.length > 1 ? latestEntry.weight - oldestEntry.weight : 0

  // The lifetime change and the charted range are different windows, and the
  // page used to show a green "−13.8 kg" above a chart that rises. Both are
  // true; neither said which window it was describing.
  const rangeChange = useMemo(() => {
    if (rangedEntries.length < 2) return null
    const sorted = [...rangedEntries].sort(
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
    )
    return sorted[sorted.length - 1].weight - sorted[0].weight
  }, [rangedEntries])

  const rangeLabel = days === 0 ? 'All time' : `Last ${days} days`

  const changeColour = (change: number) =>
    change < 0
      ? chartTheme.colors.semantic.positive
      : change > 0
        ? chartTheme.colors.semantic.negative
        : chartTheme.colors.neutral[400]

  return (
    <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 transition-all duration-200 hover:border-border max-md:p-4 max-[480px]:p-3.5">
      <div className="flex justify-between items-start mb-5 gap-4 max-md:flex-col max-md:items-start max-md:gap-3">
        <div className="flex items-center gap-4 flex-wrap">
          <h3 className={cardTitle}>Weight History</h3>
          <RangeSelector
            days={days}
            onChange={range.setDays}
            globalDays={range.globalDays}
            isOverride={range.isOverride}
            onReset={range.reset}
          />
        </div>
        <div className="flex items-start gap-6 max-md:gap-4">
          {entries.length > 0 && (
            <div className="flex gap-8 flex-wrap max-md:gap-4">
              <span className="flex flex-col items-start">
                <span className="text-[0.75rem] text-text-muted uppercase font-semibold tracking-wide">Current</span>
                <span className="data-value text-xl font-medium" style={{ color: chartTheme.colors.primary.main }}>
                  {formatNumber(latestEntry.weight, 1)} kg
                </span>
                <span className="text-[0.75rem] text-text-muted">{formatDateFull(latestEntry.recordedAt)}</span>
              </span>

              {rangeChange != null && (
                <span className="flex flex-col items-start">
                  <span className="text-[0.75rem] text-text-muted uppercase font-semibold tracking-wide">Change</span>
                  <span className="data-value text-xl font-medium" style={{ color: changeColour(rangeChange) }}>
                    {rangeChange > 0 ? '+' : ''}{formatNumber(rangeChange, 1)} kg
                  </span>
                  <span className="text-[0.75rem] text-text-muted">{rangeLabel} — as charted</span>
                </span>
              )}

              {entries.length > 1 && (
                <span className="flex flex-col items-start">
                  <span className="text-[0.75rem] text-text-muted uppercase font-semibold tracking-wide">Change</span>
                  <span className="data-value text-xl font-medium" style={{ color: changeColour(weightChange) }}>
                    {weightChange > 0 ? '+' : ''}{formatNumber(weightChange, 1)} kg
                  </span>
                  <span className="text-[0.75rem] text-text-muted">
                    Since {formatDateFull(oldestEntry.recordedAt)}
                  </span>
                </span>
              )}
            </div>
          )}
          <button
            className="flex items-center justify-center bg-bg-tertiary border border-border text-text-secondary size-9 rounded-[var(--radius-sm)] cursor-pointer transition-all duration-150 shrink-0 hover:bg-accent hover:border-accent hover:text-bg-primary"
            onClick={() => setIsModalOpen(true)}
            aria-label="Add weight entry"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="text-text-muted text-center py-16 text-[0.9rem]">
          No weight entries yet. Click the + button to add your first entry.
        </div>
      ) : chartData.length < 2 ? (
        <div className="text-text-muted text-center py-16 text-[0.9rem]">
          {chartData.length === 1 ? 'One reading' : 'No readings'} in {rangeLabel.toLowerCase()} — not
          enough to draw a line. Widen the range or add an entry.
        </div>
      ) : (
        <>
        <div className="flex justify-end gap-5 mb-2 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 rounded-full" style={{ backgroundColor: chartTheme.colors.primary.main }} />
            Weight
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 rounded-full border-t-2 border-dashed" style={{ borderColor: chartTheme.colors.amber.main }} />
            Weekly average
          </span>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <defs>
              <linearGradient id="weightGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartTheme.colors.primary.main} stopOpacity={0.3} />
                <stop offset="100%" stopColor={chartTheme.colors.primary.main} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis
              dataKey="date"
              stroke={chartTheme.axis}
              fontSize={12}
              tickFormatter={(date) => formatDateShort(date)}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke={chartTheme.axis}
              fontSize={12}
              domain={[minWeight, maxWeight]}
              tickFormatter={(value) => `${value} kg`}
            />
            <Tooltip
              {...tooltipStyle}
              labelFormatter={(date) => formatDateFull(date as string)}
              formatter={(value: number | undefined, name: string) => [
                `${formatNumber(value ?? 0, 1)} kg`,
                name === 'weeklyAvg' ? 'Weekly average' : 'Weight',
              ]}
            />
            {/* Linear, with a dot on every reading. `monotone` drew a smooth
                S-curve through five points ninety days apart, which invented a
                gradual gain that the data does not contain. */}
            <Line
              type="linear"
              dataKey="weight"
              stroke={chartTheme.colors.primary.main}
              strokeWidth={2}
              dot={{ fill: chartTheme.colors.primary.main, strokeWidth: 0, r: 4 }}
              activeDot={{ fill: chartTheme.colors.primary.light, strokeWidth: 0, r: 6 }}
            />
            {/* Also linear: `stepAfter` drew a square wave over the readings,
                which read as a rendering fault rather than as an average. */}
            <Line
              type="linear"
              dataKey="weeklyAvg"
              name="weeklyAvg"
              stroke={chartTheme.colors.amber.main}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              activeDot={{ fill: chartTheme.colors.amber.main, strokeWidth: 0, r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
        </>
      )}

      {isModalOpen && (
        <>
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] animate-fade-in" onClick={() => setIsModalOpen(false)} />
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="weight-modal-title"
            className="modal-center bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-6 w-[90%] max-w-[400px] z-[101] shadow-lg animate-modal-slide-in"
          >
            <div className="flex justify-between items-center mb-5 pb-4 border-b border-border-subtle">
              <h4 id="weight-modal-title" className="text-lg font-semibold text-text-primary m-0">Add weight entry</h4>
              <button
                className="flex items-center justify-center bg-bg-tertiary border border-border text-text-secondary size-8 rounded-[var(--radius-sm)] cursor-pointer transition-all duration-150 hover:bg-bg-elevated hover:text-text-primary hover:border-text-muted"
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="grid grid-cols-[1fr_1.5fr] gap-3 max-[480px]:grid-cols-1">
                <div className="flex flex-col gap-2">
                  <label htmlFor="weight-value" className="text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold">Weight (kg)</label>
                  <input
                    id="weight-value"
                    type="number"
                    step="0.1"
                    min="40"
                    max="150"
                    value={newWeight}
                    onChange={(e) => setNewWeight(e.target.value)}
                    placeholder="75.0"
                    className="w-full bg-bg-tertiary border border-border text-text-primary py-2.5 px-3.5 rounded-[var(--radius-sm)] text-sm transition-all duration-150 placeholder:text-text-muted hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="weight-recorded-at" className="text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold">Date &amp; time</label>
                  <input
                    id="weight-recorded-at"
                    type="datetime-local"
                    value={newWeightDate}
                    onChange={(e) => setNewWeightDate(e.target.value)}
                    max={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                    className="w-full bg-bg-tertiary border border-border text-text-primary py-2.5 px-3.5 rounded-[var(--radius-sm)] text-sm transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
                  />
                </div>
              </div>
              <button
                type="submit"
                className={`${buttonPrimary} w-full`}
                disabled={isSubmitting || !newWeight}
              >
                {isSubmitting ? 'Adding…' : 'Add entry'}
              </button>
            </form>

            {entries.length > 0 && (
              <div className="mt-5 pt-5 border-t border-border-subtle">
                <h5 className="text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold mb-3">Recent entries</h5>
                <ul className="list-none flex flex-col gap-2">
                  {entries.slice(0, 5).map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 py-2 px-3 bg-bg-tertiary rounded-[var(--radius-sm)] text-sm">
                      <span className="text-text-secondary min-w-[50px]">
                        {formatDateFull(entry.recordedAt)}
                      </span>
                      <span className="flex-1 text-text-primary font-medium data-value">
                        {formatNumber(entry.weight, 1)} kg
                      </span>
                      {/* A bin, not another ✕ — the delete used to be the same
                          glyph at the same size as the modal's close button a
                          few centimetres above it. */}
                      <button
                        type="button"
                        className="bg-transparent border-none text-text-muted p-1 rounded-[var(--radius-sm)] cursor-pointer flex items-center justify-center transition-all duration-150 hover:text-danger hover:bg-danger-muted"
                        onClick={() => handleDelete(entry)}
                        aria-label={`Delete entry from ${formatDateFull(entry.recordedAt)}`}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>

                {undoEntry && (
                  <div
                    role="status"
                    className="flex items-center justify-between gap-3 mt-3 py-2 px-3 bg-bg-elevated border border-border rounded-[var(--radius-sm)] text-[0.8125rem]"
                  >
                    <span className="text-text-secondary">
                      Deleted {formatNumber(undoEntry.weight, 1)} kg from {formatDateFull(undoEntry.recordedAt)}.
                    </span>
                    <button
                      type="button"
                      onClick={handleUndo}
                      className="text-accent font-semibold cursor-pointer bg-transparent border-none hover:underline"
                    >
                      Undo
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
