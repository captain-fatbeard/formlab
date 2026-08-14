import { createFileRoute } from '@tanstack/react-router'
import { useDashboard } from '~/lib/dashboard-context'
import { StatsCards } from '~/components/StatsCards'
import { ActivityCalendar } from '~/components/ActivityCalendar'
import { PersonalRecords } from '~/components/PersonalRecords'

export const Route = createFileRoute('/_dashboard/overview')({
  component: OverviewPage,
})

function OverviewPage() {
  const { lifetimeStats, lifetimeMergedActivities, activities } = useDashboard()

  return (
    <div className="flex flex-col gap-8">
      <StatsCards stats={lifetimeStats} />
      {/* Unmerged, unfiltered: the grid is about which days you trained, so a
          grouped double day still shows as one active day but keeps both
          activities in the hover detail. */}
      <ActivityCalendar activities={activities} />
      <PersonalRecords activities={lifetimeMergedActivities} />
    </div>
  )
}
