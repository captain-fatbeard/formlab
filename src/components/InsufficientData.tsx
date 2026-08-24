import { formatNumber } from '~/lib/format'

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']

interface InsufficientDataProps {
  /** How many points there actually are. */
  count: number
  /** How many the chart needs before a trend means anything. */
  needed: number
  /** What is being counted — `runs`, `rides`, `readings`. */
  noun: string
  /** What the reader could do about it. */
  hint?: string
}

/**
 * The state between empty and useful.
 *
 * Every empty-state check in the app tested for `length === 0`, so a two-point
 * "Pace Trend" still drew a chart: a flat line between two dates with a y-axis
 * spanning twenty seconds, which reads as a bug rather than as thin data.
 */
export function InsufficientData({ count, needed, noun, hint }: InsufficientDataProps) {
  const counted = count < WORDS.length ? WORDS[count].toLowerCase() : formatNumber(count)
  const single = noun.replace(/s$/, '')

  return (
    <div className="text-center py-16 px-4">
      <p className="text-text-secondary text-[0.9rem]">
        {counted === 'one' ? 'One' : counted.charAt(0).toUpperCase() + counted.slice(1)}{' '}
        {count === 1 ? single : noun} in this range — not enough to show a trend.
      </p>
      <p className="text-[0.8125rem] text-text-muted mt-1.5">
        {hint ?? `Needs at least ${needed}. Widen the time range in the top bar.`}
      </p>
    </div>
  )
}

/** Fewer points than this and a line chart is drawing noise. */
export const MIN_TREND_POINTS = 5
