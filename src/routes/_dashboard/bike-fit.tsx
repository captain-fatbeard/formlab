import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

export const Route = createFileRoute('/_dashboard/bike-fit')({
  head: () => ({ meta: [{ title: 'Bike Fit · FormLab' }] }),
  component: BikeFitPage,
})

const VIDEO_URL = '/bike-position.mov'
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task'

interface Pt {
  x: number
  y: number
  visibility?: number
}

interface AngleReading {
  knee: number | null
  kneeMax: number | null
  hipFlex: number | null
  hipFlexMin: number | null
  back: number | null
  elbow: number | null
  shoulder: number | null
  side: 'L' | 'R' | null
}

interface Range {
  label: string
  min: number
  max: number
  hint: string
}

type RangeKey = 'knee' | 'hipFlex' | 'back' | 'elbow' | 'shoulder'

const RANGES: Record<RangeKey, Range> = {
  knee: { label: 'Knee at BDC', min: 140, max: 150, hint: 'fully extended leg, bottom of stroke' },
  hipFlex: { label: 'Hip flexion (top)', min: 45, max: 60, hint: 'spine–hip–knee at top stroke' },
  back: { label: 'Torso angle', min: 20, max: 35, hint: 'spine vs horizontal (endurance/performance)' },
  elbow: { label: 'Elbow', min: 150, max: 160, hint: 'slight bend over hoods, comfort + control' },
  shoulder: { label: 'Shoulder angle', min: 5, max: 25, hint: 'shoulder–elbow line vs horizontal' },
}

function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x
  const v1y = a.y - b.y
  const v2x = c.x - b.x
  const v2y = c.y - b.y
  const m1 = Math.hypot(v1x, v1y)
  const m2 = Math.hypot(v2x, v2y)
  if (m1 === 0 || m2 === 0) return 0
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (m1 * m2)))
  return (Math.acos(cos) * 180) / Math.PI
}

function backAngle(shoulder: Pt, hip: Pt): number {
  const dx = Math.abs(shoulder.x - hip.x)
  const dy = Math.abs(shoulder.y - hip.y)
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

function pickSide(lm: Pt[]): 'L' | 'R' {
  const visL =
    (lm[11].visibility ?? 0) +
    (lm[23].visibility ?? 0) +
    (lm[25].visibility ?? 0) +
    (lm[27].visibility ?? 0)
  const visR =
    (lm[12].visibility ?? 0) +
    (lm[24].visibility ?? 0) +
    (lm[26].visibility ?? 0) +
    (lm[28].visibility ?? 0)
  return visL >= visR ? 'L' : 'R'
}

function statusFor(value: number | null, range: Range): 'in' | 'low' | 'high' | 'unknown' {
  if (value === null) return 'unknown'
  if (value < range.min) return 'low'
  if (value > range.max) return 'high'
  return 'in'
}

interface SummaryItem {
  label: string
  verdict: string
  state: 'good' | 'warn' | 'unknown'
}

function buildSummary(a: AngleReading): SummaryItem[] {
  const items: SummaryItem[] = []
  const { knee: kRange, hipFlex: hRange, back: bRange, elbow: eRange } = RANGES

  if (a.kneeMax !== null) {
    const v = a.kneeMax
    if (v >= kRange.min && v <= kRange.max) {
      items.push({ label: 'Saddle height', verdict: `Optimal · ${v}° at BDC`, state: 'good' })
    } else if (v < kRange.min) {
      items.push({
        label: 'Saddle height',
        verdict: `Too low · knee max ${v}° (target ${kRange.min}–${kRange.max}°)`,
        state: 'warn',
      })
    } else {
      items.push({
        label: 'Saddle height',
        verdict: `Possibly too high · knee max ${v}°`,
        state: 'warn',
      })
    }
  }

  if (a.hipFlexMin !== null) {
    const v = a.hipFlexMin
    if (v >= hRange.min && v <= hRange.max) {
      items.push({ label: 'Hip angle', verdict: `Good · ${v}° at TDC (sustainable)`, state: 'good' })
    } else if (v < hRange.min) {
      items.push({
        label: 'Hip angle',
        verdict: `Aggressive · ${v}° (very closed at top stroke)`,
        state: 'warn',
      })
    } else {
      items.push({
        label: 'Hip angle',
        verdict: `Open · ${v}° (comfort over aero)`,
        state: 'warn',
      })
    }
  }

  if (a.back !== null) {
    const v = a.back
    if (v >= bRange.min && v <= bRange.max) {
      items.push({ label: 'Torso', verdict: `Endurance/performance · ${v}°`, state: 'good' })
    } else if (v < bRange.min) {
      items.push({ label: 'Torso', verdict: `Aggressive aero · ${v}°`, state: 'warn' })
    } else {
      items.push({ label: 'Torso', verdict: `Upright · ${v}°`, state: 'warn' })
    }
  }

  if (a.elbow !== null) {
    const v = a.elbow
    if (v >= eRange.min && v <= eRange.max) {
      items.push({ label: 'Arm position', verdict: `Slight bend · ${v}° (comfort + control)`, state: 'good' })
    } else if (v < eRange.min) {
      items.push({ label: 'Arm position', verdict: `Bent · ${v}° (good shock absorption)`, state: 'good' })
    } else {
      items.push({ label: 'Arm position', verdict: `Extended · ${v}° (locked-out arms)`, state: 'warn' })
    }
  }

  return items
}

function buildRecommendations(a: AngleReading): string[] {
  const recs: string[] = []
  const { knee: kRange, hipFlex: hRange, back: bRange, elbow: eRange } = RANGES

  if (a.kneeMax !== null) {
    if (a.kneeMax > kRange.max) recs.push(`Saddle ~5 mm too high — knee opening past ${kRange.max}° at BDC.`)
    else if (a.kneeMax < kRange.min) recs.push(`Saddle ~5 mm too low — knee staying under ${kRange.min}° at BDC.`)
  }

  if (a.elbow !== null && a.elbow > eRange.max) {
    recs.push('Maintain a slight bend in the elbows — locked-out arms transmit road shock and tire shoulders.')
  }

  if (a.hipFlexMin !== null && a.hipFlexMin < hRange.min) {
    recs.push('Hip is very closed at top stroke — focus on pelvic rotation (tilt hips forward) to lengthen the spine.')
  }

  if (a.back !== null && a.back < bRange.min) {
    recs.push('Torso is quite flat — sustainable for race use, but if upper-back fatigue persists try adding 5 mm of spacers under the stem.')
  } else if (a.back !== null && a.back > bRange.max) {
    recs.push('Torso is upright — could lower stem 5–10 mm if more aero efficiency is wanted.')
  }

  if (recs.length === 0) {
    recs.push('Position looks well within targets — keep current setup, focus on core strength to maintain it on long rides.')
  }

  return recs
}

const SUMMARY_BADGE: Record<SummaryItem['state'], string> = {
  good: 'bg-success-muted text-success',
  warn: 'bg-warning-muted text-warning',
  unknown: 'bg-bg-tertiary text-text-muted',
}

const STATUS_CLASS: Record<'in' | 'low' | 'high' | 'unknown', string> = {
  in: 'bg-success-muted text-success',
  low: 'bg-warning-muted text-warning',
  high: 'bg-warning-muted text-warning',
  unknown: 'bg-bg-tertiary text-text-muted',
}

interface JointOffset {
  dx: number
  dy: number
}
type Offsets = { sp: JointOffset; hp: JointOffset; an: JointOffset }
const ZERO_OFFSETS: Offsets = {
  sp: { dx: 0, dy: 0 },
  hp: { dx: 0, dy: 0 },
  an: { dx: 0, dy: 0 },
}

function BikeFitPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const landmarkerRef = useRef<unknown>(null)
  const rvfcHandleRef = useRef<number | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [paused, setPaused] = useState(true)
  const [offsets, setOffsets] = useState<Offsets>(ZERO_OFFSETS)
  const offsetsRef = useRef(offsets)
  useEffect(() => {
    offsetsRef.current = offsets
  }, [offsets])
  const [angles, setAngles] = useState<AngleReading>({
    knee: null,
    kneeMax: null,
    hipFlex: null,
    hipFlexMin: null,
    back: null,
    elbow: null,
    shoulder: null,
    side: null,
  })
  const extremesRef = useRef<{
    kneeMax: number | null
    kneeMaxTime: number | null
    hipFlexMin: number | null
    hipFlexMinTime: number | null
  }>({ kneeMax: null, kneeMaxTime: null, hipFlexMin: null, hipFlexMinTime: null })
  const baseRef = useRef<{ sp: Pt; hp: Pt; an: Pt } | null>(null)
  const [hasExtremes, setHasExtremes] = useState(false)
  const detectFnRef = useRef<(() => void) | null>(null)

  const resetExtremes = () => {
    extremesRef.current = {
      kneeMax: null,
      kneeMaxTime: null,
      hipFlexMin: null,
      hipFlexMinTime: null,
    }
    setHasExtremes(false)
    setAngles((a) => ({ ...a, kneeMax: null, hipFlexMin: null }))
  }
  const resetAdjustments = () => setOffsets(ZERO_OFFSETS)
  const hasAdjustments = Object.values(offsets).some((o) => o.dx !== 0 || o.dy !== 0)

  const jumpToTime = (t: number) => {
    const v = videoRef.current
    if (!v) return
    v.pause()
    v.currentTime = t
  }

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onPause = () => setPaused(true)
    const onPlay = () => setPaused(false)
    v.addEventListener('pause', onPause)
    v.addEventListener('play', onPlay)
    setPaused(v.paused)
    return () => {
      v.removeEventListener('pause', onPause)
      v.removeEventListener('play', onPlay)
    }
  }, [status])

  // Trigger a redraw when offsets change while paused — no rvfc fires otherwise.
  useEffect(() => {
    if (!videoRef.current?.paused) return
    detectFnRef.current?.()
  }, [offsets])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
        const vision = await FilesetResolver.forVisionTasks(WASM_URL)
        const pose = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
        if (cancelled) {
          pose.close()
          return
        }
        landmarkerRef.current = pose
        setStatus('ready')
      } catch (e) {
        console.error(e)
        setError(e instanceof Error ? e.message : 'Failed to load pose model')
        setStatus('error')
      }
    })()
    return () => {
      cancelled = true
      const video = videoRef.current
      if (video && rvfcHandleRef.current !== null && 'cancelVideoFrameCallback' in video) {
        ;(video as unknown as {
          cancelVideoFrameCallback: (h: number) => void
        }).cancelVideoFrameCallback(rvfcHandleRef.current)
      }
      const lm = landmarkerRef.current as { close?: () => void } | null
      lm?.close?.()
      landmarkerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (status !== 'ready') return
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let cancelled = false
    let smoothed: Pt[] | null = null
    const SMOOTH_ALPHA = 0.28
    // 3-frame median rejects single-frame detection spikes while preserving
    // genuine BDC/TDC peaks (which span 3+ frames at 30fps).
    const kneeBuf: { v: number; t: number }[] = []
    const hipBuf: { v: number; t: number }[] = []
    const median3 = (buf: { v: number; t: number }[]) =>
      [...buf].sort((a, b) => a.v - b.v)[1]

    const onLoaded = () => {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
    }
    video.addEventListener('loadedmetadata', onLoaded)
    if (video.readyState >= 1) onLoaded()

    const detectAndDraw = (ts: number) => {
      const lm = landmarkerRef.current as
        | { detectForVideo: (v: HTMLVideoElement, t: number) => { landmarks: Pt[][] } }
        | null
      if (!lm) return
      let result: { landmarks: Pt[][] }
      try {
        result = lm.detectForVideo(video, ts)
      } catch {
        return
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const raw = result.landmarks?.[0]
      if (!raw || raw.length < 33) {
        setAngles((a) => ({
          ...a,
          knee: null,
          hipFlex: null,
          back: null,
          elbow: null,
          shoulder: null,
          side: null,
        }))
        return
      }
      const points: Pt[] =
        smoothed && smoothed.length === raw.length
          ? raw.map((p, i) => ({
              x: SMOOTH_ALPHA * p.x + (1 - SMOOTH_ALPHA) * smoothed![i].x,
              y: SMOOTH_ALPHA * p.y + (1 - SMOOTH_ALPHA) * smoothed![i].y,
              visibility: p.visibility,
            }))
          : raw
      smoothed = points
      const side = pickSide(points)
      const idx =
        side === 'L'
          ? { ear: 7, sh: 11, el: 13, wr: 15, hp: 23, kn: 25, an: 27 }
          : { ear: 8, sh: 12, el: 14, wr: 16, hp: 24, kn: 26, an: 28 }

      const ear = points[idx.ear]
      const sh = points[idx.sh]
      const el = points[idx.el]
      const wr = points[idx.wr]
      const hpBase = points[idx.hp]
      const kn = points[idx.kn]
      const anBase = points[idx.an]
      const spineBase: Pt = { x: (ear.x + sh.x) / 2, y: (ear.y + sh.y) / 2 }

      const off = offsetsRef.current
      const spineTop: Pt = { x: spineBase.x + off.sp.dx, y: spineBase.y + off.sp.dy }
      const hp: Pt = { x: hpBase.x + off.hp.dx, y: hpBase.y + off.hp.dy, visibility: hpBase.visibility }
      const an: Pt = { x: anBase.x + off.an.dx, y: anBase.y + off.an.dy, visibility: anBase.visibility }

      baseRef.current = { sp: spineBase, hp: hpBase, an: anBase }

      const knee = angleAt(hp, kn, an)
      const hipFlex = angleAt(spineTop, hp, kn)
      const back = backAngle(spineTop, hp)
      const elbow = angleAt(sh, el, wr)
      const shoulder = backAngle(sh, el)

      // Raw (un-smoothed) angles for peak tracking, with offsets still applied
      const rawHpBase = raw[idx.hp]
      const rawKn = raw[idx.kn]
      const rawAnBase = raw[idx.an]
      const rawEar = raw[idx.ear]
      const rawSh = raw[idx.sh]
      const rawHp: Pt = { x: rawHpBase.x + off.hp.dx, y: rawHpBase.y + off.hp.dy }
      const rawAn: Pt = { x: rawAnBase.x + off.an.dx, y: rawAnBase.y + off.an.dy }
      const rawSpineBase: Pt = { x: (rawEar.x + rawSh.x) / 2, y: (rawEar.y + rawSh.y) / 2 }
      const rawSpineTop: Pt = { x: rawSpineBase.x + off.sp.dx, y: rawSpineBase.y + off.sp.dy }
      const kneeRaw = angleAt(rawHp, rawKn, rawAn)
      const hipFlexRaw = angleAt(rawSpineTop, rawHp, rawKn)

      const ext = extremesRef.current
      const t = video.currentTime

      kneeBuf.push({ v: kneeRaw, t })
      if (kneeBuf.length > 3) kneeBuf.shift()
      hipBuf.push({ v: hipFlexRaw, t })
      if (hipBuf.length > 3) hipBuf.shift()

      let extremesChanged = false
      if (kneeBuf.length === 3) {
        const m = median3(kneeBuf)
        if (ext.kneeMax === null || m.v > ext.kneeMax) {
          ext.kneeMax = m.v
          ext.kneeMaxTime = m.t
          extremesChanged = true
        }
      }
      if (hipBuf.length === 3) {
        const m = median3(hipBuf)
        if (ext.hipFlexMin === null || m.v < ext.hipFlexMin) {
          ext.hipFlexMin = m.v
          ext.hipFlexMinTime = m.t
          extremesChanged = true
        }
      }
      if (extremesChanged) setHasExtremes(true)

      setAngles({
        knee: Math.round(knee),
        kneeMax: ext.kneeMax !== null ? Math.round(ext.kneeMax) : null,
        hipFlex: Math.round(hipFlex),
        hipFlexMin: ext.hipFlexMin !== null ? Math.round(ext.hipFlexMin) : null,
        back: Math.round(back),
        elbow: Math.round(elbow),
        shoulder: Math.round(shoulder),
        side,
      })

      drawSkeleton(
        ctx,
        canvas.width,
        canvas.height,
        { spineTop, sh, el, wr, hp, kn, an },
        { knee, hipFlex, back, elbow, shoulder },
      )
    }

    detectFnRef.current = () => detectAndDraw(performance.now())

    type RvfcVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (n: number) => void) => number
      cancelVideoFrameCallback?: (h: number) => void
    }
    const v = video as RvfcVideo
    const useRvfc = typeof v.requestVideoFrameCallback === 'function'

    const tick = () => {
      if (cancelled) return
      detectAndDraw(performance.now())
      if (useRvfc) {
        rvfcHandleRef.current = v.requestVideoFrameCallback!(tick)
      } else if (!video.paused && !video.ended) {
        rvfcHandleRef.current = requestAnimationFrame(tick)
      }
    }

    const onPlay = () => {
      if (!useRvfc) rvfcHandleRef.current = requestAnimationFrame(tick)
    }
    const onSeeking = () => {
      smoothed = null
      kneeBuf.length = 0
      hipBuf.length = 0
    }
    const onSeeked = () => {
      smoothed = null
      kneeBuf.length = 0
      hipBuf.length = 0
      detectAndDraw(performance.now())
    }
    video.addEventListener('seeking', onSeeking)
    video.addEventListener('seeked', onSeeked)

    if (useRvfc) {
      rvfcHandleRef.current = v.requestVideoFrameCallback!(tick)
    } else {
      video.addEventListener('play', onPlay)
      detectAndDraw(performance.now())
    }

    return () => {
      cancelled = true
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('seeking', onSeeking)
      video.removeEventListener('seeked', onSeeked)
      if (rvfcHandleRef.current !== null) {
        if (useRvfc && v.cancelVideoFrameCallback) {
          v.cancelVideoFrameCallback(rvfcHandleRef.current)
        } else {
          cancelAnimationFrame(rvfcHandleRef.current)
        }
        rvfcHandleRef.current = null
      }
    }
  }, [status])

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[1.5rem] font-semibold text-text-primary">Bike Fit</h1>
        <p className="text-sm text-text-muted">
          Live pose detection on your trainer position video. Lines and angles overlay every frame —
          play or scrub to inspect joint angles through the pedal stroke.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="bg-bg-secondary border border-border-subtle rounded-lg p-3 flex flex-col gap-3">
          <div className="bg-black rounded-md overflow-hidden flex justify-center">
            <div ref={stageRef} className="relative">
              <video
                ref={videoRef}
                src={VIDEO_URL}
                controls
                playsInline
                muted
                className="block max-h-[75vh] max-w-full w-auto h-auto"
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
              {paused && status === 'ready' && baseRef.current && (
                <>
                  <DragHandle
                    label="Back anchor"
                    color="#22d3ee"
                    base={baseRef.current.sp}
                    offset={offsets.sp}
                    stageRef={stageRef}
                    onChange={(o) => setOffsets((s) => ({ ...s, sp: o }))}
                  />
                  <DragHandle
                    label="Hip"
                    color="#fb923c"
                    base={baseRef.current.hp}
                    offset={offsets.hp}
                    stageRef={stageRef}
                    onChange={(o) => setOffsets((s) => ({ ...s, hp: o }))}
                  />
                  <DragHandle
                    label="Ankle"
                    color="#fafafa"
                    base={baseRef.current.an}
                    offset={offsets.an}
                    stageRef={stageRef}
                    onChange={(o) => setOffsets((s) => ({ ...s, an: o }))}
                  />
                </>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>
              {status === 'loading' && 'Loading pose model…'}
              {status === 'ready' && angles.side && `Tracking ${angles.side === 'L' ? 'left' : 'right'} side`}
              {status === 'ready' && !angles.side && 'Pose model ready — play the video'}
              {status === 'error' && (
                <span className="text-danger">{error ?? 'Failed to load model'}</span>
              )}
            </span>
            <div className="flex items-center gap-3">
              {hasAdjustments && (
                <button
                  type="button"
                  onClick={resetAdjustments}
                  className="text-warning hover:text-warning/80 transition-colors"
                >
                  Reset adjustments
                </button>
              )}
              <span className="text-text-muted/70">MediaPipe Pose Landmarker (heavy)</span>
            </div>
          </div>
          {paused && status === 'ready' && (
            <p className="text-[0.7rem] text-text-muted/80 leading-relaxed">
              Tip: pause and drag the cyan (back), orange (hip) or white (ankle) handle to nudge a
              misplaced joint. Adjustments persist as you scrub/play.
            </p>
          )}
        </div>

        <aside className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs text-text-muted px-1">
            <span>Knee/hip use captured extremes (BDC/TDC).</span>
            <button
              type="button"
              onClick={resetExtremes}
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              Reset
            </button>
          </div>

          {(Object.keys(RANGES) as Array<keyof typeof RANGES>).map((key) => {
            const range = RANGES[key]
            const headline =
              key === 'knee'
                ? angles.kneeMax
                : key === 'hipFlex'
                  ? angles.hipFlexMin
                  : angles[key]
            const live = key === 'knee' ? angles.knee : key === 'hipFlex' ? angles.hipFlex : null
            const st = statusFor(headline, range)
            const extremeLabel = key === 'knee' ? 'max captured' : key === 'hipFlex' ? 'min captured' : null
            return (
              <div
                key={key}
                className="bg-bg-secondary border border-border-subtle rounded-lg p-4 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-secondary">{range.label}</span>
                  <span className={`text-[0.7rem] px-2 py-0.5 rounded font-medium ${STATUS_CLASS[st]}`}>
                    {st === 'in' ? 'in range' : st === 'low' ? 'below' : st === 'high' ? 'above' : '—'}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[1.75rem] font-semibold text-text-primary tabular-nums leading-none">
                    {headline !== null ? `${headline}°` : '—'}
                  </span>
                  <span className="text-xs text-text-muted">
                    target {range.min}–{range.max}°
                  </span>
                  {extremeLabel && (
                    <span className="text-[0.65rem] text-text-muted/70 ml-auto">{extremeLabel}</span>
                  )}
                </div>
                {live !== null && (
                  <span className="text-[0.7rem] text-text-muted tabular-nums">
                    live {live}°
                  </span>
                )}
                <span className="text-[0.7rem] text-text-muted/80 leading-relaxed">{range.hint}</span>
                {key === 'knee' && hasExtremes && extremesRef.current.kneeMaxTime !== null && (
                  <button
                    type="button"
                    onClick={() => jumpToTime(extremesRef.current.kneeMaxTime!)}
                    className="self-start text-[0.7rem] text-accent hover:text-accent-light transition-colors mt-0.5"
                  >
                    → Jump to BDC frame
                  </button>
                )}
                {key === 'hipFlex' && hasExtremes && extremesRef.current.hipFlexMinTime !== null && (
                  <button
                    type="button"
                    onClick={() => jumpToTime(extremesRef.current.hipFlexMinTime!)}
                    className="self-start text-[0.7rem] text-accent hover:text-accent-light transition-colors mt-0.5"
                  >
                    → Jump to TDC frame
                  </button>
                )}
              </div>
            )
          })}

          <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-3 text-[0.7rem] text-text-muted leading-relaxed">
            Knee tracks max (= BDC, leg most extended). Hip flexion tracks min (= TDC, hip most closed).
            Reset to clear and re-capture. Hip joint is hidden under shorts so the spine→hip estimate carries
            the most error.
          </div>
        </aside>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="bg-bg-secondary border border-border-subtle rounded-lg p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
            Position summary
          </h2>
          {(() => {
            const items = buildSummary(angles)
            if (items.length === 0) {
              return (
                <p className="text-sm text-text-muted">Play the video to capture extremes, then come back.</p>
              )
            }
            return (
              <ul className="flex flex-col gap-2">
                {items.map((it) => (
                  <li key={it.label} className="flex items-start gap-3">
                    <span
                      className={`text-[0.65rem] px-2 py-0.5 rounded font-medium shrink-0 ${SUMMARY_BADGE[it.state]}`}
                    >
                      {it.state === 'good' ? 'good' : it.state === 'warn' ? 'check' : '—'}
                    </span>
                    <div className="flex-1">
                      <span className="text-sm font-medium text-text-primary">{it.label}</span>
                      <span className="text-sm text-text-muted"> · {it.verdict}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          })()}
        </section>

        <section className="bg-bg-secondary border border-border-subtle rounded-lg p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
            Recommendations
          </h2>
          {(() => {
            const recs = buildRecommendations(angles)
            return (
              <ol className="flex flex-col gap-2 list-decimal list-inside">
                {recs.map((r, i) => (
                  <li key={i} className="text-sm text-text-secondary leading-relaxed marker:text-text-muted">
                    {r}
                  </li>
                ))}
              </ol>
            )
          })()}
          <p className="text-[0.7rem] text-text-muted/80 mt-1 leading-relaxed">
            Generated from the captured angles + reference ranges. Use as a starting point and validate
            on the road; comfort beats spec.
          </p>
        </section>
      </div>
    </div>
  )
}

const COLOR = {
  torso: '#fbbf24',    // yellow
  arm: '#60a5fa',      // blue
  leg: '#4ade80',      // green
  hip: '#fb923c',      // orange
  shoulder: '#a78bfa', // purple
  joint: '#fafafa',    // off-white
}

interface Pt2 {
  x: number
  y: number
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  vertex: Pt2,
  p1: Pt2,
  p2: Pt2,
  radius: number,
  color: string,
  lineWidth: number,
) {
  const a1 = Math.atan2(p1.y - vertex.y, p1.x - vertex.x)
  const a2 = Math.atan2(p2.y - vertex.y, p2.x - vertex.x)
  let delta = a2 - a1
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.arc(vertex.x, vertex.y, radius, a1, a2, delta < 0)
  ctx.stroke()
}

function drawArcVsHorizontal(
  ctx: CanvasRenderingContext2D,
  vertex: Pt2,
  other: Pt2,
  radius: number,
  color: string,
  lineWidth: number,
) {
  const horizAngle = other.x >= vertex.x ? 0 : Math.PI
  const segAngle = Math.atan2(other.y - vertex.y, other.x - vertex.x)
  let delta = segAngle - horizAngle
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.arc(vertex.x, vertex.y, radius, horizAngle, segAngle, delta < 0)
  ctx.stroke()
}

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pts: { spineTop: Pt; sh: Pt; el: Pt; wr: Pt; hp: Pt; kn: Pt; an: Pt },
  vals: { knee: number; hipFlex: number; back: number; elbow: number; shoulder: number },
) {
  const px = (p: Pt) => ({ x: p.x * w, y: p.y * h })
  const sp = px(pts.spineTop)
  const sh = px(pts.sh)
  const el = px(pts.el)
  const wr = px(pts.wr)
  const hp = px(pts.hp)
  const kn = px(pts.kn)
  const an = px(pts.an)

  // Scale primitives proportional to canvas size so the overlay reads at any resolution.
  const s = Math.max(w, h) / 568
  const segLw = 2.5 * s
  const arcLw = 1.75 * s
  const dotR = 3.5 * s
  const anchorR = 4 * s
  const fontPx = Math.round(12 * s)
  const padX = 5 * s
  const padY = 9 * s

  ctx.lineWidth = segLw
  ctx.lineCap = 'round'
  ctx.setLineDash([])

  const line = (a: Pt2, b: Pt2) => {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  ctx.strokeStyle = COLOR.torso
  line(sp, hp)
  ctx.strokeStyle = COLOR.arm
  line(sp, el)
  line(el, wr)
  ctx.strokeStyle = COLOR.leg
  line(hp, kn)
  line(kn, an)

  drawArc(ctx, kn, hp, an, 18 * s, COLOR.leg, arcLw)
  drawArc(ctx, hp, sp, kn, 16 * s, COLOR.hip, arcLw)
  drawArc(ctx, el, sp, wr, 14 * s, COLOR.arm, arcLw)
  drawArcVsHorizontal(ctx, hp, sp, 22 * s, COLOR.torso, arcLw)
  drawArcVsHorizontal(ctx, sh, el, 14 * s, COLOR.shoulder, arcLw)

  ctx.fillStyle = COLOR.joint
  for (const p of [el, wr, kn, an]) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = COLOR.torso
  ctx.beginPath()
  ctx.arc(sp.x, sp.y, anchorR, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = COLOR.hip
  ctx.beginPath()
  ctx.arc(hp.x, hp.y, anchorR, 0, Math.PI * 2)
  ctx.fill()

  ctx.font = `600 ${fontPx}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  const label = (p: Pt2, dx: number, dy: number, text: string, color: string) => {
    const x = p.x + dx * s
    const y = p.y + dy * s
    const tw = ctx.measureText(text).width
    const boxW = tw + padX * 2
    const boxH = padY * 2
    ctx.fillStyle = 'rgba(8,13,13,0.9)'
    ctx.fillRect(x - boxW / 2, y - boxH / 2, boxW, boxH)
    ctx.strokeStyle = color
    ctx.lineWidth = 1 * s
    ctx.strokeRect(x - boxW / 2, y - boxH / 2, boxW, boxH)
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(text, x, y)
  }

  label(kn, 30, 0, `${Math.round(vals.knee)}°`, COLOR.leg)
  label(hp, -28, -10, `${Math.round(vals.hipFlex)}°`, COLOR.hip)
  label(el, 0, -16, `${Math.round(vals.elbow)}°`, COLOR.arm)
  const torsoMid = { x: (sp.x + hp.x) / 2, y: (sp.y + hp.y) / 2 }
  label(torsoMid, 30, -2, `${Math.round(vals.back)}°`, COLOR.torso)
  label(sh, 0, -22, `${Math.round(vals.shoulder)}°`, COLOR.shoulder)
}

interface DragHandleProps {
  label: string
  color: string
  base: Pt
  offset: JointOffset
  stageRef: React.RefObject<HTMLDivElement | null>
  onChange: (next: JointOffset) => void
}

function DragHandle({ label, color, base, offset, stageRef, onChange }: DragHandleProps) {
  const xPct = (base.x + offset.dx) * 100
  const yPct = (base.y + offset.dy) * 100

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const startX = e.clientX
    const startY = e.clientY
    const startOffset = { ...offset }
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)

    const onMove = (ev: PointerEvent) => {
      const dxNorm = (ev.clientX - startX) / rect.width
      const dyNorm = (ev.clientY - startY) / rect.height
      onChange({ dx: startOffset.dx + dxNorm, dy: startOffset.dy + dyNorm })
    }
    const onUp = () => {
      target.releasePointerCapture(e.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      onPointerDown={onPointerDown}
      title={`Drag to adjust ${label.toLowerCase()}`}
      style={{ left: `${xPct}%`, top: `${yPct}%`, backgroundColor: color, zIndex: 20 }}
      className="absolute -translate-x-1/2 -translate-y-1/2 size-7 rounded-full ring-2 ring-white/60 cursor-move pointer-events-auto shadow-[0_2px_8px_rgba(0,0,0,0.6)] touch-none"
    />
  )
}
