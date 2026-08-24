/**
 * Segment names arrive from Strava as their author typed them, and a good half
 * of them shout: `BERNSTOFFSVEJ - FRA HANS JENSENS VEJ`. A list where every
 * other row is in caps is unreadable, so names that are effectively all-caps
 * are cased down for display. Names with ordinary mixed case are left exactly
 * as they are — an intentional `KOM` or `Zwift` should survive.
 */

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'by', 'for', 'fra', 'from', 'in', 'of', 'on',
  'or', 'the', 'til', 'to', 'via',
])

/** True when the string is loud enough to be worth calming down. */
export function isShouting(name: string): boolean {
  const letters = name.replace(/[^\p{L}]/gu, '')
  if (letters.length < 4) return false
  const upper = letters.replace(/[^\p{Lu}]/gu, '')
  return upper.length / letters.length > 0.8
}

/** Display form of a segment name. */
export function normalizeSegmentName(name: string): string {
  const trimmed = name.trim()
  if (!isShouting(trimmed)) return trimmed

  return trimmed
    .toLocaleLowerCase()
    .replace(/\p{L}[\p{L}\p{M}'’-]*/gu, (word, offset: number) =>
      offset > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toLocaleUpperCase() + word.slice(1)
    )
}

/**
 * Zwift prefixes every climb-portal segment with the same eleven characters, so
 * a truncated list reads "Zwift - Climb Portal: La Supe…" three times over.
 * The prefix is returned separately, for the badge that already exists.
 */
export function splitActivityPrefix(name: string): { prefix: string | null; rest: string } {
  const match = /^(Zwift)\s*[-–:]\s*(.+)$/i.exec(name.trim())
  if (!match) return { prefix: null, rest: name.trim() }
  return { prefix: 'Zwift', rest: match[2] }
}
