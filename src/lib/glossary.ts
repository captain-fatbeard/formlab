// The vocabulary the app uses constantly and used to explain only in small
// grey type at the bottom of charts. One definition per term, shared by the
// glossary page and by every `<MetricTerm>` in the interface.

export interface GlossaryTerm {
  /** Anchor id — `/glossary#tsb`. */
  id: string
  term: string
  /** Expanded name, where the abbreviation has one. */
  full?: string
  /** One sentence, readable on hover. */
  short: string
  /** The fuller explanation, shown on the glossary page. */
  long: string
  /** How to read the number in practice. */
  reading?: string
}

export interface GlossaryGroup {
  title: string
  blurb: string
  terms: GlossaryTerm[]
}

export const GLOSSARY: GlossaryGroup[] = [
  {
    title: 'Training load',
    blurb: 'How hard a session was, and what a season of sessions has done to you.',
    terms: [
      {
        id: 'tss',
        term: 'TSS',
        full: 'Training Stress Score',
        short: 'One number for how much a session took out of you.',
        long: 'Combines duration and intensity into a single score. An hour at exactly your threshold is 100 TSS by definition, so a 200 TSS ride cost you roughly twice that — whether it came from two hard hours or four easy ones.',
        reading: 'Under 150 is a normal day, 300+ is a big one.',
      },
      {
        id: 'ctl',
        term: 'CTL',
        full: 'Chronic Training Load',
        short: 'Your fitness — a 42-day rolling average of daily TSS.',
        long: 'The slow-moving average of your training over the last six weeks. It rises when you train more than you have been and falls when you stop, which is why it stands in for fitness.',
        reading: 'Rising CTL means you are building. A fall during a taper is intended.',
      },
      {
        id: 'atl',
        term: 'ATL',
        full: 'Acute Training Load',
        short: 'Your fatigue — a 7-day rolling average of daily TSS.',
        long: 'The same average over a much shorter window, so it reacts to this week rather than this block. A hard weekend moves ATL immediately and CTL barely at all.',
        reading: 'ATL well above CTL means you are carrying fatigue.',
      },
      {
        id: 'tsb',
        term: 'TSB',
        full: 'Training Stress Balance',
        short: 'Form: fitness minus fatigue (CTL − ATL).',
        long: 'What is left of your fitness once fatigue is subtracted. Deeply negative means you are buried in a block; strongly positive means you are fresh, and if it stays there you are also detraining.',
        reading: '−10 to −30 is productive training. +5 to +20 is race-ready.',
      },
      {
        id: 'ramp-rate',
        term: 'Ramp rate',
        short: 'How fast CTL is climbing, per week.',
        long: 'The weekly change in CTL. It is the number that predicts injury and illness better than any single session does.',
        reading: 'Above about 8 CTL a week is where trouble usually starts.',
      },
    ],
  },
  {
    title: 'Power',
    blurb: 'What the pedals actually saw, and what it says about you.',
    terms: [
      {
        id: 'ftp',
        term: 'FTP',
        full: 'Functional Threshold Power',
        short: 'The power you could hold for roughly an hour.',
        long: 'The anchor for everything else: zones, TSS and intensity are all defined relative to it. FormLab estimates it from your best efforts across your whole history rather than from the current filter, so changing the time range never moves it.',
      },
      {
        id: 'np',
        term: 'NP',
        full: 'Normalised Power',
        short: 'What a variable ride "felt like" in steady-state terms.',
        long: 'A weighted average that punishes surges, because thirty seconds at 400 W costs far more than thirty seconds at 100 W saves. On a steady ride NP sits close to average power; in a criterium it can be far above it.',
      },
      {
        id: 'if',
        term: 'IF',
        full: 'Intensity Factor',
        short: 'NP as a fraction of FTP.',
        long: 'How hard the ride was relative to you specifically. 0.75 is endurance pace, 1.0 is an hour at threshold.',
      },
      {
        id: 'wkg',
        term: 'W/kg',
        full: 'Watts per kilogram',
        short: 'Power divided by body mass.',
        long: 'What decides how fast you go uphill, where absolute watts matter less than what is carrying them.',
        reading: '3 W/kg is a strong club rider; 5 W/kg is domestic elite.',
      },
      {
        id: 'vi',
        term: 'VI',
        full: 'Variability Index',
        short: 'NP divided by average power.',
        long: 'How evenly you rode. Near 1.0 means a metronome; 1.2 and up means a ride of surges — normal in a group, wasteful alone.',
      },
    ],
  },
  {
    title: 'Heart rate and efficiency',
    blurb: 'What the effort cost you internally.',
    terms: [
      {
        id: 'ef',
        term: 'EF',
        full: 'Efficiency Factor',
        short: 'Normalised power divided by average heart rate.',
        long: 'How much power one heartbeat buys. Tracked over months at a similar intensity it is one of the cleaner signals of aerobic progress — rising EF at a fixed heart rate is fitness.',
      },
      {
        id: 'max-hr',
        term: 'Max HR',
        short: 'The highest heart rate you actually reach.',
        long: 'Taken from your recorded activities where possible and estimated from age (Tanaka) otherwise. Every heart-rate zone is a fraction of it, so an inherited estimate skews all of them — set it by hand in Settings if you know yours.',
      },
      {
        id: 'resting-hr',
        term: 'Resting HR',
        short: 'Your heart rate at rest.',
        long: 'Used with Max HR to derive heart-rate reserve, which is what the zone boundaries are actually built from.',
      },
      {
        id: 'decoupling',
        term: 'Decoupling',
        short: 'How much heart rate drifts up while power stays flat.',
        long: 'Compares the first half of a steady ride with the second. Under 5% means the effort was genuinely aerobic for you; much more means you were running out of endurance.',
      },
    ],
  },
  {
    title: 'Zones and scores',
    blurb: 'The buckets the app sorts your time into.',
    terms: [
      {
        id: 'power-zones',
        term: 'Power zones (Z1–Z7)',
        short: 'Seven bands of power, all defined off FTP.',
        long: 'Z1 recovery, Z2 endurance, Z3 tempo, Z4 threshold, Z5 VO₂max, Z6 anaerobic, Z7 neuromuscular. Time spent in each is the shape of your training, not just its size.',
      },
      {
        id: 'hr-zones',
        term: 'HR zones (Z1–Z5)',
        short: 'Five bands of heart rate, built from heart-rate reserve.',
        long: 'Coarser than power zones and slower to respond, but they work on days a power meter does not — and on runs.',
      },
      {
        id: 'ride-score',
        term: 'Ride score',
        short: "FormLab's own 0–100 rating of how big a ride was.",
        long: 'Blends distance, elevation, intensity and duration so a flat fast hour and a slow mountainous four hours can be compared. Bands run Moderate, Solid, Hard, Epic.',
      },
      {
        id: 'suffer-score',
        term: 'Suffer score',
        short: 'Time spent in each heart-rate zone, weighted by zone.',
        long: 'A heart-rate analogue of TSS carried over from Strava. Useful when no power was recorded.',
      },
    ],
  },
]

export const GLOSSARY_TERMS: Record<string, GlossaryTerm> = Object.fromEntries(
  GLOSSARY.flatMap((group) => group.terms).map((term) => [term.id, term])
)
