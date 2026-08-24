/** Benchmark comparison bar used by AdvancedMetrics and RunningMetrics */

interface ComparisonBarProps {
  value: number
  benchmark: number
  goodThreshold: number
  unit: string
  label: string
}

export function ComparisonBar({ value, benchmark, goodThreshold, unit, label }: ComparisonBarProps) {
  const diff = value - benchmark
  const diffPercent = Math.round((diff / benchmark) * 100)
  const isAbove = diff > 0

  const range = goodThreshold * 1.5
  const benchmarkPos = Math.min((benchmark / range) * 100, 95)
  const valuePos = Math.min(Math.max((value / range) * 100, 5), 95)

  return (
    <div className="mt-3 pt-3 border-t border-border-subtle">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.75rem] text-text-muted uppercase font-semibold tracking-wide">vs {label}</span>
        <span className={`text-xs font-bold ${isAbove ? 'text-success' : 'text-warning'}`}>
          {isAbove ? '+' : ''}{diffPercent}%
        </span>
      </div>
      <div className="relative h-2 bg-bg-secondary rounded-full overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full rounded-full bg-accent/80"
          style={{ width: `${valuePos}%` }}
        />
        <div
          className="absolute top-0 h-full w-0.5 bg-text-muted/60"
          style={{ left: `${benchmarkPos}%` }}
          title={`Average: ${benchmark} ${unit}`}
        />
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[0.75rem] text-text-muted">Avg: {benchmark} {unit}</span>
        <span className="text-[0.75rem] text-text-muted">Good: {goodThreshold}</span>
      </div>
    </div>
  )
}
