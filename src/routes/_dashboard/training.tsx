import { createFileRoute } from '@tanstack/react-router'
import { useDashboard } from '~/lib/dashboard-context'
import { FitnessChart } from '~/components/FitnessChart'
import { PowerZonesChart } from '~/components/PowerZonesChart'
import { WeeklyProgress } from '~/components/WeeklyProgress'
import { PageHeader } from '~/components/PageHeader'

export const Route = createFileRoute('/_dashboard/training')({
  head: () => ({ meta: [{ title: 'Training · FormLab' }] }),
  component: TrainingPage,
})

function TrainingPage() {
  const { activities, filteredActivities } = useDashboard()

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Training"
        description="Fitness, fatigue and form over time, and where the hours actually went."
        count={filteredActivities.length}
      />
      <FitnessChart activities={activities} />
      <PowerZonesChart activities={filteredActivities} />
      <WeeklyProgress activities={activities} />
    </div>
  )
}
