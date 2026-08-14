/**
 * Everything in this app is stored internally as decimal inches (number).
 * Shop-facing display is fractional inches, because that is what a tape
 * measure reads.
 */

const FEET_INCH_RE = /^\s*(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(.*)$/i;
const MIXED_RE = /^\s*(-?\d+)\s+(\d+)\s*\/\s*(\d+)\s*$/;
const DASH_MIXED_RE = /^\s*(-?\d+)\s*-\s*(\d+)\s*\/\s*(\d+)\s*$/;
const FRACTION_RE = /^\s*(-?\d+)\s*\/\s*(\d+)\s*$/;
const DECIMAL_RE = /^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*$/;

/**
 * Parse shop-style dimension input into decimal inches.
 * Accepts: 24 | 24.5 | 24 1/2 | 24-1/2 | 1/2 | 2' 6 1/4" | 30mm | 720mm
 * Returns null when the input cannot be understood.
 */
export function parseDim(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Metric escape hatch — shops that spec in mm still cut in inches here.
  const mm = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*mm\s*$/i);
  if (mm) return Number(mm[1]) / 25.4;
  const cm = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*cm\s*$/i);
  if (cm) return Number(cm[1]) / 2.54;

  // Feet prefix: 2' 6 1/4"
  const ft = s.match(FEET_INCH_RE);
  if (ft) {
    const feet = Number(ft[1]);
    const restRaw = ft[2].replace(/"|in\b|inches\b/gi, '').trim();
    const sign = feet < 0 ? -1 : 1;
    if (!restRaw) return feet * 12;
    const rest = parseDim(restRaw);
    if (rest === null) return null;
    return feet * 12 + sign * Math.abs(rest);
  }

  s = s.replace(/"|in\b|inches\b/gi, '').trim();
  if (!s) return null;

  let m = s.match(MIXED_RE) ?? s.match(DASH_MIXED_RE);
  if (m) {
    const whole = Number(m[1]);
    const num = Number(m[2]);
    const den = Number(m[3]);
    if (den === 0) return null;
    const sign = s.trim().startsWith('-') ? -1 : 1;
    return whole + sign * (num / den);
  }

  m = s.match(FRACTION_RE);
  if (m) {
    const den = Number(m[2]);
    if (den === 0) return null;
    return Number(m[1]) / den;
  }

  m = s.match(DECIMAL_RE);
  if (m) return Number(m[1]);

  return null;
}

/** Greatest common divisor, used to reduce fractions to lowest terms. */
function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Format decimal inches as a shop fraction, e.g. 24.5 -> `24 1/2`.
 * `denom` is the finest division to snap to (16 = sixteenths, 32, 64...).
 */
export function formatFrac(inches: number, denom = 16): string {
  if (!Number.isFinite(inches)) return '—';
  const sign = inches < 0 ? '-' : '';
  const abs = Math.abs(inches);
  const whole = Math.floor(abs);
  let num = Math.round((abs - whole) * denom);
  let w = whole;
  if (num === denom) {
    w += 1;
    num = 0;
  }
  if (num === 0) return `${sign}${w}`;
  const g = gcd(num, denom);
  return `${sign}${w === 0 ? '' : w + ' '}${num / g}/${denom / g}`;
}

/** Fraction with a trailing inch mark, for drawings and printed cut lists. */
export function formatIn(inches: number, denom = 16): string {
  return `${formatFrac(inches, denom)}"`;
}

/**
 * True when the value is not exactly representable at `denom`, meaning the
 * displayed fraction is rounded and the part will not cut to the number shown.
 */
export function isRounded(inches: number, denom = 16): boolean {
  const scaled = inches * denom;
  return Math.abs(scaled - Math.round(scaled)) > 1e-9;
}

/** Feet-and-inches, for long runs and linear material. e.g. 3' 4 1/2" */
export function formatFeetInches(inches: number, denom = 16): string {
  const sign = inches < 0 ? '-' : '';
  const abs = Math.abs(inches);
  const feet = Math.floor(abs / 12);
  const rem = abs - feet * 12;
  if (feet === 0) return `${sign}${formatFrac(rem, denom)}"`;
  if (Math.abs(rem) < 1 / (denom * 2)) return `${sign}${feet}'`;
  return `${sign}${feet}' ${formatFrac(rem, denom)}"`;
}

export const sqFt = (widthIn: number, heightIn: number) => (widthIn * heightIn) / 144;
export const linFt = (inches: number) => inches / 12;

/**
 * Board feet for solid lumber. Nominal thickness in quarters (4/4 = 1")
 * is what lumber is *sold* as, even after surfacing to 13/16".
 */
export function boardFeet(nominalThicknessIn: number, widthIn: number, lengthIn: number, qty = 1): number {
  return (nominalThicknessIn * widthIn * lengthIn * qty) / 144;
}

export const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Snap a dimension to the nearest 1/32" to kill floating point dust. */
export const snap32 = (n: number) => Math.round(n * 32) / 32;
