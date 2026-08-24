import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { startOfWeek, addWeeks } from 'date-fns'
import { type StravaActivity } from '~/lib/strava'
import { estimateCaloriesBurned } from '~/lib/performance'
import { chartTheme, tooltipStyle, formatDateShort } from '~/lib/chart-theme'
import { statCard, statCardAccent, statValue, statValueAccent, sectionCard, cardTitle } from '~/lib/styles'
import { formatNumber } from '~/lib/format'

interface ActivityInsightsProps {
  activities: StravaActivity[]
  weight: number
  age: number
  gender: 'male' | 'female'
  timeRangeDays: number
}

interface WeeklyCalorieData {
  week: string
  calories: number
  /** The week still being ridden — partial by definition, so it is drawn as
   *  unfinished rather than as a collapse at the right edge of the chart. */
  isCurrentWeek: boolean
  daysElapsed: number
}

export function ActivityInsights({
  activities,
  weight,
  age,
  gender,
  timeRangeDays,
}: ActivityInsightsProps) {
  // --- Weekly Calorie Burn Data ---
  const { weeklyCalories, totalCalories, weeklyAvgCalories } = useMemo(() => {
    const now = new Date()
    const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 })
    const weeks = Math.min(12, Math.ceil(timeRangeDays / 7))
    const data: WeeklyCalorieData[] = []
    const isMale = gender === 'male'

    for (let w = 0; w < weeks; w++) {
      const ws = addWeeks(currentWeekStart, -w)
      const we = addWeeks(ws, 1)

      const weekActivities = activities.filter((a) => {
        const d = new Date(a.start_date)
        return d >= ws && d < we
      })

      const calories = weekActivities.reduce((sum, a) => {
        if (a.kilojoules) {
          // kJ reported by Strava ≈ calories for cycling (efficiency ~25%)
          return sum + Math.round(a.kilojoules * 0.25)
        }
        if (a.average_heartrate) {
          return sum + estimateCaloriesBurned(a.average_heartrate, a.moving_time, weight, age, isMale)
        }
        // Rough fallback: ~5 cal/min for moderate exercise
        return sum + Math.round((a.moving_time / 60) * 5)
      }, 0)

      data.push({
        week: formatDateShort(ws),
        calories,
        isCurrentWeek: w === 0,
        daysElapsed: w === 0 ? Math.floor((now.getTime() - ws.getTime()) / 86_400_000) + 1 : 7,
      })
    }

    data.reverse()
    const total = data.reduce((s, d) => s + d.calories, 0)
    // Completed weeks only — a two-day-old week drags the average down.
    const weeksWithActivity = data.filter((d) => d.calories > 0 && !d.isCurrentWeek).length
    const avg = weeksWithActivity > 0 ? Math.round(total / weeksWithActivity) : 0

    return { weeklyCalories: data, totalCalories: total, weeklyAvgCalories: avg }
  }, [activities, weight, age, gender, timeRangeDays])

  const hasCalorieData = weeklyCalories.some((d) => d.calories > 0)

  if (!hasCalorieData) {
    return (
      <div className={sectionCard}>
        <h3 className={`${cardTitle} mb-5`}>Activity insights</h3>
        <div className="text-text-muted text-center py-16 text-[0.9rem]">
          No activity data available for this time range.
        </div>
      </div>
    )
  }

  return (
    <div className={sectionCard}>
      <h3 className={`${cardTitle} mb-5`}>Weekly calorie burn</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 mb-6">
        <div className={`${statCardAccent} text-center gap-1`}>
          <div className={statValueAccent}>
            {formatNumber(totalCalories)}
          </div>
          <div className="text-sm text-text-secondary font-medium">Period total</div>
        </div>
        <div className={`${statCard} text-center gap-1`}>
          <div className={statValue}>{formatNumber(weeklyAvgCalories)}</div>
          <div className="text-sm text-text-secondary font-medium">Weekly average</div>
          <div className="text-[0.75rem] text-text-muted">completed weeks only</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={weeklyCalories}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
          <XAxis dataKey="week" stroke={chartTheme.axis} fontSize={12} />
          <YAxis
            stroke={chartTheme.axis}
            fontSize={12}
            label={{ value: 'cal', angle: -90, position: 'insideLeft', fill: chartTheme.axis }}
          />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            labelFormatter={(label: string) => {
              const week = weeklyCalories.find((w) => w.week === label)
              return week?.isCurrentWeek
                ? `Week of ${label} — in progress, day ${week.daysElapsed} of 7`
                : `Week of ${label}`
            }}
            formatter={(value: number) => [`${formatNumber(value)} cal`, 'Calories']}
          />
          <Bar dataKey="calories" radius={[1, 1, 0, 0]} name="Calories">
            {weeklyCalories.map((week) => (
              <Cell
                key={week.week}
                fill={chartTheme.colors.primary.main}
                fillOpacity={week.isCurrentWeek ? 0.35 : 1}
                stroke={week.isCurrentWeek ? chartTheme.colors.primary.main : undefined}
                strokeDasharray={week.isCurrentWeek ? '3 3' : undefined}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[0.75rem] text-text-muted mt-2">
        The dashed bar is this week, still in progress.
      </p>
    </div>
  )
}
