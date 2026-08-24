import { createFileRoute } from '@tanstack/react-router'
import { GLOSSARY } from '~/lib/glossary'
import { PageHeader } from '~/components/PageHeader'
import { sectionCard } from '~/lib/styles'

export const Route = createFileRoute('/_dashboard/glossary')({
  head: () => ({ meta: [{ title: 'Glossary · FormLab' }] }),
  component: GlossaryPage,
})

function GlossaryPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Glossary"
        description="What every metric in FormLab means, and how to read it. The architecture — where the numbers come from and what is cached — lives in Docs."
        scope="none"
      />

      {GLOSSARY.map((group) => (
        <section key={group.title} className={sectionCard}>
          <h2 className="text-xl font-semibold text-text-primary">{group.title}</h2>
          <p className="text-sm text-text-secondary mt-1 mb-6">{group.blurb}</p>

          <dl className="flex flex-col gap-6">
            {group.terms.map((term) => (
              <div
                key={term.id}
                id={term.id}
                className="scroll-mt-24 border-l-2 border-border-subtle pl-5 target:border-accent"
              >
                <dt className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="text-base font-semibold text-text-primary">{term.term}</span>
                  {term.full && (
                    <span className="text-[0.75rem] text-text-muted uppercase tracking-wider">
                      {term.full}
                    </span>
                  )}
                </dt>
                <dd className="mt-1.5 max-w-[80ch]">
                  <p className="text-sm text-text-secondary leading-relaxed">{term.long}</p>
                  {term.reading && (
                    <p className="text-[0.8125rem] text-text-muted leading-relaxed mt-1.5">
                      <span className="text-text-secondary font-medium">Reading it: </span>
                      {term.reading}
                    </p>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}
