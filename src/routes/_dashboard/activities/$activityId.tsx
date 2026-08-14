import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useMemo } from 'react'
import { useDashboard } from '~/lib/dashboard-context'
import { isIntervalsActivityId } from '~/lib/intervals'
import {
  type ActivityDetailsJson,
  metersToKm,
  secondsToHMS,
  calculatePace,
  formatPace,
} from '~/lib/strava'
import {
  fetchCachedActivityDetails,
  clearCachedActivityDetails,
  isSupabaseConfigured,
} from '~/lib/storage/supabase-client'
import { formatDateFull, chartTheme, tooltipStyle } from '~/lib/chart-theme'
import { activityTypeClasses } from '~/lib/activities'
import { ActivityMap } from '~/components/ActivityMap'
import {
  ComposedChart,
  AreaChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

export const Route = createFileRoute('/_dashboard/activities/$activityId')({
  component: ActivityDetailPage,
})

const workoutTypeLabels: Record<string, Record<number, string>> = {
  Run: { 1: 'Race', 2: 'Long Run', 3: 'Workout' },
  Ride: { 11: 'Race', 12: 'Workout' },
  VirtualRide: { 11: 'Race', 12: 'Workout' },
}

function workoutTypeLabel(activityType: string, workoutType: number): string {
  return workoutTypeLabels[activityType]?.[workoutType] || 'Workout'
}

function ActivityDetailPage() {
  const { activityId } = Route.useParams()
  const { activities, sync } = useDashboard()
  const [details, setDetails] = useState<ActivityDetailsJson | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Find summary data from context
  const summary = activities.find((a) => a.id === Number(activityId))

  // Details are only fetchable for intervals.icu activities; legacy Strava-era
  // activities rely entirely on the cached details from before the cutover.
  //
  // This used to be its own copy of the fetch-cache-patch pipeline, which wrote
  // an estimated-watts patch to the database but left the in-memory set — and
  // therefore every derived number in the session — reading the old value until
  // a reload. The engine owns the whole pipeline now.
  async function fetchFromIntervals(id: number) {
    const detailsJson = await sync.ensureDetails(id)
    if (detailsJson) setDetails(detailsJson)
    return detailsJson
  }

  useEffect(() => {
    async function loadDetails() {
      const id = Number(activityId)

      // Try Supabase cache first
      if (isSupabaseConfigured()) {
        const cached = await fetchCachedActivityDetails(id)
        if (cached) {
          setDetails(cached.details)
          setLoading(false)
          return
        }
      }

      // Fetch from intervals.icu
      try {
        await fetchFromIntervals(id)
      } catch (err) {
        console.error('Failed to load activity details:', err)
      } finally {
        setLoading(false)
      }
    }

    loadDetails()
  }, [activityId])

  const canRefresh = isIntervalsActivityId(Number(activityId))

  async function handleRefresh() {
    const id = Number(activityId)
    // Never clear cached details for legacy Strava activities — they can't be
    // re-fetched from anywhere.
    if (!isIntervalsActivityId(id)) return
    setRefreshing(true)
    try {
      if (isSupabaseConfigured()) {
        await clearCachedActivityDetails(id)
      }
      await fetchFromIntervals(id)
    } catch (err) {
      console.error('Failed to refresh activity details:', err)
    } finally {
      setRefreshing(false)
    }
  }

  if (!summary) {
    return (
      <div className="text-center py-16 text-text-muted">
        <p>Activity not found.</p>
        <Link to="/activities" className="text-accent hover:underline mt-4 inline-block">
          Back to activities
        </Link>
      </div>
    )
  }

  const isRun = summary.type === 'Run'
  const paceOrSpeed = isRun
    ? formatPace(calculatePace(summary.distance, summary.moving_time))
    : `${(summary.average_speed * 3.6).toFixed(1)} km/h`

  // Chart data: splits → pace/speed + elevation + HR + power
  const splitsChartData = useMemo(() => {
    if (!details?.splits_metric?.length) return []
    const powerKm = details.power_per_km
    return details.splits_metric.map((s, i) => {
      const paceRaw = s.distance > 0 ? (s.moving_time / s.distance) * 1000 : 0
      return {
        km: s.split,
        pace: Math.round(paceRaw * 10) / 10, // sec/km
        speed: Math.round(s.average_speed * 3.6 * 10) / 10, // km/h
        elevation: s.elevation_difference,
        hr: s.average_heartrate ? Math.round(s.average_heartrate) : null,
        power: powerKm?.[i] ?? null,
      }
    })
  }, [details?.splits_metric, details?.power_per_km])

  const hasHrSplits = splitsChartData.some((d) => d.hr !== null)
  const hasPowerSplits = splitsChartData.some((d) => d.power !== null)

  return (
    <div className="flex flex-col gap-6">
      {/* Back link */}
      <Link
        to="/activities"
        className="inline-flex items-center gap-2 text-text-muted hover:text-accent transition-colors text-sm w-fit"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to activities
      </Link>

      {/* Header card */}
      <div className="bg-bg-secondary rounded-[var(--radius-lg)] border border-border-subtle p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-1">{summary.name}</h1>
            <p className="text-text-muted text-sm">
              {formatDateFull(summary.start_date_local)}
              {details?.device_name && ` \u00B7 ${details.device_name}`}
              {details?.gear_name && ` \u00B7 ${details.gear_name}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canRefresh && (
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-1.5 py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.7rem] font-semibold text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors disabled:opacity-50"
              title="Re-fetch from intervals.icu"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? 'animate-spin' : ''}>
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 16h5v5" />
              </svg>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            )}
            {details?.workout_type != null && details.workout_type > 0 && (
              <span className="inline-block py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.7rem] font-semibold uppercase tracking-wide bg-warning-muted text-warning">
                {workoutTypeLabel(summary.type, details.workout_type)}
              </span>
            )}
            <span className={`inline-block py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.7rem] font-semibold uppercase tracking-wide ${activityTypeClasses[summary.type.toLowerCase()] || 'bg-bg-tertiary text-text-secondary'}`}>
              {summary.type === 'VirtualRide' ? 'Zwift' : summary.type}
            </span>
          </div>
        </div>
        {details?.description && (
          <p className="text-text-secondary text-sm mt-3 whitespace-pre-line">{details.description}</p>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Distance" value={`${metersToKm(summary.distance).toFixed(2)} km`} />
        <StatCard label="Moving Time" value={secondsToHMS(summary.moving_time)} />
        {summary.elapsed_time > summary.moving_time + 30 && (
          <StatCard label="Elapsed Time" value={secondsToHMS(summary.elapsed_time)} />
        )}
        <StatCard label={isRun ? 'Pace' : 'Speed'} value={paceOrSpeed} />
        <StatCard label="Max Speed" value={isRun
          ? formatPace((1 / summary.max_speed) * 1000)
          : `${(summary.max_speed * 3.6).toFixed(1)} km/h`}
        />
        <StatCard label="Elevation" value={`${summary.total_elevation_gain.toFixed(0)} m`} />
        {summary.average_heartrate && (
          <StatCard label="Avg HR" value={`${Math.round(summary.average_heartrate)} bpm`} />
        )}
        {summary.max_heartrate && (
          <StatCard label="Max HR" value={`${Math.round(summary.max_heartrate)} bpm`} />
        )}
        {summary.average_watts && (
          <StatCard
            label={details?.power_estimated ? 'Est. Avg Power' : 'Avg Power'}
            value={`${Math.round(summary.average_watts)} W`}
          />
        )}
        {!summary.average_watts && details?.estimated_avg_watts && (
          <StatCard label="Est. Avg Power" value={`${Math.round(details.estimated_avg_watts)} W`} />
        )}
        {summary.max_watts && (
          <StatCard label="Max Power" value={`${Math.round(summary.max_watts)} W`} />
        )}
        {summary.weighted_average_watts && (
          <StatCard label="NP" value={`${Math.round(summary.weighted_average_watts)} W`} />
        )}
        {summary.average_cadence && (
          <StatCard label={isRun ? 'Cadence' : 'Cadence'} value={`${Math.round(isRun ? summary.average_cadence * 2 : summary.average_cadence)} ${isRun ? 'spm' : 'rpm'}`} />
        )}
        {details?.calories != null && details.calories > 0 && (
          <StatCard label="Calories" value={`${Math.round(details.calories)}`} />
        )}
        {summary.kilojoules != null && summary.kilojoules > 0 && (
          <StatCard label="Energy" value={`${Math.round(summary.kilojoules)} kJ`} />
        )}
        {details?.average_temp != null && (
          <StatCard label="Temperature" value={`${Math.round(details.average_temp)}\u00B0C`} />
        )}
        {details?.perceived_exertion != null && details.perceived_exertion > 0 && (
          <StatCard label="RPE" value={`${details.perceived_exertion} / 10`} />
        )}
        {summary.suffer_score != null && summary.suffer_score > 0 && (
          <StatCard label="Suffer Score" value={`${Math.round(summary.suffer_score)}`} />
        )}
      </div>

      {/* Social & achievements bar */}
      {details && (details.kudos_count || details.comment_count || details.achievement_count) ? (
        <div className="flex items-center gap-5 text-sm text-text-muted flex-wrap">
          {!!details.kudos_count && (
            <span className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg>
              {details.kudos_count} kudos
            </span>
          )}
          {!!details.comment_count && (
            <span className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              {details.comment_count} comments
            </span>
          )}
          {!!details.achievement_count && (
            <span className="flex items-center gap-1.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>
              {details.achievement_count} achievements
            </span>
          )}
        </div>
      ) : null}

      {/* Activity photo */}
      {details?.photo_url && (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border-subtle">
          <img
            src={details.photo_url}
            alt={summary.name}
            className="w-full max-h-[400px] object-cover"
          />
        </div>
      )}

      {/* Route map */}
      {details?.summary_polyline && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-3">Route</h2>
          <ActivityMap polyline={details.summary_polyline} />
        </div>
      )}

      {/* Loading state for details */}
      {loading && (
        <div className="flex items-center justify-center py-8 gap-3 text-text-muted">
          <div className="size-5 border-2 border-border-subtle border-t-accent rounded-full animate-spin" />
          Loading details...
        </div>
      )}

      {/* Splits charts */}
      {splitsChartData.length > 1 && (
        <div className="flex flex-col gap-6">
          {/* Pace/Speed + Elevation chart */}
          <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4">
            <h3 className="text-lg font-semibold mb-5 text-text-primary">
              {isRun ? 'Pace' : 'Speed'} &amp; Elevation per km
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={splitsChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis
                  dataKey="km"
                  stroke={chartTheme.axis}
                  fontSize={12}
                  tickFormatter={(v) => `${v}`}
                  label={{ value: 'km', position: 'insideBottomRight', offset: -5, fill: chartTheme.axis, fontSize: 11 }}
                />
                <YAxis
                  yAxisId="left"
                  stroke={chartTheme.axis}
                  fontSize={12}
                  reversed={isRun}
                  tickFormatter={(v: number) =>
                    isRun ? `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}` : `${v}`
                  }
                  label={{
                    value: isRun ? 'min/km' : 'km/h',
                    angle: -90,
                    position: 'insideLeft',
                    fill: chartTheme.axis,
                    fontSize: 11,
                  }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke={chartTheme.axis}
                  fontSize={12}
                  label={{ value: 'm', angle: 90, position: 'insideRight', fill: chartTheme.axis, fontSize: 11 }}
                />
                <Tooltip
                  {...tooltipStyle}
                  labelFormatter={(km) => `Km ${km}`}
                  formatter={(value: number, name: string) => {
                    if (name === 'Elevation') return [`${value > 0 ? '+' : ''}${value.toFixed(0)} m`, name]
                    if (name === 'Pace') {
                      const min = Math.floor(value / 60)
                      const sec = Math.round(value % 60)
                      return [`${min}:${String(sec).padStart(2, '0')} /km`, name]
                    }
                    if (name === 'Speed') return [`${value.toFixed(1)} km/h`, name]
                    return [value, name]
                  }}
                />
                <Bar
                  yAxisId="right"
                  dataKey="elevation"
                  fill={chartTheme.colors.amber.main}
                  fillOpacity={0.5}
                  name="Elevation"
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey={isRun ? 'pace' : 'speed'}
                  stroke={chartTheme.colors.primary.main}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: chartTheme.colors.primary.main, strokeWidth: 0 }}
                  activeDot={{ r: 6, fill: chartTheme.colors.primary.light, strokeWidth: 0 }}
                  name={isRun ? 'Pace' : 'Speed'}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Heart Rate per km chart */}
          {hasHrSplits && (
            <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4">
              <h3 className="text-lg font-semibold mb-5 text-text-primary">Heart Rate per km</h3>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={splitsChartData}>
                  <defs>
                    <linearGradient id="hrSplitGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartTheme.colors.coral.main} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={chartTheme.colors.coral.main} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                  <XAxis
                    dataKey="km"
                    stroke={chartTheme.axis}
                    fontSize={12}
                    label={{ value: 'km', position: 'insideBottomRight', offset: -5, fill: chartTheme.axis, fontSize: 11 }}
                  />
                  <YAxis
                    stroke={chartTheme.axis}
                    fontSize={12}
                    domain={['dataMin - 5', 'dataMax + 5']}
                    label={{ value: 'bpm', angle: -90, position: 'insideLeft', fill: chartTheme.axis, fontSize: 11 }}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    labelFormatter={(km) => `Km ${km}`}
                    formatter={(value: number) => [`${value} bpm`, 'Heart Rate']}
                  />
                  <Area
                    type="monotone"
                    dataKey="hr"
                    stroke={chartTheme.colors.coral.main}
                    fill="url(#hrSplitGrad)"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: chartTheme.colors.coral.main, strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: chartTheme.colors.coral.light, strokeWidth: 0 }}
                    connectNulls
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Power per km chart */}
      {hasPowerSplits && splitsChartData.length > 1 && (
        <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4">
          <h3 className="text-lg font-semibold mb-5 text-text-primary">Power per km</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={splitsChartData}>
              <defs>
                <linearGradient id="powerKmGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={chartTheme.colors.secondary.main} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={chartTheme.colors.secondary.main} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis
                dataKey="km"
                stroke={chartTheme.axis}
                fontSize={12}
                label={{ value: 'km', position: 'insideBottomRight', offset: -5, fill: chartTheme.axis, fontSize: 11 }}
              />
              <YAxis
                stroke={chartTheme.axis}
                fontSize={12}
                domain={['dataMin - 10', 'dataMax + 10']}
                label={{ value: 'W', angle: -90, position: 'insideLeft', fill: chartTheme.axis, fontSize: 11 }}
              />
              <Tooltip
                {...tooltipStyle}
                labelFormatter={(km) => `Km ${km}`}
                formatter={(value: number) => [`${value} W`, 'Power']}
              />
              <Area
                type="monotone"
                dataKey="power"
                stroke={chartTheme.colors.secondary.main}
                fill="url(#powerKmGrad)"
                strokeWidth={2.5}
                dot={{ r: 4, fill: chartTheme.colors.secondary.main, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: chartTheme.colors.secondary.light, strokeWidth: 0 }}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Best efforts (runs) */}
      {details?.best_efforts && details.best_efforts.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-3">Best Efforts</h2>
          <div className="overflow-x-auto bg-bg-secondary rounded-[var(--radius-lg)] border border-border-subtle">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Distance</Th>
                  <Th>Time</Th>
                  <Th>Pace</Th>
                  <Th>Achievement</Th>
                </tr>
              </thead>
              <tbody>
                {details.best_efforts.map((effort) => (
                  <tr key={effort.id} className="transition-colors hover:[&_td]:bg-bg-tertiary last:[&_td]:border-b-0">
                    <Td className="font-semibold text-text-primary">{effort.name}</Td>
                    <Td>{secondsToHMS(effort.elapsed_time)}</Td>
                    <Td>{formatPace(calculatePace(effort.distance, effort.elapsed_time))}</Td>
                    <Td>
                      <AchievementBadges achievements={effort.achievements} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Splits table */}
      {details?.splits_metric && details.splits_metric.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-3">Splits</h2>
          <div className="overflow-x-auto bg-bg-secondary rounded-[var(--radius-lg)] border border-border-subtle">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Km</Th>
                  <Th>Pace</Th>
                  <Th>Time</Th>
                  <Th>Elev</Th>
                  {details.splits_metric.some((s) => s.average_heartrate) && <Th>HR</Th>}
                </tr>
              </thead>
              <tbody>
                {details.splits_metric.map((split) => (
                  <tr key={split.split} className="transition-colors hover:[&_td]:bg-bg-tertiary last:[&_td]:border-b-0">
                    <Td>{split.split}</Td>
                    <Td>{formatPace(calculatePace(split.distance, split.moving_time))}</Td>
                    <Td>{secondsToHMS(split.moving_time)}</Td>
                    <Td>
                      <span className={split.elevation_difference > 0 ? 'text-success' : split.elevation_difference < 0 ? 'text-danger' : ''}>
                        {split.elevation_difference > 0 ? '+' : ''}{split.elevation_difference.toFixed(0)} m
                      </span>
                    </Td>
                    {details.splits_metric.some((s) => s.average_heartrate) && (
                      <Td>{split.average_heartrate ? `${Math.round(split.average_heartrate)} bpm` : '-'}</Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Laps table */}
      {details?.laps && details.laps.length > 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-3">Laps</h2>
          <div className="overflow-x-auto bg-bg-secondary rounded-[var(--radius-lg)] border border-border-subtle">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Lap</Th>
                  <Th>Distance</Th>
                  <Th>Time</Th>
                  <Th>{isRun ? 'Pace' : 'Speed'}</Th>
                  {details.laps.some((l) => l.average_heartrate) && <Th>HR</Th>}
                  {details.laps.some((l) => l.average_watts) && <Th>Power</Th>}
                </tr>
              </thead>
              <tbody>
                {details.laps.map((lap, i) => (
                  <tr key={lap.id} className="transition-colors hover:[&_td]:bg-bg-tertiary last:[&_td]:border-b-0">
                    <Td>{i + 1}</Td>
                    <Td>{metersToKm(lap.distance).toFixed(2)} km</Td>
                    <Td>{secondsToHMS(lap.moving_time)}</Td>
                    <Td>
                      {isRun
                        ? formatPace(calculatePace(lap.distance, lap.moving_time))
                        : `${(lap.average_speed * 3.6).toFixed(1)} km/h`}
                    </Td>
                    {details.laps.some((l) => l.average_heartrate) && (
                      <Td>{lap.average_heartrate ? `${Math.round(lap.average_heartrate)} bpm` : '-'}</Td>
                    )}
                    {details.laps.some((l) => l.average_watts) && (
                      <Td>{lap.average_watts ? `${Math.round(lap.average_watts)} W` : '-'}</Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Segment efforts */}
      {details?.segment_efforts && details.segment_efforts.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary mb-3">Segments</h2>
          <div className="overflow-x-auto bg-bg-secondary rounded-[var(--radius-lg)] border border-border-subtle">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <Th>Segment</Th>
                  <Th>Distance</Th>
                  <Th>Time</Th>
                  {details.segment_efforts.some((s) => s.average_heartrate) && <Th>HR</Th>}
                  {details.segment_efforts.some((s) => s.average_watts) && <Th>Power</Th>}
                  <Th>Achievement</Th>
                </tr>
              </thead>
              <tbody>
                {details.segment_efforts.map((seg) => (
                  <tr key={seg.id} className="transition-colors hover:[&_td]:bg-bg-tertiary last:[&_td]:border-b-0">
                    <Td className="font-semibold text-text-primary max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">{seg.name}</Td>
                    <Td>{metersToKm(seg.distance).toFixed(2)} km</Td>
                    <Td>{secondsToHMS(seg.elapsed_time)}</Td>
                    {details.segment_efforts.some((s) => s.average_heartrate) && (
                      <Td>{seg.average_heartrate ? `${Math.round(seg.average_heartrate)} bpm` : '-'}</Td>
                    )}
                    {details.segment_efforts.some((s) => s.average_watts) && (
                      <Td>{seg.average_watts ? `${Math.round(seg.average_watts)} W` : '-'}</Td>
                    )}
                    <Td>
                      <AchievementBadges achievements={seg.achievements} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-secondary rounded-[var(--radius-lg)] border border-border-subtle p-4">
      <p className="text-[0.7rem] text-text-muted uppercase tracking-wider font-semibold mb-1">{label}</p>
      <p className="text-lg font-bold text-text-primary">{value}</p>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left p-4 px-5 bg-bg-tertiary text-text-muted font-semibold uppercase text-[0.7rem] tracking-wider first:rounded-tl-[var(--radius-lg)] last:rounded-tr-[var(--radius-lg)] max-md:px-2 max-md:py-2.5">
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`p-4 px-5 border-b border-border-subtle max-md:px-2 max-md:py-2.5 ${className}`}>
      {children}
    </td>
  )
}

const achievementColors: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: 'bg-gold-muted', text: 'text-gold', label: 'KOM/QOM' },
  2: { bg: 'bg-silver-muted', text: 'text-silver', label: '2nd' },
  3: { bg: 'bg-bronze-muted', text: 'text-bronze', label: '3rd' },
}

function AchievementBadges({ achievements }: { achievements?: Array<{ type_id: number; type: string; rank: number }> }) {
  if (!achievements || achievements.length === 0) return <span className="text-text-muted">-</span>

  return (
    <div className="flex gap-1.5">
      {achievements.map((a, i) => {
        const style = achievementColors[a.rank]
        if (!style) {
          return (
            <span key={i} className="py-1 px-2 rounded-[var(--radius-sm)] text-[0.65rem] font-semibold bg-bg-tertiary text-text-secondary">
              PR
            </span>
          )
        }
        return (
          <span key={i} className={`py-1 px-2 rounded-[var(--radius-sm)] text-[0.65rem] font-semibold ${style.bg} ${style.text}`}>
            {style.label}
          </span>
        )
      })}
    </div>
  )
}
