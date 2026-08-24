import { createFileRoute, Link } from '@tanstack/react-router'
import { useDashboard } from '~/lib/dashboard-context'
import { useEffect, useMemo, useState } from 'react'
import { calculatePersonalRecords } from '~/lib/performance'
import { chartTheme, tooltipStyle } from '~/lib/chart-theme'
import {
  fetchAllCachedSegmentData,
  fetchCachedBestEfforts,
  fetchCachedPowerCurves,
  type SegmentEffortWithActivity,
  type BestEffortWithActivity,
  type PowerCurveWithActivity,
} from '~/lib/storage/supabase-client'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { Pagination } from '~/components/Pagination'
import { isRide } from '~/lib/tss'
import { isPlausibleEffort, isImperialEffort } from '~/lib/best-efforts'
import { normalizeSegmentName, splitActivityPrefix } from '~/lib/segment-names'
import { PageHeader } from '~/components/PageHeader'
import { sectionHeading } from '~/lib/styles'
import {
  formatNumber,
  formatDistance,
  formatClock,
  formatPacePerKm,
  formatDateFull,
} from '~/lib/format'

// Ten rows over 954 segments is 96 pages of tall cards. The search box and the
// sort chips carry the load now, so the page can afford denser rows.
const SEGMENTS_PAGE_SIZE = 25

export const Route = createFileRoute('/_dashboard/records')({
  head: () => ({ meta: [{ title: 'Records · FormLab' }] }),
  component: RecordsPage,
})

// Group segment efforts by segment ID and compute stats
interface SegmentSummary {
  segmentId: number
  name: string
  distance: number
  averageGrade: number
  maximumGrade: number
  elevationHigh: number
  elevationLow: number
  climbCategory: number
  effortCount: number
  bestTime: number
  bestDate: string
  bestActivityName: string
  averageTime: number
  bestWatts: number | null
  bestHR: number | null
  achievements: Array<{ type: string; rank: number }>
  efforts: Array<{
    date: string
    time: number
    watts: number | null
    hr: number | null
    activityName: string
  }>
}

function groupSegmentEfforts(efforts: SegmentEffortWithActivity[]): SegmentSummary[] {
  const grouped = new Map<number, SegmentEffortWithActivity[]>()

  for (const effort of efforts) {
    if (!effort.segment) continue
    const id = effort.segment.id
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id)!.push(effort)
  }

  const summaries: SegmentSummary[] = []

  for (const [segmentId, segEfforts] of grouped) {
    const segment = segEfforts[0].segment!
    const sorted = [...segEfforts].sort((a, b) => a.moving_time - b.moving_time)
    const best = sorted[0]
    const totalTime = segEfforts.reduce((sum, e) => sum + e.moving_time, 0)

    // Collect all achievements across efforts
    const allAchievements: Array<{ type: string; rank: number }> = []
    for (const e of segEfforts) {
      for (const a of e.achievements) {
        allAchievements.push(a)
      }
    }
    // Keep best achievement per type
    const bestAchievements = new Map<string, { type: string; rank: number }>()
    for (const a of allAchievements) {
      const existing = bestAchievements.get(a.type)
      if (!existing || a.rank < existing.rank) {
        bestAchievements.set(a.type, a)
      }
    }

    const wattsValues = segEfforts.filter((e) => e.average_watts).map((e) => e.average_watts!)
    const hrValues = segEfforts.filter((e) => e.average_heartrate).map((e) => e.average_heartrate!)

    summaries.push({
      segmentId,
      name: segment.name,
      distance: segment.distance,
      averageGrade: segment.average_grade,
      maximumGrade: segment.maximum_grade,
      elevationHigh: segment.elevation_high,
      elevationLow: segment.elevation_low,
      climbCategory: segment.climb_category,
      effortCount: segEfforts.length,
      bestTime: best.moving_time,
      bestDate: best.activityDate,
      bestActivityName: best.activityName,
      averageTime: Math.round(totalTime / segEfforts.length),
      bestWatts: wattsValues.length > 0 ? Math.max(...wattsValues) : null,
      bestHR: hrValues.length > 0 ? Math.max(...hrValues) : null,
      achievements: Array.from(bestAchievements.values()),
      efforts: segEfforts
        .sort((a, b) => new Date(a.activityDate).getTime() - new Date(b.activityDate).getTime())
        .map((e) => ({
          date: e.activityDate,
          time: e.moving_time,
          watts: e.average_watts || null,
          hr: e.average_heartrate || null,
          activityName: e.activityName,
        })),
    })
  }

  // Sort by most ridden
  summaries.sort((a, b) => b.effortCount - a.effortCount)
  return summaries
}

// Group best efforts by name and find the best time for each
interface BestEffortSummary {
  name: string
  distance: number
  bestTime: number
  bestDate: string
  bestActivityName: string
  bestActivityId: number
  effortCount: number
  efforts: Array<{
    date: string
    time: number
    activityName: string
    activityId: number
  }>
}

function groupBestEfforts(efforts: BestEffortWithActivity[]): BestEffortSummary[] {
  const grouped = new Map<string, BestEffortWithActivity[]>()

  for (const effort of efforts) {
    // A 5K in 5:48 is a bad row, not a world record — and taking the minimum
    // time in each bucket meant one bad row won the bucket outright. See
    // lib/best-efforts.
    if (!isPlausibleEffort(effort.distance, effort.moving_time)) continue
    if (!grouped.has(effort.name)) grouped.set(effort.name, [])
    grouped.get(effort.name)!.push(effort)
  }

  const summaries: BestEffortSummary[] = []

  for (const [name, effortGroup] of grouped) {
    if (effortGroup.length === 0) continue
    const sorted = [...effortGroup].sort((a, b) => a.moving_time - b.moving_time)
    const best = sorted[0]

    summaries.push({
      name,
      distance: best.distance,
      bestTime: best.moving_time,
      bestDate: best.activityDate,
      bestActivityName: best.activityName,
      bestActivityId: best.activityId,
      effortCount: effortGroup.length,
      efforts: effortGroup
        .sort((a, b) => new Date(a.activityDate).getTime() - new Date(b.activityDate).getTime())
        .map((e) => ({
          date: e.activityDate,
          time: e.moving_time,
          activityName: e.activityName,
          activityId: e.activityId,
        })),
    })
  }

  // Sort by distance (shortest first — 400m, 1/2 mile, 1K, etc.)
  summaries.sort((a, b) => a.distance - b.distance)
  return summaries
}

// Achievement badge component
function AchievementBadge({ type, rank }: { type: string; rank: number }) {
  const isKom = type === 'overall'
  const isPr = type === 'pr'
  const label = isKom
    ? rank === 1
      ? 'KOM'
      : `Top ${rank}`
    : isPr
      ? 'PR'
      : `#${rank}`

  const colorClass = isKom
    ? rank === 1
      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
      : rank <= 3
        ? 'bg-sky-500/20 text-sky-400 border-sky-500/30'
        : 'bg-violet-500/20 text-violet-400 border-violet-500/30'
    : 'bg-teal-500/20 text-teal-400 border-teal-500/30'

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[0.75rem] font-bold uppercase tracking-wider rounded-[var(--radius-sm)] border ${colorClass}`}>
      {isKom && rank === 1 && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
        </svg>
      )}
      {label}
    </span>
  )
}

// Climb category label
function climbCategoryLabel(cat: number): string {
  if (cat === 0) return 'NC'
  if (cat === 5) return 'HC'
  return `Cat ${cat}`
}

function RecordsPage() {
  const { activities, athlete } = useDashboard()
  const [segmentEfforts, setSegmentEfforts] = useState<SegmentEffortWithActivity[]>([])
  const [bestEfforts, setBestEfforts] = useState<BestEffortWithActivity[]>([])
  const [powerCurves, setPowerCurves] = useState<PowerCurveWithActivity[]>([])
  const [isLoadingSegments, setIsLoadingSegments] = useState(true)
  const [isLoadingEfforts, setIsLoadingEfforts] = useState(true)
  const [expandedSegment, setExpandedSegment] = useState<number | null>(null)
  const [expandedEffort, setExpandedEffort] = useState<string | null>(null)
  const [segmentSort, setSegmentSort] = useState<'count' | 'time' | 'grade'>('count')
  const [segmentFilter, setSegmentFilter] = useState<'all' | 'irl' | 'zwift'>('all')
  const [segmentSearch, setSegmentSearch] = useState('')
  const [segmentPage, setSegmentPage] = useState(1)
  const [showImperialEfforts, setShowImperialEfforts] = useState(false)

  // Personal records from all activities (not filtered by time range)
  const personalRecords = useMemo(() => calculatePersonalRecords(activities), [activities])

  // Power duration records: top 3 for each duration bucket
  const powerDurations = [
    { label: '2 min', seconds: 120 },
    { label: '5 min', seconds: 300 },
    { label: '8 min', seconds: 480 },
    { label: '20 min', seconds: 1200 },
    { label: '30 min', seconds: 1800 },
    { label: '45 min', seconds: 2700 },
  ]

  const powerRecords = useMemo(() => {
    const rides = activities.filter(
      (a) => isRide(a) && a.average_watts
    )

    return powerDurations.map(({ label, seconds }) => {
      // Preferred: true rolling-window peaks computed from cached power streams.
      const curveTop3 = powerCurves
        .filter((c) => c.curve[seconds] != null)
        .map((c) => ({
          id: c.activityId,
          name: c.activityName,
          start_date_local: c.activityDate,
          moving_time: c.movingTime,
          distance: c.distance,
          watts: c.curve[seconds],
        }))
        .sort((a, b) => b.watts - a.watts)
        .slice(0, 3)

      if (curveTop3.length > 0) {
        return { label, seconds, top3: curveTop3, estimated: false }
      }

      // Fallback (no curves cached yet): approximate with whole-ride average power.
      // Prefer rides whose duration is close to the window, else any ride >= duration.
      const inWindow = rides
        .filter((a) => a.moving_time >= seconds && a.moving_time <= seconds * 2.5)
        .sort((a, b) => (b.average_watts || 0) - (a.average_watts || 0))
      const allEligible = rides
        .filter((a) => a.moving_time >= seconds)
        .sort((a, b) => (b.average_watts || 0) - (a.average_watts || 0))
      const pool = inWindow.length >= 3 ? inWindow : allEligible
      const top3 = pool.slice(0, 3).map((a) => ({
        id: a.id,
        name: a.name,
        start_date_local: a.start_date_local,
        moving_time: a.moving_time,
        distance: a.distance,
        watts: a.average_watts || 0,
      }))

      return { label, seconds, top3, estimated: top3.length > 0 }
    })
  }, [activities, powerCurves])

  // Fetch segment data
  useEffect(() => {
    if (!athlete) return
    setIsLoadingSegments(true)
    fetchAllCachedSegmentData(athlete.id).then((data) => {
      setSegmentEfforts(data)
      setIsLoadingSegments(false)
    })
  }, [athlete])

  // Fetch best efforts
  useEffect(() => {
    if (!athlete) return
    setIsLoadingEfforts(true)
    fetchCachedBestEfforts(athlete.id).then((data) => {
      setBestEfforts(data)
      setIsLoadingEfforts(false)
    })
  }, [athlete])

  // Fetch power-duration curves (true N-min peaks from cached streams)
  useEffect(() => {
    if (!athlete) return
    fetchCachedPowerCurves(athlete.id).then(setPowerCurves)
  }, [athlete])

  // Filter and group segments
  const segmentSummaries = useMemo(() => {
    const filtered = segmentFilter === 'all'
      ? segmentEfforts
      : segmentFilter === 'zwift'
        ? segmentEfforts.filter((e) => e.activityType === 'VirtualRide')
        : segmentEfforts.filter((e) => e.activityType === 'Ride')
    const summaries = groupSegmentEfforts(filtered)
    const query = segmentSearch.toLowerCase().trim()
    const sorted = query
      ? summaries.filter((s) => s.name.toLowerCase().includes(query))
      : [...summaries]
    if (segmentSort === 'count') sorted.sort((a, b) => b.effortCount - a.effortCount)
    else if (segmentSort === 'time') sorted.sort((a, b) => a.bestTime - b.bestTime)
    else if (segmentSort === 'grade') sorted.sort((a, b) => b.averageGrade - a.averageGrade)
    return sorted
  }, [segmentEfforts, segmentSort, segmentFilter, segmentSearch])

  // Reset to first page when filter/sort/search changes.
  useEffect(() => {
    setSegmentPage(1)
  }, [segmentSort, segmentFilter, segmentSearch])

  const pagedSegments = useMemo(
    () =>
      segmentSummaries.slice(
        (segmentPage - 1) * SEGMENTS_PAGE_SIZE,
        segmentPage * SEGMENTS_PAGE_SIZE
      ),
    [segmentSummaries, segmentPage]
  )

  // Group best efforts
  const allBestEffortSummaries = useMemo(() => groupBestEfforts(bestEfforts), [bestEfforts])
  const hasImperialEfforts = allBestEffortSummaries.some((e) => isImperialEffort(e.name))
  const bestEffortSummaries = useMemo(
    () =>
      showImperialEfforts
        ? allBestEffortSummaries
        : allBestEffortSummaries.filter((e) => !isImperialEffort(e.name)),
    [allBestEffortSummaries, showImperialEfforts]
  )

  return (
    <div>
      <div className="mb-8">
        <PageHeader
          title="Records"
          description="Your bests: single-ride records, peak power, running efforts and the segments you ride most."
          scope="lifetime"
          count={activities.length}
        />
      </div>

      {/* Personal Records Section */}
      <section className="mb-12">
        <h2 className={`${sectionHeading} mb-6`}>Personal records</h2>

        {personalRecords.length === 0 ? (
          <p className="text-text-muted text-sm">No records yet. Keep riding!</p>
        ) : (
          <div className="grid grid-cols-4 gap-5 max-lg:grid-cols-3 max-md:grid-cols-2 max-md:gap-3 max-[480px]:gap-2">
            {personalRecords.map((record, index) => (
              <Link
                key={index}
                to="/activities/$activityId"
                params={{ activityId: String(record.activity.id) }}
                className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-6 text-center transition-all duration-200 min-w-0 overflow-hidden hover:border-accent/50 hover:-translate-y-0.5 hover:shadow-md max-[480px]:p-3.5 no-underline block"
              >
                <div className="text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold mb-3 max-[480px]:mb-2">
                  {record.type}
                </div>
                <div className="text-4xl font-bold bg-linear-to-br from-accent-light to-accent bg-clip-text text-transparent leading-tight break-words max-md:text-[1.75rem] max-[480px]:text-[1.375rem]">
                  {record.type === 'Best Pace (5km+)' ? record.unit : record.value}
                  {record.type !== 'Best Pace (5km+)' && (
                    <span className="text-base font-medium text-text-secondary ml-1 max-[480px]:text-xs">
                      {record.unit}
                    </span>
                  )}
                </div>
                <div
                  className="text-sm text-text-primary mt-3 overflow-hidden text-ellipsis whitespace-nowrap font-medium min-w-0"
                  title={record.activity.name}
                >
                  {record.activity.name}
                </div>
                <div className="text-[0.75rem] text-text-muted mt-1">
                  {formatDateFull(record.date)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Power Records Section */}
      {powerRecords.some((p) => p.top3.length > 0) && (
        <section className="mb-12">
          <h2 className={`${sectionHeading} mb-6`}>Power records</h2>

          <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
            {powerRecords.map(({ label, top3, estimated }) => {
              if (top3.length === 0) return null
              return (
                <div key={label} className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-5 max-[480px]:p-4">
                  <div className="text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold mb-4 flex items-center gap-2">
                    Best {label} power
                    {estimated && (
                      <span
                        className="text-[0.75rem] normal-case tracking-normal font-medium text-text-muted bg-bg-tertiary rounded-[var(--radius-sm)] px-2 py-0.5"
                        title="Estimated from whole-ride average power. Sync All Activities to compute true peaks from power streams."
                      >
                        est.
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-3">
                    {top3.map((activity, i) => (
                      <Link
                        key={activity.id}
                        to="/activities/$activityId"
                        params={{ activityId: String(activity.id) }}
                        className="flex items-center gap-3 no-underline group"
                      >
                        <div className={`w-6 h-6 rounded-[var(--radius-sm)] flex items-center justify-center text-xs font-bold shrink-0 ${
                          i === 0
                            ? 'bg-amber-500/20 text-amber-400'
                            : i === 1
                              ? 'bg-zinc-400/20 text-zinc-400'
                              : 'bg-amber-700/20 text-amber-600'
                        }`}>
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          {/* The shared "Zwift - " prefix used to survive
                              truncation while the part that identifies the ride
                              was cut. It moves to a badge instead. */}
                          {(() => {
                            const { prefix, rest } = splitActivityPrefix(activity.name)
                            return (
                              <div className="flex items-center gap-1.5 min-w-0">
                                {prefix && (
                                  <span className="text-[0.75rem] font-semibold text-ride bg-ride-muted rounded-[var(--radius-sm)] px-1.5 py-0.5 shrink-0">
                                    {prefix}
                                  </span>
                                )}
                                <span
                                  className="text-sm text-text-secondary group-hover:text-text-primary transition-colors truncate"
                                  title={activity.name}
                                >
                                  {rest}
                                </span>
                              </div>
                            )
                          })()}
                          <div className="text-[0.75rem] text-text-muted data-value">
                            {formatDateFull(activity.start_date_local)} · {formatClock(activity.moving_time)} · {formatDistance(activity.distance / 1000)} km
                          </div>
                        </div>
                        <div className={`data-value text-lg font-medium shrink-0 ${
                          i === 0 ? 'text-accent' : 'text-text-secondary'
                        }`}>
                          {formatNumber(activity.watts)}<span className="text-xs font-medium ml-0.5">W</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Best Efforts Section (Running) */}
      {isLoadingEfforts && bestEffortSummaries.length === 0 && (
        <section className="mb-12">
          <h2 className={`${sectionHeading} mb-6`}>Best efforts</h2>
          <div className="text-text-muted text-sm py-8 text-center">Loading running efforts…</div>
        </section>
      )}
      {bestEffortSummaries.length > 0 && (
        <section className="mb-12">
          <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
            <h2 className={sectionHeading}>Best efforts</h2>
            {/* Metric by default: 400 m, ½ mile, 1 mile, 2 mile and 5K
                interleaved is two unit systems in one row, for a rider whose
                every other figure is metric. */}
            {hasImperialEfforts && (
              <label className="flex items-center gap-2 text-[0.75rem] text-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={showImperialEfforts}
                  onChange={(e) => setShowImperialEfforts(e.target.checked)}
                  className="size-3.5 accent-accent cursor-pointer"
                />
                Show mile distances
              </label>
            )}
          </div>

          <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-3 max-md:grid-cols-2 max-md:gap-3">
            {bestEffortSummaries.map((effort) => (
              <div key={effort.name} className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] overflow-hidden">
                <button
                  onClick={() => setExpandedEffort(expandedEffort === effort.name ? null : effort.name)}
                  className="w-full p-5 text-left cursor-pointer bg-transparent border-none transition-colors hover:bg-bg-tertiary max-[480px]:p-3.5"
                >
                  <div className="text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold mb-2">
                    {effort.name}
                  </div>
                  <div className="data-value text-2xl font-medium text-text-primary max-[480px]:text-xl">
                    {formatClock(effort.bestTime)}
                  </div>
                  {/* The pace is what makes the row checkable: a bucket whose
                      pace does not match its neighbours is a bad row. */}
                  <div className="text-[0.75rem] text-text-secondary data-value mt-1">
                    {formatPacePerKm((effort.bestTime / effort.distance) * 1000)}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-[0.75rem] text-text-muted">{formatDateFull(effort.bestDate)}</span>
                    <span className="text-[0.75rem] text-text-muted">{effort.effortCount}×</span>
                  </div>
                </button>

                {expandedEffort === effort.name && effort.efforts.length > 1 && (
                  <div className="border-t border-border-subtle p-4">
                    <div className="h-32">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={effort.efforts}>
                          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(d: string) => formatDateFull(d)}
                            tick={{ fill: chartTheme.axis, fontSize: 11 }}
                            stroke={chartTheme.grid}
                          />
                          <YAxis
                            tickFormatter={(v: number) => formatClock(v)}
                            tick={{ fill: chartTheme.axis, fontSize: 11 }}
                            stroke={chartTheme.grid}
                            domain={['dataMin - 10', 'dataMax + 10']}
                            reversed
                          />
                          <Tooltip
                            {...tooltipStyle}
                            formatter={(value: number) => [formatClock(value), 'Time']}
                            labelFormatter={(label: string) => formatDateFull(label)}
                          />
                          <Line
                            type="monotone"
                            dataKey="time"
                            stroke={chartTheme.colors.tertiary.main}
                            strokeWidth={2}
                            dot={{ fill: chartTheme.colors.tertiary.main, r: 3 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Segments Section */}
      <section>
        <div className="flex items-center justify-between mb-6 max-md:flex-col max-md:items-start max-md:gap-3">
          <h2 className={sectionHeading}>Popular segments</h2>
          <div className="flex items-center justify-end gap-4 flex-wrap max-md:w-full max-md:justify-start max-[480px]:flex-col max-[480px]:items-stretch max-[480px]:gap-2">
            <div className="relative w-[220px] max-[480px]:w-full">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={segmentSearch}
                onChange={(e) => setSegmentSearch(e.target.value)}
                placeholder="Search segments..."
                aria-label="Search segments"
                className="w-full bg-bg-tertiary border border-border text-text-primary py-1.5 pl-9 pr-8 rounded-[var(--radius-sm)] text-[0.8rem] transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
              />
              {segmentSearch && (
                <button
                  type="button"
                  onClick={() => setSegmentSearch('')}
                  aria-label="Clear segment search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary bg-transparent border-none cursor-pointer text-sm leading-none p-1"
                >
                  ×
                </button>
              )}
            </div>
            <div className="flex gap-1 bg-bg-secondary rounded-[var(--radius-sm)] border border-border-subtle p-0.5">
              {(['all', 'irl', 'zwift'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setSegmentFilter(filter)}
                  aria-pressed={segmentFilter === filter}
                  className={`px-3 py-1.5 text-[0.75rem] font-medium rounded-[var(--radius-sm)] transition-all cursor-pointer border-none ${
                    segmentFilter === filter
                      ? 'bg-accent/20 text-accent'
                      : 'bg-transparent text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {filter === 'all' ? 'All' : filter === 'irl' ? 'IRL' : 'Zwift'}
                </button>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap">
              {(['count', 'time', 'grade'] as const).map((sort) => (
                <button
                  key={sort}
                  type="button"
                  onClick={() => setSegmentSort(sort)}
                  aria-pressed={segmentSort === sort}
                  className={`px-3 py-1.5 text-[0.75rem] font-medium rounded-[var(--radius-sm)] border transition-all cursor-pointer whitespace-nowrap ${
                    segmentSort === sort
                      ? 'bg-accent/20 text-accent border-accent/30'
                      : 'bg-bg-secondary text-text-muted border-border-subtle hover:text-text-secondary hover:border-border'
                  }`}
                >
                  {sort === 'count' ? 'Most ridden' : sort === 'time' ? 'Best time' : 'Steepest'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isLoadingSegments ? (
          <div className="text-text-muted text-sm py-8 text-center">Loading segment data...</div>
        ) : segmentSummaries.length === 0 ? (
          <div className="text-text-muted text-sm py-8 text-center">
            {segmentSearch.trim()
              ? `No segments match "${segmentSearch.trim()}".`
              : 'No segment data yet. Ride more routes to build your segment history!'}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {pagedSegments.map((seg) => (
              <div
                key={seg.segmentId}
                className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-md)] overflow-hidden transition-all duration-200 hover:border-border"
              >
                <button
                  type="button"
                  aria-expanded={expandedSegment === seg.segmentId}
                  onClick={() => setExpandedSegment(expandedSegment === seg.segmentId ? null : seg.segmentId)}
                  className="w-full py-3 px-4 text-left cursor-pointer bg-transparent border-none transition-colors hover:bg-bg-tertiary"
                >
                  <div className="flex items-start justify-between gap-4 max-[480px]:flex-col max-[480px]:gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Strava hands these over in caps often as not, and a
                            list where half the rows shout is unreadable. */}
                        <h3 className="text-sm font-semibold text-text-primary truncate" title={seg.name}>
                          {normalizeSegmentName(seg.name)}
                        </h3>
                        {seg.achievements.map((a, i) => (
                          <AchievementBadge key={i} type={a.type} rank={a.rank} />
                        ))}
                        {seg.climbCategory > 0 && (
                          <span className="text-[0.75rem] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-[var(--radius-sm)]">
                            {climbCategoryLabel(seg.climbCategory)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1.5 text-[0.75rem] text-text-muted flex-wrap data-value">
                        <span>{formatDistance(seg.distance / 1000, 2)} km</span>
                        <span>{formatNumber(seg.averageGrade, 1)}% avg</span>
                        <span>{formatNumber(seg.elevationHigh - seg.elevationLow)} m elev</span>
                        <span>{formatNumber(seg.effortCount)} {seg.effortCount === 1 ? 'effort' : 'efforts'}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0 max-[480px]:flex max-[480px]:gap-4 max-[480px]:text-left">
                      <div className="data-value text-lg font-medium text-text-primary max-[480px]:text-base">
                        {formatClock(seg.bestTime)}
                      </div>
                      <div className="text-[0.75rem] text-text-muted mt-0.5">
                        {formatDateFull(seg.bestDate)}
                      </div>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex gap-6 mt-2 text-[0.75rem] flex-wrap">
                    <div>
                      <span className="text-text-muted">Avg time </span>
                      <span className="text-text-secondary font-medium data-value">{formatClock(seg.averageTime)}</span>
                    </div>
                    {seg.bestWatts && (
                      <div>
                        <span className="text-text-muted">Best power </span>
                        <span className="text-text-secondary font-medium data-value">{formatNumber(seg.bestWatts)} W</span>
                      </div>
                    )}
                    {seg.bestHR && (
                      <div>
                        <span className="text-text-muted">Max HR </span>
                        <span className="text-text-secondary font-medium data-value">{formatNumber(seg.bestHR)} bpm</span>
                      </div>
                    )}
                  </div>
                </button>

                {/* Expanded: time progression chart */}
                {expandedSegment === seg.segmentId && seg.efforts.length > 1 && (
                  <div className="border-t border-border-subtle p-5 max-[480px]:p-3">
                    <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                      Time Progression
                    </h4>
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={seg.efforts}>
                          <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(d: string) => formatDateFull(d)}
                            tick={{ fill: chartTheme.axis, fontSize: 11 }}
                            stroke={chartTheme.grid}
                          />
                          <YAxis
                            tickFormatter={(v: number) => formatClock(v)}
                            tick={{ fill: chartTheme.axis, fontSize: 11 }}
                            stroke={chartTheme.grid}
                            domain={['dataMin - 10', 'dataMax + 10']}
                            reversed
                          />
                          <Tooltip
                            {...tooltipStyle}
                            formatter={(value: number) => [formatClock(value), 'Time']}
                            labelFormatter={(label: string) => formatDateFull(label)}
                          />
                          <Line
                            type="monotone"
                            dataKey="time"
                            stroke={chartTheme.colors.secondary.main}
                            strokeWidth={2}
                            dot={{ fill: chartTheme.colors.secondary.main, r: 3 }}
                            activeDot={{ r: 5, stroke: chartTheme.colors.secondary.light, strokeWidth: 2 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Effort history table */}
                    <div className="mt-4 max-h-48 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-text-muted border-b border-border-subtle">
                            <th className="text-left py-2 font-medium">Date</th>
                            <th className="text-left py-2 font-medium">Activity</th>
                            <th className="text-right py-2 font-medium">Time</th>
                            {seg.bestWatts && <th className="text-right py-2 font-medium">Power</th>}
                            {seg.bestHR && <th className="text-right py-2 font-medium">HR</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {[...seg.efforts].reverse().map((effort, i) => {
                            const isBest = effort.time === seg.bestTime
                            return (
                              <tr
                                key={i}
                                className={`border-b border-border-subtle/50 ${isBest ? 'text-accent' : 'text-text-secondary'}`}
                              >
                                <td className="py-1.5">{formatDateFull(effort.date)}</td>
                                <td className="py-1.5 max-w-[200px] truncate">{effort.activityName}</td>
                                <td className="py-1.5 text-right font-medium">
                                  {formatClock(effort.time)}
                                  {isBest && <span className="ml-1 text-accent">★</span>}
                                </td>
                                {seg.bestWatts && (
                                  <td className="py-1.5 text-right">{effort.watts ? `${effort.watts}W` : '—'}</td>
                                )}
                                {seg.bestHR && (
                                  <td className="py-1.5 text-right">{effort.hr ? `${Math.round(effort.hr)} bpm` : '—'}</td>
                                )}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <Pagination
              page={segmentPage}
              pageSize={SEGMENTS_PAGE_SIZE}
              total={segmentSummaries.length}
              onPageChange={setSegmentPage}
            />
          </div>
        )}
      </section>
    </div>
  )
}
