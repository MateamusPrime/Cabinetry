import type {
  EdgebandMaterial,
  FinishSpec,
  HardwareItem,
  LumberMaterial,
  Material,
  SheetMaterial,
} from './types';

/**
 * Default catalog. Prices are realistic US shop-buy figures but they are
 * starting points, not quotes — every price here is editable in the app,
 * and you should overwrite them with your actual supplier numbers.
 */

const sheet = (
  id: string,
  name: string,
  species: string,
  thickness: number,
  costPerSheet: number,
  finishGrade: SheetMaterial['finishGrade'],
  hasGrain: boolean,
  sheetWidth = 48,
  sheetLength = 96,
  notes?: string,
): SheetMaterial => ({
  id,
  kind: 'sheet',
  name,
  species,
  thickness,
  sheetWidth,
  sheetLength,
  costPerSheet,
  hasGrain,
  finishGrade,
  notes,
});

export const DEFAULT_SHEETS: SheetMaterial[] = [
  // --- Cabinet-grade veneer core plywood, 4x8 ---
  // Nominal "3/4" domestic ply actually measures 23/32"; "1/2" is 15/32".
  // These are the numbers the parts math uses, so they are the actual
  // thickness rather than the nominal name. Measure your own stock and
  // correct these if your supplier runs different.
  sheet('ply-birch-34', 'Birch Plywood 3/4"', 'Birch', 23 / 32, 92, 'stain', true, 48, 96, 'Nominal 3/4", actual 23/32"'),
  sheet('ply-birch-12', 'Birch Plywood 1/2"', 'Birch', 15 / 32, 68, 'stain', true, 48, 96, 'Actual 15/32"'),
  sheet('ply-birch-14', 'Birch Plywood 1/4"', 'Birch', 13 / 64, 42, 'utility', true, 48, 96, 'Backs and drawer bottoms'),
  sheet('ply-prefin-maple-34', 'Prefinished Maple Ply 3/4"', 'Maple', 23 / 32, 108, 'prefinished', true, 48, 96, 'Standard box material — no interior finishing'),
  sheet('ply-prefin-maple-12', 'Prefinished Maple Ply 1/2"', 'Maple', 15 / 32, 82, 'prefinished', true),
  sheet('ply-prefin-maple-14', 'Prefinished Maple Ply 1/4"', 'Maple', 13 / 64, 52, 'prefinished', true),
  sheet('ply-maple-34', 'Maple Plywood 3/4"', 'Hard Maple', 23 / 32, 98, 'stain', true),
  sheet('ply-redoak-34', 'Red Oak Plywood 3/4"', 'Red Oak', 23 / 32, 94, 'stain', true),
  sheet('ply-whiteoak-34', 'White Oak Plywood 3/4"', 'White Oak', 23 / 32, 142, 'stain', true, 48, 96, 'Rift-sawn runs higher'),
  sheet('ply-cherry-34', 'Cherry Plywood 3/4"', 'Cherry', 23 / 32, 134, 'stain', true),
  sheet('ply-walnut-34', 'Walnut Plywood 3/4"', 'Walnut', 23 / 32, 188, 'stain', true),
  sheet('ply-hickory-34', 'Hickory Plywood 3/4"', 'Hickory', 23 / 32, 124, 'stain', true),

  // --- Baltic birch, 5x5 ---
  sheet('bb-34', 'Baltic Birch 3/4" (5x5)', 'Baltic Birch', 0.709, 96, 'stain', true, 60, 60, 'Void-free, great drawer boxes'),
  sheet('bb-12', 'Baltic Birch 1/2" (5x5)', 'Baltic Birch', 0.472, 72, 'stain', true, 60, 60, 'Standard drawer box stock'),
  sheet('bb-14', 'Baltic Birch 1/4" (5x5)', 'Baltic Birch', 0.236, 44, 'utility', true, 60, 60, 'Drawer bottoms'),

  // --- Sheet stock for paint and utility ---
  sheet('mdf-34', 'MDF 3/4"', 'MDF', 0.75, 48, 'paint', false),
  sheet('mdf-12', 'MDF 1/2"', 'MDF', 0.5, 36, 'paint', false),
  sheet('mdf-14', 'MDF 1/4"', 'MDF', 0.25, 24, 'paint', false),
  sheet('mel-white-34', 'White Melamine 3/4"', 'Melamine', 0.75, 54, 'melamine', false),
  sheet('pb-34', 'Particleboard 3/4"', 'Particleboard', 0.75, 34, 'utility', false),
  sheet('ply-paintgrade-34', 'Paint-Grade Poplar Ply 3/4"', 'Poplar', 23 / 32, 86, 'paint', true),
];

const lumber = (
  id: string,
  name: string,
  species: string,
  costPerBoardFoot: number,
  nominalThickness = 1,
  actualThickness = 0.8125,
  stockLength = 96,
  stockWidth = 7,
  notes?: string,
): LumberMaterial => ({
  id,
  kind: 'lumber',
  name,
  species,
  nominalThickness,
  actualThickness,
  costPerBoardFoot,
  hasGrain: true,
  stockLength,
  stockWidth,
  notes,
});

export const DEFAULT_LUMBER: LumberMaterial[] = [
  lumber('lbr-poplar-44', 'Poplar 4/4 S2S', 'Poplar', 4.6, 1, 0.8125, 96, 7, 'Paint-grade face frames'),
  lumber('lbr-softmaple-44', 'Soft Maple 4/4 S2S', 'Soft Maple', 5.6, 1, 0.8125),
  lumber('lbr-hardmaple-44', 'Hard Maple 4/4 S2S', 'Hard Maple', 7.6, 1, 0.8125),
  lumber('lbr-redoak-44', 'Red Oak 4/4 S2S', 'Red Oak', 6.5, 1, 0.8125),
  lumber('lbr-whiteoak-44', 'White Oak 4/4 S2S', 'White Oak', 9.75, 1, 0.8125),
  lumber('lbr-cherry-44', 'Cherry 4/4 S2S', 'Cherry', 8.75, 1, 0.8125),
  lumber('lbr-walnut-44', 'Walnut 4/4 S2S', 'Walnut', 15.5, 1, 0.8125),
  lumber('lbr-hickory-44', 'Hickory 4/4 S2S', 'Hickory', 7.25, 1, 0.8125),
  lumber('lbr-ash-44', 'Ash 4/4 S2S', 'Ash', 6.25, 1, 0.8125),
  lumber('lbr-alder-44', 'Alder 4/4 S2S', 'Alder', 6.0, 1, 0.8125),
  lumber('lbr-mahogany-44', 'Mahogany 4/4 S2S', 'Mahogany', 14.0, 1, 0.8125),
  lumber('lbr-pine-44', 'Pine 4/4', 'Pine', 4.0, 1, 0.75),
  lumber('lbr-whiteoak-54', 'White Oak 5/4 S2S', 'White Oak', 11.5, 1.25, 1.0625, 96, 7, 'Heavier doors and thick stiles'),
  lumber('lbr-hardmaple-84', 'Hard Maple 8/4 S2S', 'Hard Maple', 9.5, 2, 1.75, 96, 7, 'Legs, posts, thick tops'),
];

export const DEFAULT_EDGEBAND: EdgebandMaterial[] = [
  { id: 'eb-maple-pg', kind: 'edgeband', name: 'Maple Veneer Edgeband (pre-glued)', species: 'Maple', thickness: 0.02, width: 0.8125, costPerLinearFoot: 0.34 },
  { id: 'eb-birch-pg', kind: 'edgeband', name: 'Birch Veneer Edgeband (pre-glued)', species: 'Birch', thickness: 0.02, width: 0.8125, costPerLinearFoot: 0.32 },
  { id: 'eb-redoak-pg', kind: 'edgeband', name: 'Red Oak Veneer Edgeband', species: 'Red Oak', thickness: 0.02, width: 0.8125, costPerLinearFoot: 0.36 },
  { id: 'eb-whiteoak-pg', kind: 'edgeband', name: 'White Oak Veneer Edgeband', species: 'White Oak', thickness: 0.02, width: 0.8125, costPerLinearFoot: 0.48 },
  { id: 'eb-cherry-pg', kind: 'edgeband', name: 'Cherry Veneer Edgeband', species: 'Cherry', thickness: 0.02, width: 0.8125, costPerLinearFoot: 0.46 },
  { id: 'eb-walnut-pg', kind: 'edgeband', name: 'Walnut Veneer Edgeband', species: 'Walnut', thickness: 0.02, width: 0.8125, costPerLinearFoot: 0.62 },
  { id: 'eb-pvc-white', kind: 'edgeband', name: 'White PVC Edgeband 1mm', species: 'PVC', thickness: 0.04, width: 0.875, costPerLinearFoot: 0.22 },
  { id: 'eb-solid-maple', kind: 'edgeband', name: 'Solid Maple Edging 1/4" x 3/4"', species: 'Hard Maple', thickness: 0.25, width: 0.75, costPerLinearFoot: 0.95 },
];

export const DEFAULT_MATERIALS: Material[] = [
  ...DEFAULT_SHEETS,
  ...DEFAULT_LUMBER,
  ...DEFAULT_EDGEBAND,
];

export const DEFAULT_HARDWARE: HardwareItem[] = [
  { id: 'hw-hinge-softclose', name: 'Concealed Hinge, Soft-Close (110°)', category: 'hinge', cost: 4.6, unit: 'each' },
  { id: 'hw-hinge-standard', name: 'Concealed Hinge, Standard (no soft-close)', category: 'hinge', cost: 2.4, unit: 'each' },
  { id: 'hw-hinge-inset', name: 'Concealed Hinge, Inset Soft-Close', category: 'hinge', cost: 6.2, unit: 'each' },
  { id: 'hw-hinge-butt', name: 'Butt Hinge, Solid Brass (inset)', category: 'hinge', cost: 8.5, unit: 'each' },

  { id: 'hw-slide-undermount', name: 'Undermount Slide, Soft-Close 21"', category: 'drawerSlide', cost: 28, unit: 'pair' },
  { id: 'hw-slide-undermount-heavy', name: 'Undermount Slide, Heavy Duty 21"', category: 'drawerSlide', cost: 44, unit: 'pair' },
  { id: 'hw-slide-sidemount', name: 'Side Mount Ball Bearing Slide 20"', category: 'drawerSlide', cost: 9.5, unit: 'pair' },
  { id: 'hw-slide-epoxy', name: 'Epoxy Slide 20" (economy)', category: 'drawerSlide', cost: 4.5, unit: 'pair' },

  { id: 'hw-pull-bar', name: 'Bar Pull, 5" CC', category: 'pull', cost: 6.5, unit: 'each' },
  { id: 'hw-pull-cup', name: 'Cup Pull, Solid Brass', category: 'pull', cost: 11, unit: 'each' },
  { id: 'hw-knob-round', name: 'Round Knob 1-1/4"', category: 'knob', cost: 4.25, unit: 'each' },

  { id: 'hw-lazy-susan', name: 'Lazy Susan, 28" Two-Shelf', category: 'accessory', cost: 118, unit: 'set' },
  { id: 'hw-blind-pullout', name: 'Blind Corner Pull-Out (magic corner)', category: 'accessory', cost: 265, unit: 'set' },
  { id: 'hw-corner-hinge', name: 'Corner Hinge, 45° Soft-Close', category: 'hinge', cost: 8.9, unit: 'each' },

  { id: 'hw-shelfpin', name: 'Shelf Pin, 5mm Nickel', category: 'shelfPin', cost: 0.14, unit: 'each' },
  { id: 'hw-leveler', name: 'Leg Leveler', category: 'legLeveler', cost: 1.55, unit: 'each' },
  { id: 'hw-screws', name: 'Cabinet Screws (per cabinet allowance)', category: 'fastener', cost: 2.25, unit: 'set' },
];

export const DEFAULT_FINISHES: FinishSpec[] = [
  { id: 'fin-none', name: 'Unfinished / Field Finished', costPerSqFt: 0 },
  { id: 'fin-prefin-interior', name: 'Prefinished Interior Only', costPerSqFt: 0.15, coatsNote: 'Box interiors prefinished; exteriors handled separately' },
  { id: 'fin-clear-lacquer', name: 'Clear Pre-Cat Lacquer (sealer + 2 coats)', costPerSqFt: 0.85 },
  { id: 'fin-stain-lacquer', name: 'Stain + Clear Lacquer (3 step)', costPerSqFt: 1.35 },
  { id: 'fin-conversion-varnish', name: 'Conversion Varnish', costPerSqFt: 1.6 },
  { id: 'fin-paint-2k', name: 'Primer + 2K Urethane Paint', costPerSqFt: 1.95 },
  { id: 'fin-waterborne', name: 'Waterborne Poly (low VOC)', costPerSqFt: 1.15 },
  { id: 'fin-oil', name: 'Hardwax Oil', costPerSqFt: 0.7 },
];

// --- lookup helpers -------------------------------------------------------

export const isSheet = (m: Material | undefined): m is SheetMaterial => m?.kind === 'sheet';
export const isLumber = (m: Material | undefined): m is LumberMaterial => m?.kind === 'lumber';
export const isEdgeband = (m: Material | undefined): m is EdgebandMaterial => m?.kind === 'edgeband';

export function findMaterial(materials: Material[], id: string): Material | undefined {
  return materials.find((m) => m.id === id);
}

/** Thickness of a material, or 0.75 as a fallback so geometry never NaNs. */
export function materialThickness(materials: Material[], id: string): number {
  const m = findMaterial(materials, id);
  if (!m) return 0.75;
  if (m.kind === 'sheet') return m.thickness;
  if (m.kind === 'lumber') return m.actualThickness;
  return m.thickness;
}

/** Rough hex approximations for 3D shading, keyed by species. */
export const SPECIES_COLOR: Record<string, string> = {
  Birch: '#e5cda9',
  'Baltic Birch': '#e8d5ae',
  Maple: '#eadcbd',
  'Hard Maple': '#eadcbd',
  'Soft Maple': '#e6d7b8',
  'Red Oak': '#d3a273',
  'White Oak': '#c9a878',
  Cherry: '#a95f3c',
  Walnut: '#5a3a26',
  Hickory: '#d9b183',
  Ash: '#ddc7a1',
  Alder: '#c8926a',
  Poplar: '#cfc9a4',
  Mahogany: '#8c4530',
  Pine: '#e3c894',
  MDF: '#b09a80',
  Melamine: '#f2f2f0',
  Particleboard: '#c3ab88',
  PVC: '#f2f2f0',
};

export function speciesColor(species: string): string {
  return SPECIES_COLOR[species] ?? '#d8c19b';
}

/**
 * Darken a hex colour toward black. Used for recessed surfaces like the toe
 * kick, which need to read as "in shadow" rather than as a hard black hole
 * punched through a light-coloured presentation render.
 */
export function darken(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const k = Math.max(0, Math.min(1, 1 - amount));
  const r = Math.round(((n >> 16) & 0xff) * k);
  const g = Math.round(((n >> 8) & 0xff) * k);
  const b = Math.round((n & 0xff) * k);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
