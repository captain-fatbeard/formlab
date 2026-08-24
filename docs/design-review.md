# FormLab — Design & UX Review

- **Reviewed:** 24 August 2026, against `v1.27.1` (`8cad72b`)
- **How:** every page walked in the running dev server against the real 586-activity dataset, at 1440×900 and 390×844
- **Published version:** https://claude.ai/code/artifact/e32e8620-a780-4044-a3a2-092dd5c0c399
  (source in `docs/design-review.html` — republish that same file to update in place)
- **Findings:** 38 across 9 pages

> **Picking this up in a new session:** the findings are numbered `F01`–`F38` and are stable.
> Reference them in commits and issues. `pnpm dev` + the passphrase reproduces everything below.
> Screenshots were not committed (`.playwright-mcp` is gitignored) — re-capture as needed.

---

## Contents

1. [What's already working](#1-whats-already-working)
2. [If you only do five things](#2-if-you-only-do-five-things)
3. [Numbers you can't trust at a glance](#3-numbers-you-cant-trust-at-a-glance) — F01–F07
4. [Where am I, and what am I looking at?](#4-where-am-i-and-what-am-i-looking-at) — F08–F12
5. [Layout and charts](#5-layout-and-charts) — F13–F21
6. [Type, contrast and colour](#6-type-contrast-and-colour) — F22–F27
7. [Interaction and accessibility](#7-interaction-and-accessibility) — F28–F37
8. [Worth adding](#8-worth-adding)
9. [What I checked, and what I didn't](#9-what-i-checked-and-what-i-didnt)

---

## 1. What's already working

Worth naming, because the fixes below should not disturb any of it.

- **The dark palette is properly built.** Four background steps, a real `border`/`border-subtle` split, semantic tokens, activity-type colours. That token layer is why the app looks coherent even where the layouts don't.
- **Lexend Deca + DM Mono is a smart pairing.** Tabular mono for every figure via `.data-value` is exactly right for a metrics product, and rare to see done deliberately.
- **The Activities table is the best screen in the app.** Search, a segmented type filter, four dropdowns, a clear button, a live result count, sortable columns, pagination — and grouping on top. That is a real tool.
- **Plan is the most mature page by a distance.** Title, description, targets, non-negotiables, a paused state that explains itself. It is the only page that tells you what it is before showing you numbers.
- **Copy has a voice.** "Train 120min more to continue 5 week streak", "Plan on hold — no sessions scheduled, nothing counts as missed." Better writing than most commercial fitness apps ship.
- **The training calendar is the strongest single component.** Load/Time toggle, year pager, a summary strip underneath.

---

## 2. If you only do five things

Ranked by how much each changes the experience per hour of work.

| # | Change | Why | Effort |
|---|--------|-----|--------|
| 1 | Pick one number format and one date language | One page shows `10.249 km`, `4,512 km` and `1107 m` — three conventions | ~1 hr |
| 2 | Get the global filters out of the avatar menu | Time Range and Activity Type silently drive most charts | ~half day |
| 3 | Give every page a title and a scope line | 8 of 9 pages open into cards with no heading and no stated period | ~2 hr |
| 4 | Lift `--color-text-muted`, stop shipping 10px body text | Caption colour is 3.16:1 and carries most explanatory copy | ~2 hr |
| 5 | Make the closed drawers `inert` | 10 invisible controls in the tab order on every page | ~30 min |

---

## 3. Numbers you can't trust at a glance

The most damaging category. An analytics app trades on the reader believing the figures, and these undermine that for free.

### F01 — Three number formats on the Overview page · **breaks trust**

The stat cards use `Intl.NumberFormat('da-DK')`, so total distance renders as **10.249** — which an English reader parses as ten-point-two-four-nine, not ten thousand. The calendar summary directly below uses a bare `toLocaleString()` and renders **4,512 km**. The activity table uses `toFixed(1)` and renders **44.2 km**, where the dot now means a decimal. Same page, same unit, three meanings for the same character.

- `src/components/StatsCards.tsx:8` — `new Intl.NumberFormat('da-DK')`
- `src/components/Pagination.tsx:42-43` — `toLocaleString('da-DK')`
- `src/components/ActivityCalendar.tsx:340-345`, `src/components/ActivityInsights.tsx:96-116` — bare `toLocaleString()`

**Fix:** one `formatNumber()` / `formatDistance()` pair in `src/lib/`, one locale constant, used everywhere.

### F02 — The app is bilingual by accident · **fix**

`src/lib/chart-theme.ts:134-142` hardcodes `locale: da` for every date, so the UI reads "Longest Ride · 29. jul. 2026" — English label, Danish date — under `<html lang="en">` (`src/routes/__root.tsx:47`).

**Fix:** pick one. Danish dates → set `lang="da"` and translate labels. English → drop the `da` locale.

### F03 — `715:46:14` · **fix**

Total moving time on the Overview card. Nobody reads seven-hundred-fifteen-colon-forty-six as a duration. The calendar summary two hundred pixels below already does it right — **171h 45m**. The card is also set two type steps smaller than its neighbours to make it fit (`text-[1.375rem]` vs `text-[2rem]` in `StatsCards.tsx`), so the row's numbers don't share a baseline.

**Fix:** reuse the `171h 45m` formatter, or `29d 19h` at that magnitude. Then the card can use the same `2rem` as the rest of the row.

### F04 — Ride splits are measured in min/km · **breaks trust**

On a 164 km ride the splits table shows **2:11/km**, **1:55/km**. Pace is a running unit; for a bike ride the reader wants km/h. 2:11/km is 27.5 km/h — correct data, wrong instrument. The elevation column in the same table shows **-0 m** and colours descents red, which reads as an error state for something that is just downhill.

- `src/routes/_dashboard/activities/$activityId.tsx`

**Fix:** branch the unit on activity type. Drop red/green on elevation delta, or reserve colour for the steepest split. Render `-0` as `0`.

### F05 — The Best Efforts row doesn't add up · **verify**

Records shows 400 m in 2:11, ½ mile in 4:44, 1 mile in 9:29, 2 mile in 19:25 — all consistent at roughly 5:30–6:00 per km. Then **5K in 5:48**, which would be a world record several times over. Either that cell is showing pace rather than elapsed time, or the distance bucket is mislabelled. Not traced to source — the arithmetic is the evidence.

Separately, that row mixes 400 m, ½ mile, 5K, 1 mile and 2 mile — metric and imperial interleaved, for a rider whose every other unit is metric.

- `src/routes/_dashboard/records.tsx:198` onwards (`groupBestEfforts`)

### F06 — Weight History draws a curve through five points · **breaks trust**

`src/components/WeightChart.tsx` uses `type="monotone"`. With five entries across ninety days that renders a smooth S-curve implying a gradual four-kilo gain through June and July. There is no data there — the interpolation is inventing a story. The weekly-average line uses `type="stepAfter"` on the same axis, which draws a square wave that reads as a rendering glitch on top of it.

**Fix:** `type="linear"` with visible dots, so gaps look like gaps. If you want the smoothing, make it a separate explicit "trend" series and label it.

### F07 — The headline contradicts the chart underneath it · **fix**

Health shows "CHANGE −13.8 kg" in accent green while the 90-day chart directly beneath rises from 94 to 97. Both are true — the KPI is lifetime, the chart is the selected range — but nothing says so, so one of them looks broken. Same problem on Overview, where lifetime stat cards (586 activities) sit directly above a 2026 calendar (172 activities).

**Fix:** scope every KPI in its own label: `Since first entry` vs `Last 90 days`.

---

## 4. Where am I, and what am I looking at?

Orientation is the app's weakest dimension. It knows a great deal and tells you almost none of it.

### F08 — The controls that change every number are hidden behind an avatar · **breaks trust**

Time Range and Activity Type live in a drawer opened by a circular "JJ" initials button in the top-right — universally the account menu. They are currently set to **Last 90 days / All activities**, and that silently determines what Health, Performance and most of Training show.

- `src/routes/_dashboard.tsx:790-820` (the drawer), `:680` (the avatar button)

**Fix:** promote both to the top bar as pills that read their current value (`90 days ▾` · `All sports ▾`). Leave the avatar for profile and logout. On mobile they currently need two taps through a hamburger.

### F09 — No page has a heading · **fix**

`document.querySelectorAll('h1').length` returns **0** on Activities. Overview, Training, Health, Performance and Records all open directly into cards. `src/routes/__root.tsx` sets `title: 'FormLab'` for every route, so history and open tabs are indistinguishable. Plan and Bike Fit both have a title and a one-line description — and both feel markedly more finished as a result.

**Fix:** `<h1>` plus a scope line per page: *Training · Last 90 days · All activities*. Set a per-route `title` in each route's `head()`.

### F10 — Three competing time controls, none of which explain their reach · **fix**

The global range in the drawer; per-card 30d/90d/6m/1y/All selectors (`src/components/RangeSelector.tsx`) on Weight, Power Trend, HR Trend and Efficiency; and lifetime KPIs that ignore both. On Performance you can end up changing three separate range pickers to compare three charts over the same window. Health is worse — Weight History has its own picker while the two charts below it obey the global one, with no visual distinction.

**Fix:** default every card to the global range; treat the local picker as an override with a visible "overriding global" marker. Or drop the local pickers entirely.

### F11 — Section headings are weaker than the card titles inside them · **fix**

On Overview, "Personal Records" is an `h3` at `text-lg` while "Training calendar" — a title *inside* a card one level down — is visually heavier. Records and Performance use a third treatment again (teal gradient text with an icon chip, `src/routes/_dashboard/performance.tsx:16-25`) that appears nowhere else.

**Fix:** three levels used consistently — page title, section heading, card title. Pick one visual for each and delete the variants.

### F12 — Docs is engineering documentation filed as user help · **fix**

The Settings drawer links to "Docs — how the data flows", which opens an architecture diagram: intervals.icu → Vercel function → localStorage → Supabase. That's a README, not help. The help a reader needs is what CTL, ATL, TSB, EF, NP, TSS and W/kg mean — terms the app uses constantly and explains in 10px grey type at the bottom of charts.

**Fix:** split it — a glossary reachable from the nav, and keep the architecture diagram for yourself. Better still, make each metric name a hoverable term that pops its own definition, and delete the explainer blocks.

---

## 5. Layout and charts

Mostly geometry — grids that strand cards, and charts asked to do something the data can't support.

### F13 — Orphan cards on almost every grid · **fix**

`auto-fit, minmax(180px, 1fr)` fits seven columns at 1440px:

| Screen | Cards | Columns | Orphans |
|---|---|---|---|
| Overview stats | 8 | 7 | 1 |
| Personal Records | 7 | 6 | 1 |
| Power Records | 6 | 4 | 2 |
| Activity detail tiles | 13 | 5 | 3 |

**Fix:** fixed column counts per breakpoint, or let the last row's items span the remaining tracks. Simplest real fix: cut the stat cards to six and give FTP and W/kg a larger tile.

### F14 — The donut charts waste half their card and don't suit the data · **fix**

Power Zones and HR Zone Distribution both put a ~150px donut in a ~450px column with the table beside it. Only three of seven power zones have any time in them. Legend order doesn't match table order in either. Zones with no time render `-` rather than `0`, so the reader can't tell "none" from "unknown".

- `src/components/PowerZonesChart.tsx`, `src/components/HeartRateInsights.tsx`

**Fix:** a horizontal stacked bar across the full card width, table below. Every zone gets a row even at zero, ordered Z1→Z7 in both places. That also lets you show target distribution behind actual.

### F15 — Weekly Training Load plots four series across two axes, and one is invisible · **breaks trust**

Distance (bars, 0–600), Avg Power (line), Time in hours (line) and Training Stress share one chart. Time in hours tops out around 5 against an axis running to 600 — so it renders as a flat line pinned to the floor. Training Stress is in the legend but not findable in the plot. Neither axis is labelled.

- `src/components/WeeklyProgress.tsx`

**Fix:** two series maximum per chart. Distance + TSS on the bars, hours as a separate sparkline, or a series toggle. Label both axes.

### F16 — Charts with two data points still render as charts · **fix**

There are two runs in range. "Pace Trend" draws a two-point flat line spanning 29 June to 1 July with a y-axis of 5:38–6:00; "Heart Rate Trend (Runs)" draws a wedge. Both look like bugs. The empty-state checks test for `length === 0` — the problem is *n = 2*, not *n = 0*.

- `src/components/RunningCharts.tsx:63-66`

**Fix:** a minimum-points threshold (4–5) with a real message: *"Two runs in this range — not enough to show a trend."*

### F17 — The current week always looks like a collapse · **fix**

Training's weekly chart and the four week-cards under it include the in-progress week, which shows 0 activities, 0 km, 0h 0m, 0 TSS. The bar chart drops to zero at the right edge. Health's calorie chart has the same cliff.

**Fix:** mark it — a hatched bar, a dimmed card, an "in progress · day 1 of 7" label — or exclude it from the trend and show it separately.

### F18 — A 164 km ride produces a 164-row splits table with no pagination · **fix**

The activity detail page for the Lolland ride runs to roughly eight thousand pixels of splits below the charts. Per-kilometre splits are right for a 40 km ride and unusable for a 164 km one, with no way to collapse, page or regroup.

**Fix:** collapse to the first ten with a "Show all 164" toggle; offer 5 km / 10 km grouping above ~60 km. Highlight fastest and slowest split.

### F19 — The route map opens zoomed to the whole Baltic · **fix**

The ride polyline occupies maybe a fifth of the map, which shows Aarhus, Malmö and Gdynia. Leaflet needs `fitBounds` on the decoded polyline. Also check for an OpenStreetMap attribution control — the tile licence requires it.

- `src/components/ActivityMap.tsx`

### F20 — Every metric tile on the activity page has identical weight · **fix**

Distance, moving time, elapsed time, speed, max speed, elevation, avg HR, max HR, power, cadence, calories, temperature and suffer score are all the same size, colour and shape. For a ride, distance and time are the headline and temperature is a footnote.

### F21 — Two Recharts containers render at width −1 · **fix**

The Plan page logs `The width(-1) and height(-1) of chart should be greater than 0` twice on load — a `ResponsiveContainer` inside a parent with no resolved height. Harmless today, but those charts do a layout pass at zero size on every mount.

---

## 6. Type, contrast and colour

The token system is good. The way it's being spent is the problem.

### F22 — `--color-text-muted` fails contrast and carries most of your writing · **breaks trust**

`#526868` on `#0e1515` measures **3.16:1**. WCAG AA wants 4.5:1 for body text. That token is on every stat-card sublabel, every uppercase eyebrow, every chart explainer, the idle nav links, dates, axis labels and "Showing 1–25 of 586".

- `src/styles/app.css:23`

**Fix:** move it to roughly `#7A8F8F` (≈4.6:1); keep `#526868` only for genuinely decorative marks. Nav links deserve better than muted regardless — they're primary navigation.

### F23 — White text on the teal accent measures 2.5:1 · **fix**

`text-white` on `bg-accent` (`#14b8a6`) is used for the "Group Activities" active state, "Create Group", the sticky "Confirm Group" button and the login "Unlock" button. `src/components/RangeSelector.tsx` already solves it — `bg-accent text-bg-primary`, dark on teal, which measures **7.9:1** and looks better.

**Fix:** make dark-on-accent the primary button rule everywhere. One change in `src/lib/styles.ts`.

### F24 — Too many type sizes below 12px · **fix**

In active use: `0.55rem`, `0.6rem`, `0.65rem`, `0.6875rem`, `0.7rem`, `0.75rem`. The Plan page's history metrics (TSS / CTL / ATL / TSB with delta arrows) sit at the bottom of that range in muted grey and are genuinely hard to read on a good monitor. The chart explainer blocks on Training and Performance have the same problem — real, useful writing set at a size that discourages reading it.

**Fix:** a four-step scale with a floor at `0.75rem`: `0.75 / 0.875 / 1 / 1.25rem`. Anything currently smaller is either not important (cut it) or important (make it legible).

### F25 — Red and green are doing two jobs at once · **fix**

On Plan History a recovery week renders as a red 28% bar next to green 88% bars — the week went exactly as designed, and it's coloured like a failure. Elevation deltas on splits are red for descent. Health's "Declining" badge is red with no indication of what's declining or whether that's bad news for a rider in a recovery block.

**Fix:** reserve red/green for good/bad; use neutral or accent for merely-different.

### F26 — Truncation hides the part that distinguishes the row · **fix**

Power Records shows five entries reading "Zwift - Climb Portal: La Supe…", "Zwift - Climb Portal: Col de P…", "Zwift - Climb Portal: Cheddar…". The shared prefix survives, the distinguishing suffix is cut, and there's no `title` attribute to recover it on hover.

**Fix:** add `title` at minimum. Better: strip the known `Zwift - ` prefix into the type badge you already show, and give the name the space back.

### F27 — Numbers in the activity table aren't aligned · **fix**

Distance, time, elevation, power and HR are left-aligned and set in the body face rather than `.data-value`, so digits don't line up down the column. It's the one table in the app where column-scanning is the whole point.

**Fix:** right-align numeric columns, apply `.data-value` for tabular figures. Also make the header row sticky at 25 rows a page.

---

## 7. Interaction and accessibility

Findings here were verified in the running app, not inferred from source.

### F28 — Ten invisible controls sit in the tab order of every page · **breaks trust**

The Settings drawer is always mounted, translated off-screen, `display: flex`, not `inert`, not `aria-hidden`. Its ten controls are focusable while it's closed. A keyboard user tabs: nav links → avatar → *Close settings, Time Range, Activity Type, Max HR, Resting HR, Birthday, Gender, Sync All, Docs, Logout* → page content. Every page, every time. Screen readers announce all of it as available.

- `src/routes/_dashboard.tsx` — the settings `<aside>` and the mobile nav `<aside>`

**Fix:** `inert` on the aside when closed. While you're there: `role="dialog"`, `aria-modal`, focus moved in on open and restored on close, Escape to dismiss. No modal in the app currently has any of these — `grep -rn "Escape\|role=\"dialog\"\|aria-modal" src` returns one unrelated hit.

### F29 — Nine `<label>` elements, zero `htmlFor` · **breaks trust**

Every field in Settings and the weight modal has a visible label that isn't attached to its input — the labels neither wrap the control nor reference it. The accessibility tree confirms it: those comboboxes and spinbuttons come back with no accessible name. Clicking the label also doesn't focus the field.

- `src/routes/_dashboard.tsx:798, 813, 830, 853, 876, 889`
- `src/components/WeightChart.tsx:237, 251, 272`

**Fix:** `htmlFor` + `id` on all nine. Fifteen minutes.

### F30 — Deleting a weight entry takes one click and can't be undone · **breaks trust**

In the weight modal each recent entry has a small `×` that deletes immediately — no confirm, no undo. It's the same glyph, at a similar size, as the modal's own close button a few centimetres above. `grep -rn "confirm(" src` returns nothing — ungrouping activities and logging out are equally instant.

- `src/components/WeightChart.tsx:285-295`

**Fix:** change the delete glyph to a trash icon so it stops mirroring "close". Add an undo toast rather than a confirm dialog.

### F31 — Sortable headers aren't reachable by keyboard · **fix**

The Activities table sorts on `<th onClick>` with no `button`, no `tabindex`, no `aria-sort`. Row clicks navigate, but rows have no role or tab stop — recoverable only because the name cell is a real link. The group expander is the whole row rather than a button, so there's no `aria-expanded`. The segmented type filter has no `aria-pressed`.

- `src/components/ActivityList.tsx:497-540`

### F32 — Identical badges, different behaviour · **fix**

In the Category column, "Training" and "Performance" are buttons that toggle on click (`ActivityList.tsx:700-715`). On a group row the same pill in the same column with the same styling is a static `<span>` (`:868-880`). Two columns left, the Ride Score pill looks the same again but is purely a label. Nothing distinguishes the clickable ones.

**Fix:** give the toggle a control affordance — a segmented micro-switch, or a border and hover state the read-only pills don't get.

### F33 — No `prefers-reduced-motion` anywhere · **fix**

`src/styles/app.css` has no reduced-motion query at all, and the app ships floating orbs, a pulsing glow, a staggered card cascade on every page load, spinners, fade-ins and hover translations. The login page's three `animate-float` orbs run indefinitely.

**Fix:** one block disabling animation and transition under the query. Ten lines.

### F34 — "Hover a day for detail" on a touch device · **fix**

The calendar's only interaction is hover, and the instruction to hover occupies a full row on mobile where hovering doesn't exist. The calendar also opens scrolled to January, so you scroll right to reach the current month, and the legend is cut off mid-word ("Ha…") at 390px.

- `src/components/ActivityCalendar.tsx`

**Fix:** tap-to-select on touch. Scroll to today on mount. Let the legend wrap.

### F35 — The Activities table doesn't survive mobile · **breaks trust**

At 390px the date column wraps to three lines ("19. / aug. / 2026"), pushing rows to ~80px. Eleven columns scroll horizontally with no sticky first column, so once you scroll right you've lost which activity you're reading — and the Category toggle is entirely off-screen. The filter toolbar wraps to three rows with "Group Activities" stranded alone on the last one.

**Fix:** below `md`, drop the table for a card list — name, date, type badge on top; distance / time / score underneath. It's the most-used screen and the one that degrades worst.

### F36 — Ten items a page over 954 segments · **fix**

Popular Segments paginates at 10 — 96 pages. Each row is a tall card, so the viewport holds about ten results. The sort chips clip at the right edge of their container ("Steepest" is cut). Segment names arrive from Strava in caps ("BERNSTOFFSVEJ - FRA HANS JENSENS VEJ") and aren't normalised, so half the list shouts.

- `src/routes/_dashboard/records.tsx`

**Fix:** 25–50 per page, denser rows, and let the search box carry more of the load.

### F37 — The login field has no autocomplete hint · **fix**

Chrome logs the suggestion on page load. The field is placeholder-only with no label, and the error message appears below the button with no reserved space, so the form shifts down when you get the passphrase wrong.

- `src/routes/index.tsx:96-116`

**Fix:** `autocomplete="current-password"`, a visible or visually-hidden label, and a fixed-height slot for the error.

---

## 8. Worth adding

Not fixes — things the data already supports that the interface doesn't yet offer.

| Addition | Why it fits | Cost |
|---|---|---|
| **A scope line on every page** | Cheapest fix for the trust problem in §3. *Last 90 days · All activities · 142 activities* under each page title. | S |
| **Hoverable metric definitions** | You already wrote the definitions — they're the explainer blocks. Attach them to the terms instead and delete the blocks. Recovers vertical space on Training and Performance. | M |
| **Compare two activities** | You have grouping, filters and per-activity detail. Selecting two rides and diffing power, HR and pace is the obvious next move and needs no new data. | M |
| **Year-over-year on the calendar** | Twelve years of history sit behind a year pager that shows one at a time. A stacked comparison, or "vs same point last year" in the summary strip, is the payoff for all that data. | M |
| **A "what changed" strip on Overview** | The app computes FTP, CTL, TSB and weight trends but never says what moved this week. Three deltas at the top would make the landing page answer a question rather than list totals. | M |
| **Sync state in the top bar** | Sync runs in the background on load and on refocus; the only surface for it is a button inside the drawer. A quiet "synced 4 min ago" is worth a lot when a number looks stale. | S |
| **Per-route page titles** | Every route renders `<title>FormLab</title>`. It's a PWA — tabs, history and the installed app all deserve better. | S |

---

## 9. What I checked, and what I didn't

**Checked in the running app** against live data, at 1440×900 and 390×844: Overview, Training, Health, Performance, Records, Activities, an activity detail page (the 164 km Lolland ride), Plan, Docs.

**Measured, not eyeballed:** the contrast ratios in F22 and F23; the tab order and focusability in F28; the label/`htmlFor` counts in F29; the `h1` count in F09; the absence of any `prefers-reduced-motion` or `:focus-visible` rule in the stylesheet.

**Read in source, not observed:** the interpolation types in F06; the locale constants in F01 and F02.

**Not reviewed:** Bike Fit, by request. One thing worth carrying into that session — `/bike-position.mov` 404s (it's gitignored as a local-only file) and the page reports no error, showing "Pose model ready" over an empty player. It also loads MediaPipe WASM from `cdn.jsdelivr.net` at runtime.

**Not covered:** performance and bundle size, the sync pipeline's behaviour under failure, and anything about the Supabase schema.
