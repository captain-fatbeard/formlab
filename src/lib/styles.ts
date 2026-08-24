/** Shared CSS class constants used across multiple components */

/* ── Heading scale ────────────────────────────────────────────────────────
 * Three levels, used consistently: a page has one title, a page has sections,
 * a section holds cards. Before this, a card title inside a card was heavier
 * than the section heading above it, and Records and Performance each had a
 * gradient variant of their own. */

/** Page title — one per page, rendered by `PageHeader`. */
export const pageTitle =
  'text-[2rem] font-semibold tracking-tight text-text-primary leading-tight max-md:text-2xl'

/** Section heading — groups cards within a page. */
export const sectionHeading = 'text-xl font-semibold text-text-primary max-[480px]:text-lg'

/** Card title — the heading inside a single card. */
export const cardTitle = 'text-base font-semibold text-text-primary'

/* ── Buttons ──────────────────────────────────────────────────────────────
 * White on the teal accent measures 2.5:1. Dark on the same teal measures
 * 7.9:1 and looks better, so that is the primary button everywhere. */

/* ── Filters ──────────────────────────────────────────────────────────────
 * The compact select used by the top-bar filters and the activities toolbar.
 * Shared so the two can't drift apart — the top-bar pills used to carry their
 * own geometry, chevron and hover colour. */

const FILTER_SELECT_BASE =
  'custom-select bg-bg-tertiary border border-border text-text-secondary py-1.5 pr-8 pl-3 rounded-[var(--radius-sm)] text-[0.75rem] cursor-pointer transition-colors duration-150 hover:border-text-muted shrink-0'

/** A real `<select>`. */
export const filterSelect =
  `${FILTER_SELECT_BASE} focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15`

/** A wrapper holding an invisible native select, for a control that shows a
 *  shorter label than the option it has selected. */
export const filterSelectShell =
  `${FILTER_SELECT_BASE} relative flex items-center whitespace-nowrap focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15`

/** Primary action — dark text on accent. */
export const buttonPrimary =
  'bg-accent text-bg-primary border border-accent py-2.5 px-5 rounded-[var(--radius-md)] text-sm font-semibold cursor-pointer transition-all duration-200 no-underline inline-flex items-center justify-center gap-2 hover:bg-accent-light hover:border-accent-light disabled:opacity-50 disabled:cursor-not-allowed'

/** Secondary action — quiet, on the card background. */
export const buttonSecondary =
  'bg-bg-tertiary border border-border text-text-secondary py-2.5 px-5 rounded-[var(--radius-md)] text-sm font-medium cursor-pointer transition-all duration-200 no-underline inline-flex items-center justify-center gap-2 hover:bg-bg-elevated hover:text-text-primary hover:border-text-muted disabled:opacity-50 disabled:cursor-not-allowed'

/** Standard stat card container */
export const statCard =
  'bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-6 flex flex-col gap-2 transition-all duration-200 card-accent-top hover:border-border hover:-translate-y-0.5 hover:shadow-md max-md:p-4 max-[480px]:p-3.5'

/** Accent-highlighted stat card (primary metric) */
export const statCardAccent =
  `${statCard} bg-linear-to-br from-accent/15 to-accent/5 border-accent/30`

/** Large gradient stat value text — monospace for data precision */
export const statValue =
  'data-value text-[2rem] font-medium leading-tight bg-linear-to-br from-text-primary to-text-secondary bg-clip-text text-transparent max-md:text-2xl max-[480px]:text-xl'

/** Accent gradient stat value text — monospace */
export const statValueAccent =
  'data-value text-[2rem] font-medium leading-tight bg-linear-to-br from-accent-light to-accent bg-clip-text text-transparent max-md:text-2xl max-[480px]:text-xl'

/** Standard section/card container */
export const sectionCard =
  'bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 transition-all duration-200 hover:border-border max-md:p-4 max-[480px]:p-3.5'

/** Info/help box at the bottom of a section */
export const infoBox =
  'p-5 bg-bg-tertiary rounded-[var(--radius-md)] text-[0.8rem] text-text-secondary leading-relaxed'

/** Trend direction badge classes */
export const trendClasses: Record<string, string> = {
  improving: 'bg-success-muted text-success',
  declining: 'bg-danger-muted text-danger',
  stable: 'bg-warning-muted text-warning',
}

/** Performance level badge classes */
export const badgeClasses: Record<string, string> = {
  elite: 'bg-accent/20 text-accent',
  excellent: 'bg-success-muted text-success',
  good: 'bg-info-muted text-info',
  average: 'bg-warning-muted text-warning',
  'below-average': 'bg-danger-muted text-danger',
}
