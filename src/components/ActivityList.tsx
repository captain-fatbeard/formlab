import { Fragment, useMemo, useState, useCallback, useEffect } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { type StravaActivity, metersToKm } from '~/lib/strava'
import { useDashboard, type ActivityGroup } from '~/lib/dashboard-context'
import {
  formatDateFull,
  formatDateShort,
  formatMonthYear,
  formatNumber,
  formatDistance,
  formatElevation,
  formatDuration,
} from '~/lib/format'
import { buttonPrimary, buttonSecondary, filterSelect } from '~/lib/styles'
import { useModalPanel } from '~/lib/use-modal-panel'
import { calculateActivityScores } from '~/lib/performance'
import { getScoreLabel, scoreLabelClasses, activityTypeClasses } from '~/lib/activities'
import { rollup } from '~/lib/rollup'
import { Pagination } from '~/components/Pagination'


interface ActivityListProps {
  activities: StravaActivity[]
}

type SortColumn = 'date' | 'type' | 'distance' | 'time' | 'elevation' | 'power' | 'hr' | 'score' | 'category' | null
type SortDirection = 'asc' | 'desc'

type TypeFilter = 'all' | 'ride' | 'zwift' | 'run'
type CategoryFilter = 'all' | 'training' | 'performance'
type ScoreFilter = 'all' | 'Easy' | 'Moderate' | 'Solid' | 'Hard' | 'Epic'

/**
 * The table's columns, in order. `id: null` means the column can't be sorted;
 * `secondary` means it gives way between `md` and `lg`, where eleven columns
 * would otherwise force horizontal scrolling and cost the reader their place.
 * Below `md` the table is replaced by the card list entirely.
 */
const COLUMNS: Array<{
  id: Exclude<SortColumn, null> | null
  label: string
  numeric?: boolean
  secondary?: boolean
  /** Fixed track width. `null` takes whatever is left — only the name does. */
  width: string | null
}> = [
  { id: 'date', label: 'Date', width: 'w-[8rem]' },
  { id: null, label: 'Name', width: null },
  { id: 'type', label: 'Type', width: 'w-[5.5rem]' },
  { id: 'distance', label: 'Distance', numeric: true, width: 'w-[6.5rem]' },
  { id: 'time', label: 'Time', numeric: true, width: 'w-[5.5rem]' },
  { id: 'elevation', label: 'Elevation', numeric: true, secondary: true, width: 'w-[6rem]' },
  { id: 'power', label: 'Power', numeric: true, secondary: true, width: 'w-[5.5rem]' },
  { id: 'hr', label: 'HR', numeric: true, secondary: true, width: 'w-[6rem]' },
  { id: 'score', label: 'Ride score', width: 'w-[8.5rem]' },
  { id: 'category', label: 'Category', width: 'w-[8.5rem]' },
]

/**
 * Applied to both the header cell and the body cell of a secondary column.
 * Below `xl` there isn't room for eleven columns, and a table that overflows
 * its own container spills its last column past the border.
 */
const SECONDARY_COLUMN = 'max-xl:hidden'

/** How many rows a page holds. A long filter is worth reading in fewer pages. */
const PAGE_SIZES = [25, 50, 100] as const

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

  const summary = rollup(groupActivities)

  return {
    type: 'group',
    group,
    activities: groupActivities,
    distance: summary?.distance ?? 0,
    movingTime: summary?.movingTime ?? 0,
    elevation: summary?.elevation ?? 0,
    avgWatts: summary?.avgWatts,
    avgHR: summary?.avgHeartrate,
    date: summary?.earliest.start_date_local ?? '',
    latestDate: summary?.latest.start_date_local ?? '',
  }
}

export function ActivityList({ activities }: ActivityListProps) {
  const { trainingActivityIds, toggleActivityCategory, activityGroups, createGroup, deleteGroup, updateGroupName, tssThresholds } = useDashboard()
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
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0])

  const closeGroupModal = useCallback(() => setShowGroupNameModal(false), [])
  const groupModalRef = useModalPanel<HTMLDivElement>(showGroupNameModal, closeGroupModal)

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
    const scores = calculateActivityScores(activities, tssThresholds)
    const map = new Map<number, number>()
    // A ride we can't derive load for shows no score rather than "0 · Easy".
    for (const s of scores) if (s.rideScore > 0) map.set(s.activityId, s.rideScore)
    return map
  }, [activities, tssThresholds])

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
  }, [searchQuery, sortColumn, sortDirection, typeFilter, categoryFilter, scoreFilter, minDistanceKm, yearFilter, pageSize])

  const pagedItems = useMemo(
    () => listItems.slice((page - 1) * pageSize, page * pageSize),
    [listItems, page, pageSize]
  )

  /**
   * Totals for everything the filters match, not just the page on screen.
   * A filtered analytics table that can't tell you what it adds up to makes
   * the reader export it to a spreadsheet to find out.
   */
  const totals = useMemo(() => {
    let distance = 0
    let movingTime = 0
    let elevation = 0
    let count = 0
    for (const item of listItems) {
      if (item.type === 'single') {
        distance += item.activity.distance
        movingTime += item.activity.moving_time
        elevation += item.activity.total_elevation_gain
        count += 1
      } else {
        distance += item.distance
        movingTime += item.movingTime
        elevation += item.elevation
        count += item.activities.length
      }
    }
    return { distance, movingTime, elevation, count }
  }, [listItems])

  // Month headings only mean something while the table is in date order.
  const inDateOrder = sortColumn === null || sortColumn === 'date'

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

  const thClass = "text-left py-3.5 px-4 bg-bg-tertiary text-text-muted font-semibold uppercase text-[0.75rem] tracking-wider"
  const thNumeric = `${thClass} text-right`
  const tdClass = "py-3.5 px-4 border-b border-border-subtle"
  // Numbers are what this table is scanned for, so they are right-aligned and
  // set in the tabular figures the rest of the app uses.
  const tdNumeric = `${tdClass} text-right data-value whitespace-nowrap`

  return (
    <>
      {/* Toolbar: search + filters + group toggle */}
      <div className="flex items-center gap-3 mb-3 flex-wrap max-md:gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-[300px] max-md:max-w-none max-md:basis-full">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name..."
            aria-label="Search activities by name"
            className="w-full bg-bg-tertiary border border-border text-text-primary py-1.5 pl-9 pr-8 rounded-[var(--radius-sm)] text-[0.8rem] transition-all duration-150 hover:border-text-muted focus:outline-none focus:border-accent focus:ring-3 focus:ring-accent/15"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center size-5 text-text-muted hover:text-text-primary bg-transparent border-none cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
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
              type="button"
              onClick={() => setTypeFilter(value)}
              aria-pressed={typeFilter === value}
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
          className={filterSelect}
          title="Filter by category"
        >
          <option value="all">All categories</option>
          <option value="training">Training</option>
          <option value="performance">Performance</option>
        </select>

        <select
          value={scoreFilter}
          onChange={(e) => setScoreFilter(e.target.value as ScoreFilter)}
          className={filterSelect}
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
          className={filterSelect}
          title="Filter by minimum distance"
        >
          {DISTANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className={filterSelect}
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

        <label className="flex items-center gap-2 text-[0.75rem] text-text-muted shrink-0">
          <span className="max-md:hidden">Rows</span>
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label="Rows per page"
            className={filterSelect}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-3 max-md:ml-0 max-md:basis-full max-md:justify-between">
          <button
            type="button"
            aria-pressed={groupMode}
            className={`py-1.5 px-4 rounded-[var(--radius-sm)] text-[0.8125rem] font-semibold cursor-pointer transition-all duration-150 ${
              groupMode
                ? 'bg-accent text-bg-primary hover:bg-accent-light'
                : 'bg-bg-tertiary border border-border text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
            }`}
            onClick={toggleGroupMode}
          >
            {groupMode ? 'Grouping on' : 'Group activities'}
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
          <div
            ref={groupModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-modal-title"
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-bg-secondary border border-border rounded-[var(--radius-lg)] p-6 w-[400px] max-w-[90vw] shadow-xl animate-modal-slide-in"
          >
            <h3 id="group-modal-title" className="text-lg font-semibold text-text-primary mb-4">Group activities</h3>
            <p className="text-sm text-text-muted mb-4">
              Give this group a name. The {selectedIds.size} activities will appear as a single merged entry.
            </p>
            <label htmlFor="group-name" className="block text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold mb-2">
              Group name
            </label>
            <input
              id="group-name"
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
                type="button"
                className={buttonSecondary}
                onClick={() => setShowGroupNameModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={buttonPrimary}
                disabled={!groupName.trim()}
                onClick={handleCreateGroup}
              >
                Create group
              </button>
            </div>
          </div>
        </>
      )}

      {/* Below md the table becomes a card list. Eleven columns on a 390px
          screen scrolled sideways with no sticky first column, so once you
          scrolled right you no longer knew which activity you were reading —
          on the app's most-used screen. */}
      <ul className="hidden max-md:flex flex-col gap-2 list-none">
        {pagedItems.length === 0 && (
          <li className="p-8 text-center text-text-muted text-sm bg-bg-secondary rounded-[var(--radius-lg)] border border-border-subtle">
            No activities match the current filters.
          </li>
        )}
        {pagedItems.map((item) =>
          item.type === 'group' ? (
            <li key={`card-group-${item.group.id}`}>
              <GroupCard
                item={item}
                isExpanded={expandedGroups.has(item.group.id)}
                onToggleExpand={() => toggleGroupExpanded(item.group.id)}
                scoreMap={scoreMap}
                trainingActivityIds={trainingActivityIds}
                toggleActivityCategory={toggleActivityCategory}
              />
            </li>
          ) : (
            <li key={`card-${item.activity.id}`}>
              <ActivityCard
                activity={item.activity}
                isTraining={trainingActivityIds.includes(item.activity.id)}
                isSelected={groupMode ? selectedIds.has(item.activity.id) : undefined}
                onToggleSelect={groupMode ? (e) => toggleSelect(item.activity.id, e) : undefined}
                toggleActivityCategory={toggleActivityCategory}
                scoreMap={scoreMap}
              />
            </li>
          )
        )}
      </ul>

      {/* `overflow-x-auto` at every width: the table used to be allowed to
          overflow visibly above lg, which pushed the Category column out past
          the container's right border. Fixed layout keeps it inside. */}
      <div className="max-md:hidden overflow-x-auto bg-bg-secondary rounded-[var(--radius-lg)] border border-border-subtle">
        <table className="w-full min-w-[52rem] table-fixed border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${thClass} first:rounded-tl-[var(--radius-lg)] w-9 px-3`}>
                <span className="sr-only">{groupMode ? 'Select' : 'Expand'}</span>
              </th>
              {COLUMNS.map((column, i) => {
                const isActive = sortColumn === column.id || (column.id === 'date' && sortColumn === null)
                const direction = sortColumn === null ? 'desc' : sortDirection
                const isLast = i === COLUMNS.length - 1
                return (
                  <th
                    key={column.id ?? column.label}
                    scope="col"
                    aria-sort={
                      !isActive ? 'none' : direction === 'asc' ? 'ascending' : 'descending'
                    }
                    className={`${column.numeric ? thNumeric : thClass} ${column.width ?? ''} ${column.secondary ? SECONDARY_COLUMN : ''} ${isLast ? 'last:rounded-tr-[var(--radius-lg)]' : ''}`}
                  >
                    {column.id ? (
                      // A real button: the header used to sort from `onClick` on
                      // the `<th>`, which no keyboard could reach.
                      <button
                        type="button"
                        onClick={() => handleSort(column.id)}
                        className={`group inline-flex items-center gap-1 uppercase tracking-wider font-semibold cursor-pointer bg-transparent border-none text-inherit transition-colors hover:text-text-primary ${
                          column.numeric ? 'flex-row-reverse' : ''
                        }`}
                      >
                        {column.label}
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          aria-hidden="true"
                          // An inactive column shows its arrow faintly on
                          // hover, so a sortable header looks sortable before
                          // you click it.
                          className={`transition-all ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'} ${
                            isActive && direction === 'asc' ? 'rotate-180' : ''
                          }`}
                        >
                          <path d="M7 10l5 5 5-5z" />
                        </svg>
                      </button>
                    ) : (
                      column.label
                    )}
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
            {pagedItems.map((item, index) => {
              // A month heading before the first row of each month: a training
              // log is read by period, and 25 undifferentiated rows of dates
              // give the reader nothing to anchor on.
              const previous = index > 0 ? pagedItems[index - 1] : null
              const monthOf = (entry: ListItem) =>
                formatMonthYear(entry.type === 'single' ? entry.activity.start_date_local : entry.latestDate)
              const month = monthOf(item)
              const heading =
                inDateOrder && (previous === null || monthOf(previous) !== month) ? (
                  <tr key={`month-${month}`}>
                    <td
                      colSpan={COLUMNS.length + 1}
                      className="px-5 pt-6 pb-2 border-b border-border-subtle text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold bg-bg-secondary"
                    >
                      {month}
                    </td>
                  </tr>
                ) : null

              if (item.type === 'group') {
                const isExpanded = expandedGroups.has(item.group.id)
                return (
                  <Fragment key={`group-${item.group.id}`}>
                  {heading}
                  <GroupRow
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
                    tdNumeric={tdNumeric}
                    scoreMap={scoreMap}
                    trainingActivityIds={trainingActivityIds}
                    toggleActivityCategory={toggleActivityCategory}
                    navigate={navigate}
                    groupMode={groupMode}
                  />
                  </Fragment>
                )
              }

              const activity = item.activity
              const isTraining = trainingActivityIds.includes(activity.id)
              const isSelected = selectedIds.has(activity.id)
              return (
                <Fragment key={activity.id}>
                {heading}
                <ActivityRow
                  activity={activity}
                  isTraining={isTraining}
                  isSelected={groupMode ? isSelected : undefined}
                  onToggleSelect={groupMode ? (e) => toggleSelect(activity.id, e) : undefined}
                  toggleActivityCategory={toggleActivityCategory}
                  navigate={navigate}
                  tdClass={tdClass}
                  tdNumeric={tdNumeric}
                  scoreMap={scoreMap}
                />
                </Fragment>
              )
            })}
          </tbody>

          {/* What the filter adds up to — over everything it matches, not just
              the page on screen. */}
          {totals.count > 0 && (
            <tfoot>
              <tr className="[&_td]:bg-bg-tertiary/60 [&_td]:border-t [&_td]:border-border">
                <td className={`${tdClass} border-b-0`} />
                <td className={`${tdClass} border-b-0 text-[0.75rem] text-text-muted uppercase tracking-wider font-semibold whitespace-nowrap`}>
                  Totals
                </td>
                <td className={`${tdClass} border-b-0 text-[0.75rem] text-text-muted`} colSpan={2}>
                  {formatNumber(totals.count)} {totals.count === 1 ? 'activity' : 'activities'}
                  {listItems.length !== totals.count && ` in ${formatNumber(listItems.length)} rows`}
                </td>
                <td className={`${tdNumeric} border-b-0 text-text-primary font-medium`}>
                  {formatDistance(metersToKm(totals.distance), 0)} km
                </td>
                <td className={`${tdNumeric} border-b-0 text-text-primary font-medium`}>
                  {formatDuration(totals.movingTime)}
                </td>
                <td className={`${tdNumeric} border-b-0 text-text-primary font-medium ${SECONDARY_COLUMN}`}>
                  {formatElevation(totals.elevation)} m
                </td>
                <td className={`${tdClass} border-b-0 ${SECONDARY_COLUMN}`} colSpan={2} />
                <td className={`${tdClass} border-b-0`} colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Pagination page={page} pageSize={pageSize} total={listItems.length} onPageChange={setPage} />

      {/* Sticky confirm group button */}
      {groupMode && (
        <div className="sticky bottom-4 z-30 flex justify-center mt-4 animate-fade-in">
          <button
            className={`${buttonPrimary} py-3 px-8 shadow-lg shadow-accent/25`}
            disabled={selectedIds.size < 2}
            onClick={() => {
              setGroupName('')
              setShowGroupNameModal(true)
            }}
          >
            Confirm group{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
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
  tdNumeric,
  scoreMap,
  indent,
}: {
  activity: StravaActivity
  isTraining: boolean
  isSelected?: boolean
  onToggleSelect?: (e: React.MouseEvent) => void
  toggleActivityCategory: (id: number) => void
  navigate: ReturnType<typeof useNavigate>
  tdClass: string
  tdNumeric: string
  scoreMap: Map<number, number>
  indent?: boolean
}) {
  return (
    <tr
      className={`transition-colors duration-150 hover:[&_td]:bg-bg-tertiary last:[&_td]:border-b-0 cursor-pointer ${indent ? '[&_td]:bg-bg-primary/50' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input[type="checkbox"]')) return
        navigate({ to: '/activities/$activityId', params: { activityId: String(activity.id) } })
      }}
    >
      <td className={`${tdClass} px-3`}>
        {onToggleSelect ? (
          <input
            type="checkbox"
            checked={isSelected || false}
            onChange={() => {}}
            onClick={onToggleSelect}
            aria-label={`Select ${activity.name}`}
            className="size-4 accent-accent cursor-pointer"
          />
        ) : indent ? (
          <span className="text-text-muted text-xs pl-2">-</span>
        ) : null}
      </td>
      <td className={`${tdClass} whitespace-nowrap`}>{formatDateFull(activity.start_date_local)}</td>
      <td className={`${tdClass} font-semibold max-w-0 overflow-hidden text-ellipsis whitespace-nowrap`}>
        <Link
          to="/activities/$activityId"
          params={{ activityId: String(activity.id) }}
          className="text-text-primary no-underline hover:text-accent transition-colors"
          onClick={(e) => e.stopPropagation()}
          title={activity.name}
        >
          {activity.name}
        </Link>
      </td>
      <td className={tdClass}>
        <span className={`inline-block py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.75rem] font-semibold uppercase tracking-wide ${activityTypeClasses[activity.type.toLowerCase()] || 'bg-bg-tertiary text-text-secondary'}`}>
          {activity.type === 'VirtualRide' ? 'Zwift' : activity.type}
        </span>
      </td>
      <td className={tdNumeric}>{formatDistance(metersToKm(activity.distance))} km</td>
      <td className={tdNumeric}>{formatDuration(activity.moving_time)}</td>
      <td className={`${tdNumeric} ${SECONDARY_COLUMN}`}>{formatElevation(activity.total_elevation_gain)} m</td>
      <td className={`${tdNumeric} ${SECONDARY_COLUMN}`}>
        {activity.average_watts ? `${formatNumber(activity.average_watts)} W` : '–'}
      </td>
      <td className={`${tdNumeric} ${SECONDARY_COLUMN}`}>
        {activity.average_heartrate ? `${formatNumber(activity.average_heartrate)} bpm` : '–'}
      </td>
      <td className={tdClass}>
        {scoreMap.has(activity.id) ? (() => {
          const score = scoreMap.get(activity.id)!
          const label = getScoreLabel(score)
          return (
            <span className={`inline-block py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.75rem] font-semibold ${scoreLabelClasses[label]}`}>
              {score} · {label}
            </span>
          )
        })() : '–'}
      </td>
      <td className={tdClass}>
        <CategoryToggle
          isTraining={isTraining}
          onToggle={() => toggleActivityCategory(activity.id)}
          name={activity.name}
        />
      </td>
    </tr>
  )
}

/**
 * The only clickable pill in a column of pills, so it has to look like a
 * control: a two-state switch rather than another badge in the same shape and
 * size as the read-only ones beside it.
 */
function CategoryToggle({
  isTraining,
  onToggle,
  name,
}: {
  isTraining: boolean
  onToggle: () => void
  name: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isTraining}
      aria-label={`${name} is a ${isTraining ? 'training' : 'performance'} activity — click to change`}
      onClick={onToggle}
      title={isTraining ? 'Mark as performance activity' : 'Mark as training activity'}
      className="inline-flex items-center p-px rounded-[var(--radius-sm)] bg-bg-tertiary border border-border cursor-pointer transition-colors duration-150 hover:border-text-muted"
    >
      {/* Both states stay visible so the control reads as a switch rather than
          a badge — abbreviated, because the column is 136px wide and a spilling
          control is worse than a shortened word. */}
      <span
        className={`px-2 py-0.5 rounded-[var(--radius-sm)] text-[0.75rem] font-semibold transition-colors ${
          isTraining ? 'bg-warning/20 text-warning' : 'text-text-muted'
        }`}
      >
        Training
      </span>
      <span
        className={`px-2 py-0.5 rounded-[var(--radius-sm)] text-[0.75rem] font-semibold transition-colors ${
          isTraining ? 'text-text-muted' : 'bg-accent/20 text-accent'
        }`}
      >
        Perf
      </span>
    </button>
  )
}

function ActivityCard({
  activity,
  isTraining,
  isSelected,
  onToggleSelect,
  toggleActivityCategory,
  scoreMap,
}: {
  activity: StravaActivity
  isTraining: boolean
  isSelected?: boolean
  onToggleSelect?: (e: React.MouseEvent) => void
  toggleActivityCategory: (id: number) => void
  scoreMap: Map<number, number>
}) {
  const score = scoreMap.get(activity.id)
  const label = score != null ? getScoreLabel(score) : null

  return (
    <div className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-md)] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={isSelected || false}
            onChange={() => {}}
            onClick={onToggleSelect}
            aria-label={`Select ${activity.name}`}
            className="size-4 accent-accent cursor-pointer mt-1 shrink-0"
          />
        )}
        <div className="min-w-0 flex-1">
          <Link
            to="/activities/$activityId"
            params={{ activityId: String(activity.id) }}
            className="text-text-primary no-underline font-semibold text-sm block leading-snug"
          >
            {activity.name}
          </Link>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[0.75rem] text-text-muted">{formatDateShort(activity.start_date_local)}</span>
            <span className={`inline-block py-0.5 px-2 rounded-[var(--radius-sm)] text-[0.75rem] font-semibold uppercase tracking-wide ${activityTypeClasses[activity.type.toLowerCase()] || 'bg-bg-tertiary text-text-secondary'}`}>
              {activity.type === 'VirtualRide' ? 'Zwift' : activity.type}
            </span>
            {label && score != null && (
              <span className={`inline-block py-0.5 px-2 rounded-[var(--radius-sm)] text-[0.75rem] font-semibold ${scoreLabelClasses[label]}`}>
                {score} · {label}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <CardStat label="Distance" value={`${formatDistance(metersToKm(activity.distance))} km`} />
        <CardStat label="Time" value={formatDuration(activity.moving_time)} />
        <CardStat
          label={activity.average_watts ? 'Power' : 'Climb'}
          value={
            activity.average_watts
              ? `${formatNumber(activity.average_watts)} W`
              : `${formatElevation(activity.total_elevation_gain)} m`
          }
        />
      </div>

      <CategoryToggle
        isTraining={isTraining}
        onToggle={() => toggleActivityCategory(activity.id)}
        name={activity.name}
      />
    </div>
  )
}

function CardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-tertiary rounded-[var(--radius-sm)] py-2">
      <div className="data-value text-sm text-text-primary font-medium">{value}</div>
      <div className="text-[0.75rem] text-text-muted">{label}</div>
    </div>
  )
}

function GroupCard({
  item,
  isExpanded,
  onToggleExpand,
  scoreMap,
  trainingActivityIds,
  toggleActivityCategory,
}: {
  item: MergedGroup
  isExpanded: boolean
  onToggleExpand: () => void
  scoreMap: Map<number, number>
  trainingActivityIds: number[]
  toggleActivityCategory: (id: number) => void
}) {
  return (
    <div className="bg-bg-secondary border border-accent/25 rounded-[var(--radius-md)] p-4 flex flex-col gap-3">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        className="flex items-center gap-2 text-left cursor-pointer bg-transparent border-none w-full"
      >
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          aria-hidden="true"
          className={`text-accent shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="font-semibold text-sm text-accent min-w-0 flex-1">{item.group.name}</span>
        <span className="text-[0.75rem] text-text-muted">{item.activities.length} activities</span>
      </button>

      <div className="grid grid-cols-3 gap-2 text-center">
        <CardStat label="Distance" value={`${formatDistance(metersToKm(item.distance))} km`} />
        <CardStat label="Time" value={formatDuration(item.movingTime)} />
        <CardStat label="Climb" value={`${formatElevation(item.elevation)} m`} />
      </div>

      {isExpanded && (
        <ul className="flex flex-col gap-2 list-none pl-3 border-l border-border-subtle">
          {item.activities.map((activity) => (
            <li key={activity.id}>
              <ActivityCard
                activity={activity}
                isTraining={trainingActivityIds.includes(activity.id)}
                toggleActivityCategory={toggleActivityCategory}
                scoreMap={scoreMap}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
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
  tdNumeric,
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
  tdNumeric: string
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
          {/* A button rather than a whole clickable row, so it can carry
              aria-expanded and be reached by keyboard. */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.group.name}`}
            className="flex items-center justify-center size-6 rounded-[var(--radius-sm)] cursor-pointer bg-transparent border-none text-accent hover:bg-bg-elevated transition-colors"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
              className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </td>
        <td className={tdClass}>
          <span className="text-text-muted text-xs">
            {formatDateFull(item.date)}
            {item.activities.length > 1 && item.date !== item.latestDate && (
              <> - {formatDateFull(item.latestDate)}</>
            )}
          </span>
        </td>
        <td className={`${tdClass} font-semibold max-w-0 overflow-hidden`}>
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
                className="bg-bg-tertiary border border-accent text-text-primary py-0.5 px-2 rounded-[var(--radius-sm)] text-sm w-full focus:outline-none"
              />
            ) : (
              <>
                <span className="bg-linear-to-r from-accent to-accent-light bg-clip-text text-transparent font-bold">
                  {item.group.name}
                </span>
                <span className="text-[0.75rem] text-text-muted bg-bg-tertiary py-0.5 px-1.5 rounded-[var(--radius-sm)]">
                  {item.activities.length}
                </span>
              </>
            )}
          </div>
        </td>
        <td className={tdClass}>
          <div className="flex flex-wrap gap-1">
            {types.map((t) => (
              <span key={t} className={`inline-block py-1 px-2 rounded-[var(--radius-sm)] text-[0.75rem] font-semibold uppercase tracking-wide ${activityTypeClasses[t.toLowerCase()] || 'bg-bg-tertiary text-text-secondary'}`}>
                {t === 'VirtualRide' ? 'Zwift' : t}
              </span>
            ))}
          </div>
        </td>
        <td className={`${tdNumeric} font-medium`}>{formatDistance(metersToKm(item.distance))} km</td>
        <td className={`${tdNumeric} font-medium`}>{formatDuration(item.movingTime)}</td>
        <td className={`${tdNumeric} font-medium ${SECONDARY_COLUMN}`}>{formatElevation(item.elevation)} m</td>
        <td className={`${tdNumeric} font-medium ${SECONDARY_COLUMN}`}>
          {item.avgWatts ? `${formatNumber(item.avgWatts)} W` : '–'}
        </td>
        <td className={`${tdNumeric} font-medium ${SECONDARY_COLUMN}`}>
          {item.avgHR ? `${formatNumber(item.avgHR)} bpm` : '–'}
        </td>
        <td className={`${tdClass} font-medium`}>
          {avgScore != null ? (() => {
            const label = getScoreLabel(avgScore)
            return (
              <span className={`inline-block py-1.5 px-3 rounded-[var(--radius-sm)] text-[0.75rem] font-semibold ${scoreLabelClasses[label]}`}>
                {avgScore} · {label}
              </span>
            )
          })() : '-'}
        </td>
        <td className={tdClass}>
          {groupMode ? (
            <div className="flex items-center gap-1">
              <button
                className="py-1 px-2 rounded-[var(--radius-sm)] text-[0.75rem] font-medium cursor-pointer bg-bg-tertiary border border-border text-text-muted hover:text-text-primary hover:border-text-muted transition-all duration-150"
                onClick={onStartRename}
                title="Rename group"
              >
                Rename
              </button>
              <button
                className="py-1 px-2 rounded-[var(--radius-sm)] text-[0.75rem] font-medium cursor-pointer bg-danger/10 border border-danger/20 text-danger hover:bg-danger/20 hover:border-danger/40 transition-all duration-150"
                onClick={onDelete}
                title="Ungroup activities"
              >
                Ungroup
              </button>
            </div>
          ) : (() => {
            const groupIsTraining = item.activities.length > 0 && trainingActivityIds.includes(item.activities[0].id)
            return (
              // Read-only: the group's category follows its members, so this is
              // a label and is styled as one — no border, no hover.
              <span className={`inline-block text-[0.75rem] font-semibold whitespace-nowrap ${
                groupIsTraining ? 'text-warning' : 'text-accent'
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
            tdNumeric={tdNumeric}
            scoreMap={scoreMap}
            indent
          />
        )
      })}
    </>
  )
}
