import { useMemo, useState, useCallback, useEffect } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { type StravaActivity, metersToKm, secondsToHMS } from '~/lib/strava'
import { useDashboard, type ActivityGroup } from '~/lib/dashboard-context'
import { formatDateFull } from '~/lib/chart-theme'
import { calculateActivityScores, estimateFTP } from '~/lib/performance'
import { isRide, getScoreLabel, scoreLabelClasses, activityTypeClasses } from '~/lib/activities'
import { Pagination } from '~/components/Pagination'

const ACTIVITIES_PAGE_SIZE = 25

interface ActivityListProps {
  activities: StravaActivity[]
}

type SortColumn = 'date' | 'type' | 'distance' | 'time' | 'elevation' | 'power' | 'hr' | 'score' | 'category' | null
type SortDirection = 'asc' | 'desc'

type TypeFilter = 'all' | 'ride' | 'zwift' | 'run'
type CategoryFilter = 'all' | 'training' | 'performance'
type ScoreFilter = 'all' | 'Easy' | 'Moderate' | 'Solid' | 'Hard' | 'Epic'

const DISTANCE_OPTIONS = [
  { value: 0, label: 'Any distance' },
  { value: 20, label: '20+ km' },
  { value: 40, label: '40+ km' },
  { value: 60, label: '60+ km' },
  { value: 80, label: '80+ km' },
] as const

interface MergedActivity {
  type: 'single'
  activity: StravaActivity
}

interface MergedGroup {
  type: 'group'
  group: ActivityGroup
  activities: StravaActivity[]
  // Aggregated values
  distance: number
  movingTime: number
  elevation: number
  avgWatts: number | undefined
  avgHR: number | undefined
  date: string // earliest activity date
  latestDate: string // for sorting
}

type ListItem = MergedActivity | MergedGroup

function aggregateGroup(group: ActivityGroup, activities: StravaActivity[]): MergedGroup {
  const groupActivities = group.activityIds
    .map((id) => activities.find((a) => a.id === id))
    .filter((a): a is StravaActivity => a != null)
    .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime())

  const distance = groupActivities.reduce((sum, a) => sum + a.distance, 0)
  const movingTime = groupActivities.reduce((sum, a) => sum + a.moving_time, 0)
  const elevation = groupActivities.reduce((sum, a) => sum + a.total_elevation_gain, 0)

  const wattsActivities = groupActivities.filter((a) => a.average_watts)
  const avgWatts = wattsActivities.length > 0
    ? wattsActivities.reduce((sum, a) => sum + (a.average_watts || 0), 0) / wattsActivities.length
    : undefined

  const hrActivities = groupActivities.filter((a) => a.average_heartrate)
  const avgHR = hrActivities.length > 0
    ? hrActivities.reduce((sum, a) => sum + (a.average_heartrate || 0), 0) / hrActivities.length
    : undefined

  const dates = groupActivities.map((a) => a.start_date_local)

  return {
    type: 'group',
    group,
    activities: groupActivities,
    distance,
    movingTime,
    elevation,
    avgWatts,
    avgHR,
    date: dates[0] || '',
    latestDate: dates[dates.length - 1] || '',
  }
}

export function ActivityList({ activities }: ActivityListProps) {
  const { trainingActivityIds, toggleActivityCategory, activityGroups, createGroup, deleteGroup, updateGroupName, maxHR, restingHR } = useDashboard()
  const navigate = useNavigate()

  const [groupMode, setGroupMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [showGroupNameModal, setShowGroupNameModal] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortColumn, setSortColumn] = useState<SortColumn>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(1)

  // Filters
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all')
  const [minDistanceKm, setMinDistanceKm] = useState(0)
  const [yearFilter, setYearFilter] = useState<'all' | string>('all')

  const hasActiveFilters =
    typeFilter !== 'all' ||
    categoryFilter !== 'all' ||
    scoreFilter !== 'all' ||
    minDistanceKm > 0 ||
    yearFilter !== 'all'

  const clearFilters = useCallback(() => {
    setTypeFilter('all')
    setCategoryFilter('all')
    setScoreFilter('all')
    setMinDistanceKm(0)
    setYearFilter('all')
  }, [])

  // Years present in the data, newest first
  const availableYears = useMemo(() => {
    const years = new Set<string>()
    for (const a of activities) years.add(a.start_date_local.slice(0, 4))
    return Array.from(years).sort().reverse()
  }, [activities])

  const scoreMap = useMemo(() => {
    const rides = activities.filter(isRide)
    const ftp = estimateFTP(rides) || 0
    const scores = calculateActivityScores(activities, ftp, maxHR, restingHR)
    const map = new Map<number, number>()
    for (const s of scores) map.set(s.activityId, s.rideScore)
    return map
  }, [activities, maxHR, restingHR])

  const matchesFilters = useCallback(
    (a: StravaActivity): boolean => {
      if (typeFilter === 'ride' && a.type !== 'Ride') return false
      if (typeFilter === 'zwift' && a.type !== 'VirtualRide') return false
      if (typeFilter === 'run' && a.type !== 'Run') return false
      if (categoryFilter !== 'all') {
        const isTraining = trainingActivityIds.includes(a.id)
        if ((categoryFilter === 'training') !== isTraining) return false
      }
      if (scoreFilter !== 'all') {
        const score = scoreMap.get(a.id)
        if (score == null || getScoreLabel(score) !== scoreFilter) return false
      }
      if (minDistanceKm > 0 && metersToKm(a.distance) < minDistanceKm) return false
      if (yearFilter !== 'all' && !a.start_date_local.startsWith(yearFilter)) return false
      return true
    },
    [typeFilter, categoryFilter, scoreFilter, minDistanceKm, yearFilter, trainingActivityIds, scoreMap]
  )

  // Build grouped activity IDs set for quick lookup
  const groupedActivityIds = useMemo(() => {
    const ids = new Set<number>()
    for (const group of activityGroups) {
      for (const id of group.activityIds) {
        ids.add(id)
      }
    }
    return ids
  }, [activityGroups])

  // Build list items: groups + ungrouped singles, with search filtering and sorting
  const listItems = useMemo(() => {
    const items: ListItem[] = []

    const query = searchQuery.toLowerCase().trim()

    // Add groups (only if they have visible activities). A group stays
    // visible when any member matches the active filters.
    for (const group of activityGroups) {
      const merged = aggregateGroup(group, activities)
      if (merged.activities.length > 0) {
        if (query && !merged.group.name.toLowerCase().includes(query) &&
            !merged.activities.some((a) => a.name.toLowerCase().includes(query))) {
          continue
        }
        if (!merged.activities.some(matchesFilters)) continue
        items.push(merged)
      }
    }

    // Add ungrouped activities
    for (const activity of activities) {
      if (!groupedActivityIds.has(activity.id)) {
        if (query && !activity.name.toLowerCase().includes(query)) continue
        if (!matchesFilters(activity)) continue
        items.push({ type: 'single', activity })
      }
    }

    // Sort helper: extract numeric value for a column
    const getSortValue = (item: ListItem, col: SortColumn): number => {
      if (item.type === 'single') {
        const a = item.activity
        switch (col) {
          case 'date': return new Date(a.start_date).getTime()
          case 'type': return a.type.toLowerCase().charCodeAt(0)
          case 'distance': return a.distance
          case 'time': return a.moving_time
          case 'elevation': return a.total_elevation_gain
          case 'power': return a.average_watts || 0
          case 'hr': return a.average_heartrate || 0
          case 'score': return scoreMap.get(a.id) || 0
          case 'category': return trainingActivityIds.includes(a.id) ? 1 : 0
          default: return 0
        }
      } else {
        switch (col) {
          case 'date': return new Date(item.latestDate).getTime()
          case 'type': return item.activities[0]?.type.toLowerCase().charCodeAt(0) || 0
          case 'distance': return item.distance
          case 'time': return item.movingTime
          case 'elevation': return item.elevation
          case 'power': return item.avgWatts || 0
          case 'hr': return item.avgHR || 0
          case 'score': {
            const total = item.activities.reduce((sum, a) => sum + (scoreMap.get(a.id) || 0), 0)
            const count = item.activities.filter((a) => scoreMap.has(a.id)).length
            return count > 0 ? total / count : 0
          }
          case 'category': return item.activities.length > 0 && trainingActivityIds.includes(item.activities[0].id) ? 1 : 0
          default: return 0
        }
      }
    }

    // Sort: default to date descending when no column selected
    const activeCol = sortColumn ?? 'date'
    const activeDir = sortColumn ? sortDirection : 'desc'
    const dir = activeDir === 'asc' ? 1 : -1
    items.sort((a, b) => (getSortValue(a, activeCol) - getSortValue(b, activeCol)) * dir)

    return items
  }, [activities, activityGroups, groupedActivityIds, searchQuery, sortColumn, sortDirection, scoreMap, trainingActivityIds, matchesFilters])

  // Reset to first page when filters/sort change.
  useEffect(() => {
    setPage(1)
  }, [searchQuery, sortColumn, sortDirection, typeFilter, categoryFilter, scoreFilter, minDistanceKm, yearFilter])

  const pagedItems = useMemo(
    () => listItems.slice((page - 1) * ACTIVITIES_PAGE_SIZE, page * ACTIVITIES_PAGE_SIZE),
    [listItems, page]
  )

  const toggleSelect = useCallback((id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        // Enforce same category: check if adding this would mix categories
        const isTraining = trainingActivityIds.includes(id)
        if (next.size > 0) {
          const firstId = next.values().next().value!
          const firstIsTraining = trainingActivityIds.includes(firstId)
          if (isTraining !== firstIsTraining) return prev
        }
        next.add(id)
      }
      return next
    })
  }, [trainingActivityIds])

  const toggleGroupExpanded = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }, [])

  const handleCreateGroup = useCallback(async () => {
    if (selectedIds.size < 2 || !groupName.trim()) return
    await createGroup(groupName.trim(), Array.from(selectedIds))
    setSelectedIds(new Set())
    setGroupName('')
    setShowGroupNameModal(false)
  }, [selectedIds, groupName, createGroup])

  const handleDeleteGroup = useCallback(async (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await deleteGroup(groupId)
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      next.delete(groupId)
      return next
    })
  }, [deleteGroup])

  const handleStartRename = useCallback((groupId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingGroupId(groupId)
    setEditingGroupName(currentName)
  }, [])

  const handleFinishRename = useCallback(async () => {
    if (editingGroupId && editingGroupName.trim()) {
      await updateGroupName(editingGroupId, editingGroupName.trim())
    }
    setEditingGroupId(null)
    setEditingGroupName('')
  }, [editingGroupId, editingGroupName, updateGroupName])

  const toggleGroupMode = useCallback(() => {
    setGroupMode((prev) => {
      if (prev) setSelectedIds(new Set())
      return !prev
    })
  }, [])

  const handleSort = useCallback((col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(col)
      setSortDirection('desc')
    }
  }, [sortColumn])

  if (activities.length === 0) {
    return (
      <div className="text-center py-16 text-text-muted text-[0.9rem]">
        <p>No activities found for the selected filters.</p>
      </div>
    )
  }

  const thClass = "text-left p-4 px-5 bg-bg-tertiary text-text-muted font-semibold uppercase text-[0.7rem] tracking-wider max-md:px-2 max-md:py-2.5"
  const tdClass = "p-4 px-5 border-b border-border-subtle max-md:px-2 max-md:py-2.5"
  const filterSelectClass = "custom-select bg-bg-tertiary border border-border text-text-secondary py-1.5 pr-8 pl-3 rounded-[var(--radius-sm)] text-[0.75rem] cursor-pointer transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15 shrink-0"

  return (
    <>
      {/* Toolbar: search + filters + group toggle */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-[300px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name..."
            className="w-full bg-bg-tertiary border border-border text-text-primary py-1.5 pl-9 pr-3 rounded-[var(--radius-sm)] text-[0.8rem] transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
          />
        </div>

        {/* Type segmented control */}
        <div className="flex rounded-[var(--radius-sm)] border border-border overflow-hidden shrink-0">
          {(
            [
              ['all', 'All'],
              ['ride', 'Rides'],
              ['zwift', 'Zwift'],
              ['run', 'Runs'],
            ] as Array<[TypeFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTypeFilter(value)}
              className={`py-1.5 px-3 text-[0.75rem] font-semibold cursor-pointer transition-all duration-150 not-first:border-l not-first:border-border ${
                typeFilter === value
                  ? 'bg-accent/15 text-accent'
                  : 'bg-bg-tertiary text-text-muted hover:text-text-primary hover:bg-bg-elevated'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
          className={filterSelectClass}
          title="Filter by category"
        >
          <option value="all">All categories</option>
          <option value="training">Training</option>
          <option value="performance">Performance</option>
        </select>

        <select
          value={scoreFilter}
          onChange={(e) => setScoreFilter(e.target.value as ScoreFilter)}
          className={filterSelectClass}
          title="Filter by ride score"
        >
          <option value="all">Any score</option>
          <option value="Easy">Easy</option>
          <option value="Moderate">Moderate</option>
          <option value="Solid">Solid</option>
          <option value="Hard">Hard</option>
          <option value="Epic">Epic</option>
        </select>

        <select
          value={minDistanceKm}
          onChange={(e) => setMinDistanceKm(Number(e.target.value))}
          className={filterSelectClass}
          title="Filter by minimum distance"
        >
          {DISTANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className={filterSelectClass}
          title="Filter by year"
        >
          <option value="all">All years</option>
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.75rem] font-semibold cursor-pointer text-text-muted hover:text-text-primary bg-bg-tertiary border border-border hover:border-text-muted transition-all duration-150"
          >
            ✕ Clear
          </button>
        )}

        {(hasActiveFilters || searchQuery.trim()) && (
          <span className="text-[0.75rem] text-text-muted data-value">
            {listItems.length} result{listItems.length === 1 ? '' : 's'}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <button
            className={`py-1.5 px-4 rounded-[var(--radius-sm)] text-[0.8rem] font-semibold cursor-pointer transition-all duration-150 ${
              groupMode
                ? 'bg-accent text-white hover:bg-accent-dark'
                : 'bg-bg-tertiary border border-border text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
            }`}
            onClick={toggleGroupMode}
          >
            {groupMode ? 'Grouping On' : 'Group Activities'}
          </button>
          {groupMode && selectedIds.size > 0 && (
            <span className="text-sm text-text-muted animate-fade-in">
              {selectedIds.size} selected
            </span>
          )}
        </div>
      </div>

      {/* Group name modal */}
      {showGroupNameModal && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setShowGroupNameModal(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-6 w-[400px] max-w-[90vw] shadow-xl animate-modal-slide-in">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Group Activities</h3>
            <p className="text-sm text-text-muted mb-4">
              Give this group a name. The {selectedIds.size} activities will appear as a single merged entry.
            </p>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGroup() }}
              placeholder="e.g. Weekend Century Ride"
              autoFocus
              className="w-full bg-bg-tertiary border border-border text-text-primary py-2.5 px-4 rounded-[var(--radius-sm)] text-sm transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15 mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                className="py-2 px-4 rounded-[var(--radius-sm)] text-sm font-medium cursor-pointer bg-bg-tertiary border border-border text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-all duration-150"
                onClick={() => setShowGroupNameModal(false)}
              >
                Cancel
              </button>
              <button
                className="py-2 px-4 rounded-[var(--radius-sm)] text-sm font-semibold cursor-pointer bg-accent text-white hover:bg-accent-dark transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!groupName.trim()}
                onClick={handleCreateGroup}
              >
                Create Group
              </button>
            </div>
          </div>
        </>
      )}

      <div className="overflow-x-auto bg-bg-secondary rounded-[var(--radius-lg)] border border-border-subtle max-md:text-[0.8rem]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${thClass} first:rounded-tl-[var(--radius-lg)] w-10`}>
                <span className="sr-only">{groupMode ? 'Select' : ''}</span>
              </th>
              <th
                className={`${thClass} cursor-pointer select-none hover:text-text-primary transition-colors`}
                onClick={() => handleSort('date')}
              >
                <span className="inline-flex items-center gap-1">
                  Date
                  {(sortColumn === 'date' || sortColumn === null) && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={`transition-transform ${(sortColumn === null ? 'desc' : sortDirection) === 'asc' ? 'rotate-180' : ''}`}>
                      <path d="M7 10l5 5 5-5z" />
                    </svg>
                  )}
                </span>
              </th>
              <th className={thClass}>Name</th>
              {(['type', 'distance', 'time', 'elevation', 'power', 'hr', 'score', 'category'] as SortColumn[]).map((col, i, arr) => {
                const label = col === 'score' ? 'Ride Score' : col === 'hr' ? 'HR' : col!.charAt(0).toUpperCase() + col!.slice(1)
                const isActive = sortColumn === col
                const isLast = i === arr.length - 1
                return (
                  <th
                    key={col}
                    className={`${thClass} cursor-pointer select-none hover:text-text-primary transition-colors ${isLast ? 'last:rounded-tr-[var(--radius-lg)]' : ''}`}
                    onClick={() => handleSort(col)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {label}
                      {isActive && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className={`transition-transform ${sortDirection === 'asc' ? 'rotate-180' : ''}`}>
                          <path d="M7 10l5 5 5-5z" />
                        </svg>
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {pagedItems.length === 0 && (
              <tr>
                <td colSpan={11} className="p-8 text-center text-text-muted text-sm">
                  No activities match the current filters.
                </td>
              </tr>
            )}
            {pagedItems.map((item) => {
              if (item.type === 'group') {
                const isExpanded = expandedGroups.has(item.group.id)
                return (
                  <GroupRow
                    key={`group-${item.group.id}`}
                    item={item}
                    isExpanded={isExpanded}
                    onToggleExpand={() => toggleGroupExpanded(item.group.id)}
                    onDelete={(e) => handleDeleteGroup(item.group.id, e)}
                    onStartRename={(e) => handleStartRename(item.group.id, item.group.name, e)}
                    editingGroupId={editingGroupId}
                    editingGroupName={editingGroupName}
                    setEditingGroupName={setEditingGroupName}
                    onFinishRename={handleFinishRename}
                    tdClass={tdClass}
                    scoreMap={scoreMap}
                    trainingActivityIds={trainingActivityIds}
                    toggleActivityCategory={toggleActivityCategory}
                    navigate={navigate}
                    groupMode={groupMode}
                  />
                )
              }

              const activity = item.activity
              const isTraining = trainingActivityIds.includes(activity.id)
              const isSelected = selectedIds.has(activity.id)
              return (
                <ActivityRow
                  key={activity.id}
                  activity={activity}
                  isTraining={isTraining}
                  isSelected={groupMode ? isSelected : undefined}
                  onToggleSelect={groupMode ? (e) => toggleSelect(activity.id, e) : undefined}
                  toggleActivityCategory={toggleActivityCategory}
                  navigate={navigate}
                  tdClass={tdClass}
                  scoreMap={scoreMap}
                  groupMode={groupMode}
                />
              )
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={ACTIVITIES_PAGE_SIZE}
        total={listItems.length}
        onPageChange={setPage}
      />

      {/* Sticky confirm group button */}
      {groupMode && (
        <div className="sticky bottom-4 z-30 flex justify-center mt-4 animate-fade-in">
          <button
            className="py-3 px-8 rounded-[var(--radius-md)] text-sm font-semibold cursor-pointer transition-all duration-150 bg-accent text-white hover:bg-accent-dark shadow-lg shadow-accent/25 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
            disabled={selectedIds.size < 2}
            onClick={() => {
              setGroupName('')
              setShowGroupNameModal(true)
            }}
          >
            Confirm Group{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </button>
        </div>
      )}
    </>
  )
}

function ActivityRow({
  activity,
  isTraining,
  isSelected,
  onToggleSelect,
  toggleActivityCategory,
  navigate,
  tdClass,
  scoreMap,
  indent,
  groupMode,
}: {
  activity: StravaActivity
  isTraining: boolean
  isSelected?: boolean
  onToggleSelect?: (e: React.MouseEvent) => void
  toggleActivityCategory: (id: number) => void
  navigate: ReturnType<typeof useNavigate>
  tdClass: string
  scoreMap: Map<number, number>
  indent?: boolean
  groupMode?: boolean
}) {
  return (
    <tr
      className={`transition-colors duration-150 hover:[&_td]:bg-bg-tertiary last:[&_td]:border-b-0 cursor-pointer ${indent ? '[&_td]:bg-bg-primary/50' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input[type="checkbox"]')) return
        navigate({ to: '/activities/$activityId', params: { activityId: String(activity.id) } })
      }}
    >
      <td className={tdClass}>
        {onToggleSelect ? (
          <input
            type="checkbox"
            checked={isSelected || false}
            onChange={() => {}}
            onClick={onToggleSelect}
            className="size-4 accent-accent cursor-pointer"
          />
        ) : indent ? (
          <span className="text-text-muted text-xs pl-2">-</span>
        ) : null}
      </td>
      <td className={tdClass}>{formatDateFull(activity.start_date_local)}</td>
      <td className={`${tdClass} font-semibold max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap max-md:max-w-[140px]`}>
        <Link
          to="/activities/$activityId"
          params={{ activityId: String(activity.id) }}
          className="text-text-primary no-underline hover:text-accent transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {activity.name}
        </Link>
      </td>
      <td className={tdClass}>
        <span className={`inline-block py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.7rem] font-semibold uppercase tracking-wide ${activityTypeClasses[activity.type.toLowerCase()] || 'bg-bg-tertiary text-text-secondary'}`}>
          {activity.type === 'VirtualRide' ? 'Zwift' : activity.type}
        </span>
      </td>
      <td className={tdClass}>{metersToKm(activity.distance).toFixed(1)} km</td>
      <td className={tdClass}>{secondsToHMS(activity.moving_time)}</td>
      <td className={tdClass}>{activity.total_elevation_gain.toFixed(0)} m</td>
      <td className={tdClass}>
        {activity.average_watts ? `${Math.round(activity.average_watts)} W` : '-'}
      </td>
      <td className={tdClass}>
        {activity.average_heartrate
          ? `${Math.round(activity.average_heartrate)} bpm`
          : '-'}
      </td>
      <td className={tdClass}>
        {scoreMap.has(activity.id) ? (() => {
          const score = scoreMap.get(activity.id)!
          const label = getScoreLabel(score)
          return (
            <span className={`inline-block py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.7rem] font-semibold ${scoreLabelClasses[label]}`}>
              {score} · {label}
            </span>
          )
        })() : '-'}
      </td>
      <td className={tdClass}>
        <button
          className={`py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.7rem] font-semibold cursor-pointer transition-all duration-150 whitespace-nowrap ${
            isTraining
              ? 'bg-warning/10 border border-warning/30 text-warning hover:bg-warning/20 hover:border-warning/50'
              : 'bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 hover:border-accent/50'
          }`}
          onClick={() => toggleActivityCategory(activity.id)}
          title={isTraining ? 'Mark as performance activity' : 'Mark as training activity'}
        >
          {isTraining ? 'Training' : 'Performance'}
        </button>
      </td>
    </tr>
  )
}

function GroupRow({
  item,
  isExpanded,
  onToggleExpand,
  onDelete,
  onStartRename,
  editingGroupId,
  editingGroupName,
  setEditingGroupName,
  onFinishRename,
  tdClass,
  scoreMap,
  trainingActivityIds,
  toggleActivityCategory,
  navigate,
  groupMode,
}: {
  item: MergedGroup
  isExpanded: boolean
  onToggleExpand: () => void
  onDelete: (e: React.MouseEvent) => void
  onStartRename: (e: React.MouseEvent) => void
  editingGroupId: string | null
  editingGroupName: string
  setEditingGroupName: (name: string) => void
  onFinishRename: () => void
  tdClass: string
  scoreMap: Map<number, number>
  trainingActivityIds: number[]
  toggleActivityCategory: (id: number) => void
  navigate: ReturnType<typeof useNavigate>
  groupMode: boolean
}) {
  const isEditing = editingGroupId === item.group.id

  // Aggregate ride scores
  const totalScore = item.activities.reduce((sum, a) => sum + (scoreMap.get(a.id) || 0), 0)
  const scoredCount = item.activities.filter((a) => scoreMap.has(a.id)).length
  const avgScore = scoredCount > 0 ? Math.round(totalScore / scoredCount) : null

  // Get unique activity types
  const types = [...new Set(item.activities.map((a) => a.type))]

  return (
    <>
      <tr
        className="transition-colors duration-150 hover:[&_td]:bg-bg-tertiary cursor-pointer [&_td]:bg-accent/[0.03]"
        onClick={onToggleExpand}
      >
        <td className={tdClass}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`text-accent transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </td>
        <td className={tdClass}>
          <span className="text-text-muted text-xs">
            {formatDateFull(item.date)}
            {item.activities.length > 1 && item.date !== item.latestDate && (
              <> - {formatDateFull(item.latestDate)}</>
            )}
          </span>
        </td>
        <td className={`${tdClass} font-semibold max-w-[220px] max-md:max-w-[140px]`}>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <input
                type="text"
                value={editingGroupName}
                onChange={(e) => setEditingGroupName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onFinishRename(); if (e.key === 'Escape') { setEditingGroupName(''); onFinishRename() } }}
                onBlur={onFinishRename}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                className="bg-bg-tertiary border border-accent text-text-primary py-0.5 px-2 rounded text-sm w-full focus:outline-none"
              />
            ) : (
              <>
                <span className="bg-linear-to-r from-accent to-accent-light bg-clip-text text-transparent font-bold">
                  {item.group.name}
                </span>
                <span className="text-[0.65rem] text-text-muted bg-bg-tertiary py-0.5 px-1.5 rounded-full">
                  {item.activities.length}
                </span>
              </>
            )}
          </div>
        </td>
        <td className={tdClass}>
          <div className="flex flex-wrap gap-1">
            {types.map((t) => (
              <span key={t} className={`inline-block py-1 px-2 rounded-[var(--radius-sm)] text-[0.65rem] font-semibold uppercase tracking-wide ${activityTypeClasses[t.toLowerCase()] || 'bg-bg-tertiary text-text-secondary'}`}>
                {t === 'VirtualRide' ? 'Zwift' : t}
              </span>
            ))}
          </div>
        </td>
        <td className={`${tdClass} font-medium`}>{metersToKm(item.distance).toFixed(1)} km</td>
        <td className={`${tdClass} font-medium`}>{secondsToHMS(item.movingTime)}</td>
        <td className={`${tdClass} font-medium`}>{item.elevation.toFixed(0)} m</td>
        <td className={`${tdClass} font-medium`}>
          {item.avgWatts ? `${Math.round(item.avgWatts)} W` : '-'}
        </td>
        <td className={`${tdClass} font-medium`}>
          {item.avgHR ? `${Math.round(item.avgHR)} bpm` : '-'}
        </td>
        <td className={`${tdClass} font-medium`}>
          {avgScore != null ? (() => {
            const label = getScoreLabel(avgScore)
            return (
              <span className={`inline-block py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.7rem] font-semibold ${scoreLabelClasses[label]}`}>
                {avgScore} · {label}
              </span>
            )
          })() : '-'}
        </td>
        <td className={tdClass}>
          {groupMode ? (
            <div className="flex items-center gap-1">
              <button
                className="py-1 px-2 rounded text-[0.65rem] font-medium cursor-pointer bg-bg-tertiary border border-border text-text-muted hover:text-text-primary hover:border-text-muted transition-all duration-150"
                onClick={onStartRename}
                title="Rename group"
              >
                Rename
              </button>
              <button
                className="py-1 px-2 rounded text-[0.65rem] font-medium cursor-pointer bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20 hover:border-danger/40 transition-all duration-150"
                onClick={onDelete}
                title="Ungroup activities"
              >
                Ungroup
              </button>
            </div>
          ) : (() => {
            const groupIsTraining = item.activities.length > 0 && trainingActivityIds.includes(item.activities[0].id)
            return (
              <span className={`inline-block py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.7rem] font-semibold whitespace-nowrap ${
                groupIsTraining
                  ? 'bg-warning/10 border border-warning/30 text-warning'
                  : 'bg-accent/10 border border-accent/30 text-accent'
              }`}>
                {groupIsTraining ? 'Training' : 'Performance'}
              </span>
            )
          })()}
        </td>
      </tr>

      {/* Expanded child activities */}
      {isExpanded && item.activities.map((activity) => {
        const isTraining = trainingActivityIds.includes(activity.id)
        return (
          <ActivityRow
            key={activity.id}
            activity={activity}
            isTraining={isTraining}
            toggleActivityCategory={toggleActivityCategory}
            navigate={navigate}
            tdClass={tdClass}
            scoreMap={scoreMap}
            indent
          />
        )
      })}
    </>
  )
}
