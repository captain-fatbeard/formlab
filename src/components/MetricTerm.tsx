import { Link } from '@tanstack/react-router'
import { GLOSSARY_TERMS } from '~/lib/glossary'

interface MetricTermProps {
  /** A key from `GLOSSARY_TERMS` — `tsb`, `ctl`, `np`… */
  id: string
  /** Override the displayed text; defaults to the term itself. */
  children?: React.ReactNode
}

/**
 * A metric name that carries its own definition: hover for the one-liner, click
 * for the full entry. The definitions already existed — they were 10px grey
 * explainer blocks under the charts. Attaching them to the term is what makes
 * them findable at the moment the reader is confused.
 */
export function MetricTerm({ id, children }: MetricTermProps) {
  const term = GLOSSARY_TERMS[id]
  if (!term) return <>{children ?? id}</>

  return (
    <Link
      to="/glossary"
      hash={id}
      title={`${term.full ? `${term.full} — ` : ''}${term.short}`}
      className="text-inherit no-underline border-b border-dotted border-text-muted hover:border-accent hover:text-accent transition-colors duration-150"
    >
      {children ?? term.term}
    </Link>
  )
}
