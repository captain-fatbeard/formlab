# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.25.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.24.0...v1.25.0) (2026-08-05)


### Features

* **docs:** add data flow docs page linked from settings ([7c4ef40](https://github.com/captain-fatbeard/strava-performance-tracker/commit/7c4ef400c5e20600e7a8d7524c803ccb7d3e7162))

## [1.24.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.23.0...v1.24.0) (2026-07-31)


### Features

* **activities:** add filters to the activity list ([1bd9a69](https://github.com/captain-fatbeard/strava-performance-tracker/commit/1bd9a69466889eb5a7a28692e02d5aa2295a8c7f))
* **activities:** score rides by training load instead of power formula ([dc904bd](https://github.com/captain-fatbeard/strava-performance-tracker/commit/dc904bd6d78e81616b459c8d9e96095f4172bfa2))
* **infra:** add daily Supabase keepalive cron ([b979c8b](https://github.com/captain-fatbeard/strava-performance-tracker/commit/b979c8b83ef3b35288c4cf978809a0cf4af0122c))
* **plan:** add option to pause the training plan for a week ([4e86079](https://github.com/captain-fatbeard/strava-performance-tracker/commit/4e8607922065c71b42cbe25d596205a3f99d8608))
* **plan:** default new weeks to paused ([ddd8e78](https://github.com/captain-fatbeard/strava-performance-tracker/commit/ddd8e7849fa2dcf54d9b3d3587e008fc272083dc))
* **power:** estimate power for rides without a power meter ([c6ba76b](https://github.com/captain-fatbeard/strava-performance-tracker/commit/c6ba76b7a746efc8b83f4f9adac3cb099b915dc5))
* **sync:** switch data source from Strava to intervals.icu ([fa92eb2](https://github.com/captain-fatbeard/strava-performance-tracker/commit/fa92eb2b4d261b414b7e65b1dae66d5e799a3184))


### Bug Fixes

* **sync:** prevent and self-heal duplicate activities from failed cache reads ([892d988](https://github.com/captain-fatbeard/strava-performance-tracker/commit/892d98817561616575578805808e2b903c5f6c1e))

## [1.23.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.22.1...v1.23.0) (2026-05-28)


### Features

* **fitness:** add CTL targets table showing TSS load needed per tier ([6958025](https://github.com/captain-fatbeard/strava-performance-tracker/commit/695802564bc1a47eee20c1fef50dc53ab0506015))

### [1.22.1](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.22.0...v1.22.1) (2026-05-22)


### Bug Fixes

* **fitness:** show CTL/ATL/form to one decimal so daily decay isn't a rounding jump ([e3062e5](https://github.com/captain-fatbeard/strava-performance-tracker/commit/e3062e50581a8b5fda63ab628f6fbf980498ca21))

## [1.22.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.21.0...v1.22.0) (2026-05-20)


### Features

* **records:** compute true power-duration peaks from streams ([053da79](https://github.com/captain-fatbeard/strava-performance-tracker/commit/053da793149cc926ed05320a4f75f331a10459ba))


### Bug Fixes

* **performance:** grade VO2max by age, refine FTP, cap corrupt ride speed ([3b5e58d](https://github.com/captain-fatbeard/strava-performance-tracker/commit/3b5e58de19537300f28e455c2e359167e2c03580))

## [1.21.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.20.0...v1.21.0) (2026-05-19)


### Features

* **plan:** add tempo cycling session type ([b58a4ca](https://github.com/captain-fatbeard/strava-performance-tracker/commit/b58a4ca29cd8742d2fb23dd28f06a00ae4f8d430))


### Refactoring

* **plan:** unify Z2 label across recovery and build templates ([1afc0e1](https://github.com/captain-fatbeard/strava-performance-tracker/commit/1afc0e16910c2a47f2d28068b1fcc4ef30658a06))

## [1.20.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.19.0...v1.20.0) (2026-05-17)


### Features

* **performance:** overhaul page to focus on form and progress ([4ecd606](https://github.com/captain-fatbeard/strava-performance-tracker/commit/4ecd606a80e5331e17dc7c661f00ee784aee21cf))

## [1.19.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.18.0...v1.19.0) (2026-05-08)


### Features

* **lists:** paginate activity list and popular segments ([8a1cf82](https://github.com/captain-fatbeard/strava-performance-tracker/commit/8a1cf825a3ff6938e814f2dd13e443f187a5d17b))
* **overview:** show lifetime stats and fix pace/format issues ([1105c19](https://github.com/captain-fatbeard/strava-performance-tracker/commit/1105c1900c286fb2af3195416ff51edbe49b802d))

## [1.18.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.17.0...v1.18.0) (2026-05-07)


### Features

* **plan:** allow editing session type on past days ([9ded1b5](https://github.com/captain-fatbeard/strava-performance-tracker/commit/9ded1b523c0a5f3a18b01c0fa9a4c1fd56562e48))

## [1.17.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.16.0...v1.17.0) (2026-05-02)


### Features

* **plan:** calibrate TSS per-minute factors and flex tempo-run ([bfe96de](https://github.com/captain-fatbeard/strava-performance-tracker/commit/bfe96de7721b33449a8904826377920e59213396))
* **plan:** sport-aware TSS for runs and powerless rides ([80b0211](https://github.com/captain-fatbeard/strava-performance-tracker/commit/80b02115b420c04d7fcd9354f0b3de0d91b7acdc))

## [1.16.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.15.0...v1.16.0) (2026-04-29)


### Features

* **plan:** lock history, future-only swap, surface actual vs est. TSS ([ab73603](https://github.com/captain-fatbeard/strava-performance-tracker/commit/ab73603b5cf4fa2d67293b9ff2e4acba785533ed))

## [1.15.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.14.1...v1.15.0) (2026-04-27)


### Features

* add bike fit page with live pose analysis ([3819fa1](https://github.com/captain-fatbeard/strava-performance-tracker/commit/3819fa1c91e310c3c44836f8f1206b2b663093d2))
* customizable weekly plan with auto-classified phase + CTL-aware recommendations ([22225ba](https://github.com/captain-fatbeard/strava-performance-tracker/commit/22225ba22ebbb3bde5b34c0477629d2fcf35ef75))

### [1.14.1](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.14.0...v1.14.1) (2026-04-25)


### Bug Fixes

* lock auto plan phase to week start so it doesn't flip mid-week ([10a9ba9](https://github.com/captain-fatbeard/strava-performance-tracker/commit/10a9ba9f729d771bb1190569224c568e11ff2b9a))

## [1.14.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.13.0...v1.14.0) (2026-04-22)


### Features

* add plan progress, phase toggle, history, and target details ([cfcd98b](https://github.com/captain-fatbeard/strava-performance-tracker/commit/cfcd98b78b85474b5f8aebb4d1b23e68cced7051))

## [1.13.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.12.0...v1.13.0) (2026-04-20)


### Features

* add training plan page with live targets and weekly template ([2f03046](https://github.com/captain-fatbeard/strava-performance-tracker/commit/2f03046eba5687c7cd8371a30fb42070a37ce66f))

## [1.12.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.11.0...v1.12.0) (2026-04-16)


### Features

* add manual override inputs for Max HR and Resting HR ([2ed8869](https://github.com/captain-fatbeard/strava-performance-tracker/commit/2ed88696befcbf1724f52e408d840c40b83f17e2))
* redesign UI with premium typography, unified top bar, and refined aesthetics ([431d715](https://github.com/captain-fatbeard/strava-performance-tracker/commit/431d715c5426e3773b18eea3db30f9e724db6f71))
* unify color system with vibrant chart palette and themed variables ([a566252](https://github.com/captain-fatbeard/strava-performance-tracker/commit/a566252028cfe069c9dc2a27611dcbfa674d825c)), closes [#fbbf24](https://github.com/captain-fatbeard/strava-performance-tracker/issues/fbbf24)

## [1.11.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.10.1...v1.11.0) (2026-04-14)


### Features

* show streak motivation message on day streak card ([0302af6](https://github.com/captain-fatbeard/strava-performance-tracker/commit/0302af67feb1294bfc6dc6f061a9e9d48c53dd61))

### [1.10.1](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.10.0...v1.10.1) (2026-04-09)


### Bug Fixes

* use all activities for week streak calculation instead of time-range-filtered ([b8b29d4](https://github.com/captain-fatbeard/strava-performance-tracker/commit/b8b29d4067922735d6f5a74fb9e3c015513693f5))

## [1.10.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.9.0...v1.10.0) (2026-04-07)


### Features

* add weight slider to VO2max card for what-if estimation ([c0436c1](https://github.com/captain-fatbeard/strava-performance-tracker/commit/c0436c16b7f61fb803454df4277c0f214e93b667))
* show avg duration as primary value in Avg/Week card with activities and distance as sub values ([1cbde56](https://github.com/captain-fatbeard/strava-performance-tracker/commit/1cbde56f7b5c001e878648d14843862547334526))

## [1.9.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.8.0...v1.9.0) (2026-04-06)


### Features

* add day streak and weekly streak continuation status ([bd97c22](https://github.com/captain-fatbeard/strava-performance-tracker/commit/bd97c22b562a982f98b3988f8e84c88be599ad38))
* add shared RangeSelector to Weight History and Fitness charts ([9581a49](https://github.com/captain-fatbeard/strava-performance-tracker/commit/9581a498ccc9b73a4b41083ccda632ea50c50bf0))
* merge activity consistency into weekly training load ([614d0d7](https://github.com/captain-fatbeard/strava-performance-tracker/commit/614d0d70752f5fcea3c31b01666b5e98f091dddd))


### Refactoring

* extract shared utilities and reduce code duplication ([43b427c](https://github.com/captain-fatbeard/strava-performance-tracker/commit/43b427c5d4fe7e4743672bc34d1cfd85421d99a2))

## [1.8.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.7.0...v1.8.0) (2026-04-04)


### Features

* use date-based FTP estimation for stable CTL calculation ([d1eea3b](https://github.com/captain-fatbeard/strava-performance-tracker/commit/d1eea3b1fcbbb18f5bb3cb4589f3f933c5549adf))

## [1.7.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.6.0...v1.7.0) (2026-04-02)


### Features

* add name search and sortable columns to activity list ([b78e5ea](https://github.com/captain-fatbeard/strava-performance-tracker/commit/b78e5eab68fb227f25de447067130e8ded2eaf77))
* add vitest testing setup with CI workflow ([fa689cd](https://github.com/captain-fatbeard/strava-performance-tracker/commit/fa689cdc20cc22da6032c93efba122f6e44d8ba7))
* improve activity grouping UX with toggle mode and category enforcement ([ebdd757](https://github.com/captain-fatbeard/strava-performance-tracker/commit/ebdd7571a8e258281d74005c2b6027ec450da3f2))

## [1.6.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.5.0...v1.6.0) (2026-03-29)


### Features

* add activity grouping to merge activities into one ([a709527](https://github.com/captain-fatbeard/strava-performance-tracker/commit/a7095272bfb29b9042311301d9940b2a0ba1adfd))

## [1.5.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.4.0...v1.5.0) (2026-03-27)


### Features

* move Activities to last position in nav bar ([cbd23d8](https://github.com/captain-fatbeard/strava-performance-tracker/commit/cbd23d81361b7da1134aad432d8b8c1b50f7c7c9))


### Bug Fixes

* prevent session loss on Strava sync failure ([2a63dbb](https://github.com/captain-fatbeard/strava-performance-tracker/commit/2a63dbbe8b4c92a19659c5e569dabbe539393217))

## [1.4.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.3.0...v1.4.0) (2026-03-24)


### Features

* replace exclude mechanism with training/performance activity categories ([0fc57cc](https://github.com/captain-fatbeard/strava-performance-tracker/commit/0fc57cc1f11346dd3c911f6b5fb5e9e71f292885))

## [1.3.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.2.0...v1.3.0) (2026-03-23)


### Features

* add Records page with personal records, power records, best efforts, and popular segments ([6dbd8bd](https://github.com/captain-fatbeard/strava-performance-tracker/commit/6dbd8bdac4c24d320596658eed97bc67a52bae17))

## [1.2.0](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.1.1...v1.2.0) (2026-03-20)


### Features

* add ride score column to activity list ([943b137](https://github.com/captain-fatbeard/strava-performance-tracker/commit/943b1373ddde8feac14604a7425af558195693c8))
* add trend line connecting dots on Power Sustainability chart ([bd5508a](https://github.com/captain-fatbeard/strava-performance-tracker/commit/bd5508a0c97b9ff5705404bea3b42f8da6d6de7b))

### [1.1.1](https://github.com/captain-fatbeard/strava-performance-tracker/compare/v1.1.0...v1.1.1) (2026-03-19)


### Bug Fixes

* resolve Invalid time value error on performance page ([851a5d7](https://github.com/captain-fatbeard/strava-performance-tracker/commit/851a5d791a48b12eaf442efc38e6e74756ccf064))

## 1.1.0 (2026-03-19)


### Features

* add activity scoring with effort vs terrain analysis ([58b4b6b](https://github.com/captain-fatbeard/strava-performance-tracker/commit/58b4b6b2bd9adde6dc08ee4086c63411274fcd1a))

## [1.0.0] - 2025-02-22

### Features

- **Dashboard:** Overview page with stats cards, personal records, and key metrics (FTP, W/kg, avg power, avg HR)
- **Training:** Fitness & Form chart (CTL/ATL/TSB), power zones distribution, weekly training progress
- **Health:** Weight tracking with history chart, heart rate insights, activity insights with VO2max categories
- **Performance:** Cycling metrics (efficiency, power trends, climbing speed), running metrics (pace, cadence, VO2max)
- **Activities:** Searchable activity list with detail pages, interactive maps, and per-activity charts
- **Strava Integration:** OAuth login, paginated activity sync, full history "Sync All" with rate limiting
- **Data Persistence:** Supabase for settings sync, weight entries, activity caching, and excluded activities
- **Responsive Design:** Mobile nav drawer, responsive grids, sidebar/drawer settings panel
- **Customization:** Configurable time ranges, activity type filters, activity exclusion from stats
- **Analytics Engine:** FTP estimation, TSS/CTL/ATL/TSB calculations, power zones, HR zones, personal records
- **UI/UX:** Dark theme with teal/cyan accents, animated charts, gradient text, modal dialogs
