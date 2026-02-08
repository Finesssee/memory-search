// Date parsing for search filters — relative (7d, 2w, 1m, 1y) and ISO (2025-01-15)

const RELATIVE_RE = /^(\d+)([dwmy])$/;

const UNIT_MS: Record<string, number> = {
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  m: 30 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

export function parseDate(input: string): number | null {
  const trimmed = input.trim();

  // Relative: 7d, 2w, 1m, 1y
  const relMatch = RELATIVE_RE.exec(trimmed);
  if (relMatch) {
    const count = parseInt(relMatch[1], 10);
    const unit = relMatch[2];
    return Date.now() - count * UNIT_MS[unit];
  }

  // ISO date: 2025-01-15
  const ts = Date.parse(trimmed);
  if (Number.isFinite(ts)) {
    return ts;
  }

  return null;
}
