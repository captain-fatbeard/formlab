import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_dashboard/docs')({
  component: DocsPage,
})

type Tone = 'external' | 'server' | 'client' | 'store' | 'output'

const toneStyles: Record<Tone, { fill: string; stroke: string; title: string }> = {
  external: { fill: 'rgba(96, 165, 250, 0.08)', stroke: 'rgba(96, 165, 250, 0.35)', title: 'var(--color-info)' },
  server: { fill: 'rgba(167, 139, 250, 0.08)', stroke: 'rgba(167, 139, 250, 0.35)', title: 'var(--color-moderate)' },
  client: { fill: 'rgba(20, 184, 166, 0.08)', stroke: 'rgba(20, 184, 166, 0.4)', title: 'var(--color-accent)' },
  store: { fill: 'rgba(52, 211, 153, 0.07)', stroke: 'rgba(52, 211, 153, 0.3)', title: 'var(--color-success)' },
  output: { fill: 'rgba(251, 191, 36, 0.07)', stroke: 'rgba(251, 191, 36, 0.3)', title: 'var(--color-warning)' },
}

interface FlowBoxProps {
  x: number
  y: number
  w: number
  h: number
  tone: Tone
  eyebrow?: string
  title: string
  lines?: string[]
}

function FlowBox({ x, y, w, h, tone, eyebrow, title, lines = [] }: FlowBoxProps) {
  const style = toneStyles[tone]
  const titleY = eyebrow ? y + 46 : y + 32

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="12" fill={style.fill} stroke={style.stroke} />
      {eyebrow && (
        <text
          x={x + 18}
          y={y + 26}
          fontSize="10"
          letterSpacing="1.2"
          fill="var(--color-text-muted)"
          fontWeight="600"
        >
          {eyebrow.toUpperCase()}
        </text>
      )}
      <text x={x + 18} y={titleY} fontSize="15" fill={style.title} fontWeight="600">
        {title}
      </text>
      {lines.map((line, i) => (
        <text
          key={line}
          x={x + 18}
          y={titleY + 24 + i * 20}
          fontSize="11.5"
          fill="var(--color-text-secondary)"
        >
          {line}
        </text>
      ))}
    </g>
  )
}

function ArrowLabel({ x, y, text, anchor = 'middle' }: { x: number; y: number; text: string; anchor?: 'middle' | 'start' }) {
  return (
    <text x={x} y={y} fontSize="10.5" fill="var(--color-text-muted)" textAnchor={anchor}>
      {text}
    </text>
  )
}

function DataFlowDiagram() {
  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <svg
        viewBox="0 0 1040 880"
        className="w-full min-w-[760px] h-auto"
        role="img"
        aria-label="FormLab data flow: intervals.icu to server functions to the browser orchestrator, Supabase cache, derived metrics and pages"
      >
        <defs>
          <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-border)" />
          </marker>
        </defs>

        <g stroke="var(--color-border)" strokeWidth="1.5" markerEnd="url(#flow-arrow)" fill="none">
          <line x1="270" y1="106" x2="270" y2="166" />
          <line x1="270" y1="310" x2="270" y2="366" />
          <line x1="270" y1="520" x2="270" y2="576" />
          <line x1="270" y1="680" x2="270" y2="736" />
          <line x1="598" y1="410" x2="506" y2="410" />
          <line x1="598" y1="750" x2="506" y2="750" />
          <line x1="800" y1="798" x2="800" y2="764" />
        </g>
        {/* Orchestrator ⇄ Supabase: reads the cache on boot, writes fresh rows back */}
        <line
          x1="502"
          y1="500"
          x2="598"
          y2="500"
          stroke="var(--color-border)"
          strokeWidth="1.5"
          markerStart="url(#flow-arrow)"
          markerEnd="url(#flow-arrow)"
        />

        <ArrowLabel x={282} y={142} text="REST + streams" anchor="start" />
        <ArrowLabel x={282} y={346} text="StravaActivity[] · ActivityDetailsJson" anchor="start" />
        <ArrowLabel x={282} y={556} text="merged in-memory set" anchor="start" />
        <ArrowLabel x={282} y={716} text="context values" anchor="start" />
        <ArrowLabel x={552} y={400} text="passphrase" />
        <ArrowLabel x={550} y={490} text="read / upsert" />
        <ArrowLabel x={552} y={740} text="direct reads" />
        <ArrowLabel x={814} y={786} text="daily ping" anchor="start" />

        <FlowBox
          x={40}
          y={30}
          w={460}
          h={76}
          tone="external"
          eyebrow="source"
          title="intervals.icu API"
          lines={['/athlete/0/activities · /activity/{id} · /streams']}
        />
        <FlowBox
          x={40}
          y={170}
          w={460}
          h={140}
          tone="server"
          eyebrow="server (vercel function)"
          title="server-functions.ts"
          lines={[
            'verifyPassphrase · fetchIntervalsActivities',
            'fetchIntervalsActivityDetails',
            'API key + passphrase never reach the browser',
          ]}
        />
        <FlowBox
          x={40}
          y={370}
          w={460}
          h={150}
          tone="client"
          eyebrow="browser"
          title="_dashboard.tsx — sync orchestrator"
          lines={[
            'dedupe vs cache · merge by id',
            'patch estimated watts · backfill details',
            'holds the single activity set for all pages',
          ]}
        />
        <FlowBox
          x={40}
          y={580}
          w={460}
          h={100}
          tone="client"
          eyebrow="derived"
          title="performance.ts · tss.ts · intervals.ts"
          lines={['FTP, TSS, HR zones, VO2max, scores → DashboardContext']}
        />
        <FlowBox
          x={40}
          y={740}
          w={460}
          h={100}
          tone="output"
          eyebrow="ui"
          title="Dashboard pages"
          lines={['Plan · Training · Health · Performance', 'Records · Activities · Bike Fit']}
        />

        <FlowBox
          x={600}
          y={370}
          w={400}
          h={80}
          tone="store"
          title="localStorage"
          lines={['formlab:auth:passphrase · strava:auth:athlete']}
        />
        <FlowBox
          x={600}
          y={490}
          w={400}
          h={270}
          tone="store"
          eyebrow="cache + state"
          title="Supabase (Postgres)"
          lines={[
            'activities — summary + details_json',
            'user_settings · weight_entries · ftp_entries',
            'excluded_activities (training-only flag)',
            'activity_groups',
            'plan_week_history · plan_day_overrides',
            'keepalive',
            'every row scoped by athlete_id',
          ]}
        />
        <FlowBox
          x={600}
          y={800}
          w={400}
          h={60}
          tone="server"
          title="Vercel cron 03:00 → /api/keepalive"
        />
      </svg>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-bg-secondary border border-border-subtle rounded-[var(--radius-lg)] p-7 max-md:p-4 max-[480px]:p-3.5">
      <h2 className="text-lg font-semibold text-text-primary mb-4">{title}</h2>
      {children}
    </section>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[0.8em] text-accent-light bg-bg-tertiary border border-border-subtle rounded px-1.5 py-0.5">
      {children}
    </code>
  )
}

interface Step {
  title: string
  body: React.ReactNode
}

const syncSteps: Step[] = [
  {
    title: 'Login exchanges a passphrase for an athlete',
    body: (
      <>
        <Code>verifyPassphrase</Code> checks the submitted passphrase against{' '}
        <Code>APP_PASSPHRASE</Code>, then loads the intervals.icu profile server-side and returns an
        athlete keyed by <Code>APP_ATHLETE_ID</Code> — the original Strava athlete id, so all pre-existing
        rows stay attached. Passphrase and athlete are stored in localStorage; nothing else is client-side auth.
      </>
    ),
  },
  {
    title: 'Cached activities render first',
    body: (
      <>
        On mount the layout reads <Code>user_settings</Code>, <Code>excluded_activities</Code>,{' '}
        <Code>activities</Code> and <Code>activity_groups</Code> from Supabase in parallel. If the cache
        read succeeds the UI paints immediately — the network sync happens behind it.
      </>
    ),
  },
  {
    title: 'Background sync pulls the last 90 days',
    body: (
      <>
        <Code>fetchIntervalsActivities</Code> runs server-side with the API key, maps each intervals.icu
        activity into the app&apos;s <Code>StravaActivity</Code> shape and returns it. &ldquo;Sync All
        Activities&rdquo; in Settings does the same with no date cutoff.
      </>
    ),
  },
  {
    title: 'Fetched activities are deduped, then merged',
    body: (
      <>
        <Code>reconcile</Code> makes the whole merge in one decision: fetched copies of activities that
        already exist under a Strava id are dropped, the rest merge into the set by id, and only genuinely
        new rows get upserted. Locally-enriched fields (estimated watts) are re-applied so a sync never
        wipes them. It takes a <Code>KnownActivities</Code>, which only a successful cache read can
        produce — so a failed read can't be mistaken for an empty cache.
      </>
    ),
  },
  {
    title: 'Details backfill fills in the heavy data',
    body: (
      <>
        <Code>fetchActivityIdsWithoutDetails</Code> lists activities with no <Code>details_json</Code>;
        each is fetched with its streams, converted to splits / route polyline / power curve, and cached.
        Rides without a power meter get physics-estimated watts patched onto the summary row. Requests are
        spaced ~300ms to stay inside the 2500 req / 15 min limit.
      </>
    ),
  },
  {
    title: 'Everything downstream is derived, not stored',
    body: (
      <>
        FTP, TSS, thresholds, HR zones, VO2max and activity scores are recomputed from the merged set on
        every render pass and handed to pages through <Code>DashboardContext</Code>. Only raw activity
        data and explicit user input live in the database.
      </>
    ),
  },
]

const tables: { name: string; purpose: string; written: string }[] = [
  { name: 'activities', purpose: 'Cached activity summaries plus details_json (splits, laps, route, power curve)', written: 'Sync + details backfill' },
  { name: 'user_settings', purpose: 'Time range, activity type, birthday, gender, max/resting HR overrides', written: 'Settings panel (debounced 500ms)' },
  { name: 'weight_entries', purpose: 'Weight history — feeds w/kg, VO2max, BMR/TDEE and calorie estimates', written: 'Health page' },
  { name: 'ftp_entries', purpose: 'Manually logged FTP tests', written: 'Performance page' },
  { name: 'excluded_activities', purpose: 'Activities flagged training-only, excluded from stats', written: 'Activity list toggle' },
  { name: 'activity_groups', purpose: 'Several activities merged into one synthetic activity', written: 'Activity list' },
  { name: 'plan_week_history', purpose: 'Per-week phase (build / recovery / paused)', written: 'Plan page' },
  { name: 'plan_day_overrides', purpose: 'Per-day session overrides on the plan', written: 'Plan page' },
  { name: 'keepalive', purpose: 'Single row stamped daily so the free-tier project is never auto-paused', written: 'Vercel cron' },
]

const pageSources: { page: string; source: string }[] = [
  { page: 'Overview', source: 'Context only — lifetime stats and filtered stats' },
  { page: 'Plan', source: 'Context + plan_week_history / plan_day_overrides' },
  { page: 'Training', source: 'Context — TSS, fitness/fatigue/form curves' },
  { page: 'Health', source: 'Context + weight_entries, HR and fat-burning insights' },
  { page: 'Performance', source: 'Context + ftp_entries — power curves, zones, efficiency' },
  { page: 'Records', source: 'Reads segments, best efforts and power curves straight out of details_json' },
  { page: 'Activities', source: 'Context list; the detail page fetches or caches details_json per activity' },
  { page: 'Bike Fit', source: 'No app data — MediaPipe pose landmarks on a local video' },
]

const invariants: { title: string; body: React.ReactNode }[] = [
  {
    title: 'A failed cache read blocks writes',
    body: (
      <>
        <Code>fetchCachedActivities</Code> returns <Code>null</Code> when the query fails (as opposed to{' '}
        <Code>[]</Code> for an empty cache). Sync stays read-only until a read has succeeded — deduping
        against a partial view of the cache would permanently duplicate every activity.
      </>
    ),
  },
  {
    title: 'intervals.icu ids are offset by 1e12',
    body: (
      <>
        Activity <Code>i164403937</Code> is stored as <Code>1000164403937</Code>, keeping it clear of the
        Strava id range so both eras coexist in one table. <Code>isIntervalsActivityId</Code> decides what
        can still be re-fetched; Strava-era activities only have whatever was cached before API access ended.
      </>
    ),
  },
  {
    title: 'Duplicates self-heal on boot',
    body: (
      <>
        The same <Code>reconcile</Code> call with nothing fetched spots intervals.icu copies of Strava-era
        activities in the cache, removes them from the working set and reports them as
        <Code>toDelete</Code> for removal from Supabase.
      </>
    ),
  },
  {
    title: 'Sync failure never logs you out',
    body: 'If intervals.icu is unreachable the cached data stays on screen; an error is only surfaced when there was no cache to fall back on.',
  },
]

function DocsPage() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-[2rem] font-semibold tracking-tight text-text-primary max-md:text-2xl">
          How FormLab works
        </h1>
        <p className="text-text-secondary text-sm mt-2 max-w-[70ch]">
          Where the numbers come from: what is fetched, what is cached, what is computed on the fly, and
          which rules keep the activity cache honest.
        </p>
      </header>

      <Card title="Data flow">
        <DataFlowDiagram />
      </Card>

      <Card title="The sync pipeline">
        <ol className="flex flex-col gap-5">
          {syncSteps.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span className="shrink-0 size-7 rounded-full bg-accent/15 border border-accent/30 text-accent text-xs font-semibold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold text-text-primary mb-1">{step.title}</h3>
                <p className="text-[0.8125rem] text-text-secondary leading-relaxed max-w-[80ch]">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="What lives in Supabase">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="py-2 pr-4 text-[0.7rem] uppercase tracking-wider font-semibold text-text-muted">Table</th>
                <th className="py-2 pr-4 text-[0.7rem] uppercase tracking-wider font-semibold text-text-muted">Purpose</th>
                <th className="py-2 text-[0.7rem] uppercase tracking-wider font-semibold text-text-muted">Written by</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.name} className="border-b border-border-subtle last:border-0">
                  <td className="py-3 pr-4 align-top">
                    <span className="font-mono text-xs text-accent-light">{t.name}</span>
                  </td>
                  <td className="py-3 pr-4 align-top text-[0.8125rem] text-text-secondary">{t.purpose}</td>
                  <td className="py-3 align-top text-[0.8125rem] text-text-muted">{t.written}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[0.75rem] text-text-muted mt-4 leading-relaxed">
          Every table is scoped by <Code>athlete_id</Code> and guarded by a permissive RLS policy — the
          app is single-user behind the passphrase. Migrations live in <Code>supabase/migrations/</Code>.
        </p>
      </Card>

      <Card title="Where each page gets its data">
        <ul className="flex flex-col gap-2.5">
          {pageSources.map((p) => (
            <li key={p.page} className="flex gap-3 items-baseline max-md:flex-col max-md:gap-0.5">
              <span className="shrink-0 w-28 text-sm font-medium text-text-primary">{p.page}</span>
              <span className="text-[0.8125rem] text-text-secondary">{p.source}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Rules that keep the cache honest">
        <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1">
          {invariants.map((rule) => (
            <div
              key={rule.title}
              className="bg-bg-tertiary/50 border border-border-subtle rounded-[var(--radius-md)] p-5 max-md:p-4"
            >
              <h3 className="text-sm font-semibold text-text-primary mb-1.5">{rule.title}</h3>
              <p className="text-[0.8125rem] text-text-secondary leading-relaxed">{rule.body}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
