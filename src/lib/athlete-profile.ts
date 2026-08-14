import { type StravaActivity } from './strava'
import { estimateFTP, estimateFTPHistory, type FtpHistoryEntry } from './performance'
import { deriveThresholds, isRide, type TssThresholds, type ThresholdSources } from './tss'

/** Everything derived about the athlete rather than about a view of their data:
 * FTP, its history, and the thresholds every training-load number depends on. */
export interface AthleteProfile {
  ftp: number
  wattsPerKilo: number
  ftpHistory: FtpHistoryEntry[]
  thresholds: TssThresholds
  sources: ThresholdSources
}

export interface AthleteSettings {
  weight: number
  maxHR: number
  restingHR: number
}

/**
 * Derive the athlete's thresholds from their **complete** activity history.
 *
 * The `activities` argument must never be a filtered view. FTP feeds
 * `deriveThresholds`, which feeds every TSS, CTL and ATL in the app — so
 * narrowing the input to what a page happens to be displaying makes training
 * load depend on the time-range and activity-type dropdowns. A 30-day range
 * containing no long power ride drops FTP to 0 and silently re-scores every
 * ride in the app as hrTSS; selecting "Cycling" removes the runs
 * `runningThresholdPace` is derived from and costs every run its rTSS.
 *
 * Display filters belong downstream of this function, never upstream.
 */
export function deriveAthleteProfile(
  activities: StravaActivity[],
  { weight, maxHR, restingHR }: AthleteSettings
): AthleteProfile {
  const ftp = estimateFTP(activities.filter(isRide)) || 0
  const { thresholds, sources } = deriveThresholds(activities, { ftp, maxHR, restingHR })

  return {
    ftp,
    wattsPerKilo: ftp > 0 && weight > 0 ? ftp / weight : 0,
    ftpHistory: estimateFTPHistory(activities),
    thresholds,
    sources,
  }
}
