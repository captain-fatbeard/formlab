import { createFileRoute } from '@tanstack/react-router'
import { useDashboard } from '~/lib/dashboard-context'
import { ActivityList } from '~/components/ActivityList'
import { PageHeader } from '~/components/PageHeader'

export const Route = createFileRoute('/_dashboard/activities/')({
  head: () => ({ meta: [{ title: 'Activities · FormLab' }] }),
  component: ActivitiesPage,
})

function ActivitiesPage() {
  const { activities } = useDashboard()

  return (
    <div className="flex flex-col gap-6">
      {/* The list carries its own filters and ignores the top-bar ones, so the
          scope line says all-time rather than implying otherwise. */}
      <PageHeader
        title="Activities"
        description="Every ride and run, searchable, filterable and groupable."
        scope="lifetime"
        count={activities.length}
      />
      <ActivityList activities={activities} />
    </div>
  )
}
