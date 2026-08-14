interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

/** Page numbers to show: always the first and last, the current one and its
 * neighbours, and a gap marker where the run is broken. Shared with the
 * calendar's year pager so both elide the same way. */
export function pageRange(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const pages: (number | 'gap')[] = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  if (start > 2) pages.push('gap')
  for (let p = start; p <= end; p++) pages.push(p)
  if (end < total - 1) pages.push('gap')
  pages.push(total)
  return pages
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  if (totalPages <= 1) return null

  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize + 1
  const end = Math.min(safePage * pageSize, total)

  const btnBase =
    'inline-flex items-center justify-center min-w-8 h-8 px-2 text-xs font-medium rounded-[var(--radius-sm)] border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'
  const btnIdle =
    'bg-bg-tertiary border-border-subtle text-text-secondary hover:bg-bg-elevated hover:text-text-primary hover:border-border'
  const btnActive = 'bg-accent/20 border-accent/40 text-accent'

  return (
    <div className="flex items-center justify-between gap-3 mt-4 max-md:flex-col max-md:items-stretch max-md:gap-2">
      <div className="text-xs text-text-muted">
        Showing {start.toLocaleString('da-DK')}–{end.toLocaleString('da-DK')} of{' '}
        {total.toLocaleString('da-DK')}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          className={`${btnBase} ${btnIdle}`}
          onClick={() => onPageChange(safePage - 1)}
          disabled={safePage <= 1}
          aria-label="Previous page"
        >
          ‹ Prev
        </button>
        {pageRange(safePage, totalPages).map((p, i) =>
          p === 'gap' ? (
            <span key={`gap-${i}`} className="text-xs text-text-muted px-1">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              className={`${btnBase} ${p === safePage ? btnActive : btnIdle}`}
              onClick={() => onPageChange(p)}
              aria-current={p === safePage ? 'page' : undefined}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          className={`${btnBase} ${btnIdle}`}
          onClick={() => onPageChange(safePage + 1)}
          disabled={safePage >= totalPages}
          aria-label="Next page"
        >
          Next ›
        </button>
      </div>
    </div>
  )
}
