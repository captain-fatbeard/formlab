import { createFileRoute } from '@tanstack/react-router'
import { useDashboard } from '~/lib/dashboard-context'
import { StatsCards } from '~/components/StatsCards'
import { ActivityCalendar } from '~/components/ActivityCalendar'
import { PersonalRecords } from '~/components/PersonalRecords'
import { PageHeader } from '~/components/PageHeader'
import { sectionHeading } from '~/lib/styles'

export const Route = createFileRoute('/_dashboard/overview')({
  head: () => ({ meta: [{ title: 'Overview · FormLab' }] }),
  component: OverviewPage,
})

function OverviewPage() {
  const { lifetimeStats, lifetimeMergedActivities, activities } = useDashboard()

  return (
    <div className="flex flex-col gap-8">
      {/* Deliberately lifetime: these totals ignore the top-bar filters, which
          is exactly why the header has to say so. */}
      <PageHeader
        title="Overview"
        description="Everything you have ridden and run, and how this year is going."
        scope="lifetime"
        count={lifetimeStats.totalActivities}
      />

      <section>
        <h2 className={`${sectionHeading} mb-5`}>All-time totals</h2>
        <StatsCards stats={lifetimeStats} />
      </section>
      {/* Unmerged, unfiltered: the grid is about which days you trained, so a
          grouped double day still shows as one active day but keeps both
          activities in the hover detail. */}
      <ActivityCalendar activities={activities} />
      <PersonalRecords activities={lifetimeMergedActivities} />
    </div>
  )
}
