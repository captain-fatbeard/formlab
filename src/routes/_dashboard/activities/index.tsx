import { createFileRoute } from '@tanstack/react-router'
import { useDashboard } from '~/lib/dashboard-context'
import { ActivityList } from '~/components/ActivityList'

export const Route = createFileRoute('/_dashboard/activities/')({
  head: () => ({ meta: [{ title: 'Activities · FormLab' }] }),
  component: ActivitiesPage,
})

function ActivitiesPage() {
  const { activities } = useDashboard()

  return <ActivityList activities={activities} />
}
