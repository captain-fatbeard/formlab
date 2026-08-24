// Human-readable names for the global filters. Used by the top-bar filter pills
// and by every page's scope line, so the two can never disagree.

import type { TimeRange, ActivityType } from './storage/supabase-client'

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6m': 'Last 6 months',
  '1y': 'Last year',
  all: 'All time',
}

/** The short form for the top-bar pill, where space is tight. */
export const TIME_RANGE_SHORT: Record<TimeRange, string> = {
  '30d': '30 days',
  '90d': '90 days',
  '6m': '6 months',
  '1y': '1 year',
  all: 'All time',
}

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  all: 'All activities',
  Ride: 'Cycling (incl. Zwift)',
  Run: 'Running',
  VirtualRide: 'Zwift only',
}

export const ACTIVITY_TYPE_SHORT: Record<ActivityType, string> = {
  all: 'All sports',
  Ride: 'Cycling',
  Run: 'Running',
  VirtualRide: 'Zwift',
}
