// Chart theme with distinct, high-contrast color palette

export const chartTheme = {
  // Grid and axes
  grid: '#1f2e2e',
  axis: '#5f7a7a',

  // Tooltip
  tooltip: {
    background: '#0e1515',
    border: '#263838',
    text: '#eaf5f2',
  },

  // Distinct color palette — vibrant, high-contrast on dark backgrounds
  colors: {
    // Primary - Teal (brand)
    primary: {
      main: '#14b8a6',
      light: '#2dd4bf',
      lighter: '#5eead4',
      dark: '#0d9488',
      muted: '#0f766e',
    },
    // Secondary - Indigo/Violet
    secondary: {
      main: '#818cf8',
      light: '#a5b4fc',
      dark: '#6366f1',
    },
    // Tertiary - Rose
    tertiary: {
      main: '#fb7185',
      light: '#fda4af',
      dark: '#f43f5e',
    },
    // Fourth - Amber (vibrant, not muddy)
    amber: {
      main: '#fbbf24',
      light: '#fde68a',
      dark: '#f59e0b',
    },
    // Fifth - Sky Blue
    sky: {
      main: '#38bdf8',
      light: '#7dd3fc',
      dark: '#0ea5e9',
    },
    // Sixth - Orange
    coral: {
      main: '#f97316',
      light: '#fdba74',
      dark: '#ea580c',
    },
    // Neutral grays — slightly cool-tinted
    neutral: {
      50: '#eaf5f2',
      100: '#d1e5e0',
      200: '#a8ccc4',
      300: '#7ab3a8',
      400: '#8fa8a8',
      500: '#526868',
      600: '#3a4f4f',
      700: '#263838',
      800: '#1a2828',
    },
    // Semantic colors
    semantic: {
      positive: '#34d399',
      negative: '#f87171',
      warning: '#fbbf24',
      info: '#60a5fa',
    },
  },

  // Fill colors with transparency — tuned for dark backgrounds
  fills: {
    primary: {
      main: 'rgba(20, 184, 166, 0.2)',
      light: 'rgba(45, 212, 191, 0.15)',
      lighter: 'rgba(94, 234, 212, 0.1)',
    },
    secondary: {
      main: 'rgba(129, 140, 248, 0.2)',
      light: 'rgba(165, 180, 252, 0.15)',
    },
    tertiary: {
      main: 'rgba(251, 113, 133, 0.2)',
      light: 'rgba(253, 164, 175, 0.15)',
    },
    amber: {
      main: 'rgba(251, 191, 36, 0.2)',
      light: 'rgba(253, 230, 138, 0.15)',
    },
    sky: {
      main: 'rgba(56, 189, 248, 0.2)',
      light: 'rgba(125, 211, 252, 0.15)',
    },
    coral: {
      main: 'rgba(249, 115, 22, 0.2)',
      light: 'rgba(253, 186, 116, 0.15)',
    },
    semantic: {
      positive: 'rgba(52, 211, 153, 0.15)',
      negative: 'rgba(248, 113, 113, 0.15)',
    },
  },
}

// Power zone colors - clear cool-to-hot progression
export const zoneColors = [
  '#64748b', // Z1 - Recovery (slate)
  '#2dd4bf', // Z2 - Endurance (teal)
  '#4ade80', // Z3 - Tempo (green)
  '#facc15', // Z4 - Threshold (yellow)
  '#fb923c', // Z5 - VO2max (orange)
  '#f87171', // Z6 - Anaerobic (red)
  '#e879f9', // Z7 - Neuromuscular (fuchsia)
]

// HR zone colors - clear cool-to-hot progression
export const hrZoneColors = [
  '#64748b', // Z1 - Recovery (slate)
  '#2dd4bf', // Z2 - Fat Burn (teal)
  '#4ade80', // Z3 - Aerobic (green)
  '#fb923c', // Z4 - Threshold (orange)
  '#f87171', // Z5 - Maximum (red)
]

// Dates come from lib/format so charts, tables and headers can never disagree
// about what language or order a date renders in. Re-exported here because
// most chart code already imports from this module.
import { formatDateShort, formatDateFull } from './format'

export { formatDateShort, formatDateFull }

// Shared tooltip label formatter: shows activity name as title, date as subtitle
// Works with any chart data that has a `name` field in the payload
export function activityTooltipLabel(label: string, payload?: Array<{ payload?: { name?: string } }>) {
  const name = payload?.[0]?.payload?.name
  const date = formatDateFull(label)
  if (name) return `${name}\n${date}`
  return date
}

// Tooltip style object for Recharts
export const tooltipStyle = {
  contentStyle: {
    backgroundColor: chartTheme.tooltip.background,
    border: `1px solid ${chartTheme.tooltip.border}`,
    borderRadius: '10px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.03)',
    padding: '12px 16px',
    fontFamily: "'Lexend Deca', system-ui, sans-serif",
  },
  labelStyle: {
    color: chartTheme.tooltip.text,
    fontWeight: 500,
    marginBottom: '8px',
    whiteSpace: 'pre-line' as const,
    fontSize: '0.8125rem',
  },
  itemStyle: {
    color: chartTheme.colors.neutral[400],
    padding: '3px 0',
    fontFamily: "'DM Mono', monospace",
    fontSize: '0.8125rem',
  },
}
