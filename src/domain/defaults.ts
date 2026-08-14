import type {
  Appliance,
  ApplianceKind,
  BarTop,
  Cabinet,
  CabinetType,
  ConstructionSpec,
  CrownSpec,
  DrawerSpec,
  LaborRates,
  LightRailSpec,
  PricingSettings,
  Project,
  RoomSpec,
  ViewSettings,
  Wall,
  WindowOpening,
} from './types';
import { DEFAULT_FINISHES, DEFAULT_HARDWARE, DEFAULT_MATERIALS } from './materials';

export const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Industry-standard defaults. Every one of these is editable per project.
 * The face-frame numbers assume 3/4" hardwood at 1-1/2" wide, which is the
 * most common American cabinet shop setup.
 */
export const DEFAULT_CONSTRUCTION: ConstructionSpec = {
  construction: 'frameless',
  doorMount: 'fullOverlay',

  revealEdge: 1 / 16,
  revealBetween: 1 / 8,
  overlay: 1 / 2,

  frameStileWidth: 1.5,
  frameRailWidth: 1.5,
  frameThickness: 0.75,
  /*
   * The frame runs 1/4" proud of the box on each buried side, so a run has
   * half an inch of give between boxes. Nothing on site is square, and a run
   * built to the exact opening is a run that does not go in.
   */
  frameOverhang: 0.25,

  // A stile, not a filler. 1-1/2" reads as cabinetwork and still clears.
  cornerFrameWidth: 1.5,
  // Fronts lap half of it, leaving 1" a side exposed as the working clearance.
  cornerFrameOverlay: 0.5,

  drawerBottomGroove: 0.25,
  panelGroove: 3 / 8,
  panelFloat: 1 / 8,
  crownTopRailWidth: 3,

  backStyle: 'rabbeted',
  backJoineryDepth: 0.25,

  // Butt-and-screw, which is what the app has always cut parts for. Switching
  // to dado lengthens the deck, top and fixed shelves to suit.
  carcassJoinery: 'butt',
  carcassDadoDepth: 0.25,

  baseTopStyle: 'stretchers',
  stretcherWidth: 4,

  toeKickHeight: 4.5,
  toeKickDepth: 3,
  toeKickFinish: 'box',
  toeKickPaintColor: '#26282c',

  shelfSetback: 0.25,
  shelfSideClearance: 1 / 8,

  drawerSlideClearance: 0.5,
  drawerBoxDepthReduction: 3,
  drawerBoxHeightReduction: 0.5,
  drawerBottomGrooveUp: 0.5,

  cornerFillerWidth: 3,
  kerf: 1 / 8,
  sheetTrim: 0.25,
};

export const DEFAULT_LABOR: LaborRates = {
  shopRatePerHour: 75,
  installRatePerHour: 85,
  designRatePerHour: 95,

  hoursPerBaseCabinet: 2.5,
  hoursPerWallCabinet: 2.0,
  hoursPerTallCabinet: 4.0,

  hoursPerDoor: 0.75,
  hoursPerDrawer: 1.1,
  hoursPerFinishedEnd: 0.4,
  hoursPerFaceFrame: 0.9,
  hoursPerCornerCabinet: 1.5,
  hoursPerCrownFoot: 0.18,
  hoursPerAppliancePanel: 0.9,
  hoursPerBarWallFoot: 0.35,

  finishHoursPerSqFt: 0.05,

  hoursPerCabinetInstall: 1.0,
  designHoursFlat: 4,
  designHoursPerCabinet: 0.35,
};

export const DEFAULT_PRICING: PricingSettings = {
  sheetWasteFactor: 0.1,
  lumberWasteFactor: 0.3,
  consumablesPct: 0.05,

  overheadPct: 0.2,
  contingencyPct: 0.05,
  targetMarginPct: 0.35,

  salesTaxPct: 0,
  taxLabor: false,

  deliveryFlat: 0,
  depositPct: 0.5,
};

// ---------------------------------------------------------------------------
// Standard cabinet dimensions
// ---------------------------------------------------------------------------

export const STANDARD_DIMS: Record<CabinetType, { height: number; depth: number; width: number }> = {
  // 34-1/2" box + 1-1/2" counter = 36" finished height
  base: { height: 34.5, depth: 24, width: 24 },
  wall: { height: 30, depth: 12, width: 24 },
  tall: { height: 84, depth: 24, width: 24 },
  vanity: { height: 31.5, depth: 21, width: 30 },
  filler: { height: 34.5, depth: 24, width: 3 },
};

export interface CabinetPreset {
  key: string;
  label: string;
  type: CabinetType;
  description: string;
  build: (base: Cabinet, spec: ConstructionSpec) => Cabinet;
}

/**
 * Size a drawer stack so the fronts exactly fill the face, whatever the
 * cabinet height and reveal settings happen to be. `weights` sets the
 * relative proportions; the last front absorbs the rounding remainder so
 * the stack sums precisely rather than drifting a sixteenth.
 *
 * When `doorReserve` is given, that much face height is held back for a
 * door below the stack.
 */
export function fitDrawerHeights(
  cabinet: Pick<Cabinet, 'height' | 'type'>,
  spec: ConstructionSpec,
  weights: number[],
  doorReserve = 0,
): DrawerSpec[] {
  const kick = cabinet.type === 'wall' ? 0 : spec.toeKickHeight;
  const faceZone = cabinet.height - kick;
  const rows = weights.length + (doorReserve > 0 ? 1 : 0);
  const gaps = Math.max(0, rows - 1);
  const available = faceZone - 2 * spec.revealEdge - gaps * spec.revealBetween - doorReserve;

  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const sixteenth = (n: number) => Math.round(n * 16) / 16;

  const heights: number[] = [];
  let used = 0;
  weights.forEach((w, i) => {
    if (i === weights.length - 1) {
      heights.push(sixteenth(available - used));
    } else {
      const h = sixteenth((w / totalWeight) * available);
      heights.push(h);
      used += h;
    }
  });

  return heights.map((h) => ({ id: uid(), frontHeight: Math.max(2, h) }));
}

const drawerStack = (heights: number[]) =>
  heights.map((h) => ({ id: uid(), frontHeight: h }));

export const CABINET_PRESETS: CabinetPreset[] = [
  {
    key: 'base-2door',
    label: 'Base — 2 Door, 1 Shelf',
    type: 'base',
    description: '24" wide standard base with a pair of doors and one adjustable shelf.',
    build: (c) => ({ ...c, doorCount: 2, drawers: [], shelfCount: 1, adjustableShelves: true }),
  },
  {
    key: 'base-1door',
    label: 'Base — 1 Door, 1 Shelf',
    type: 'base',
    description: 'Narrow base, single door. Use under 21" wide.',
    build: (c) => ({ ...c, width: 18, doorCount: 1, drawers: [], shelfCount: 1, adjustableShelves: true }),
  },
  {
    key: 'base-door-drawer',
    label: 'Base — Drawer over 2 Doors',
    type: 'base',
    description: 'The workhorse: one top drawer over a two-door cabinet.',
    build: (c) => ({ ...c, doorCount: 2, drawers: drawerStack([6]), shelfCount: 1, adjustableShelves: true }),
  },
  {
    key: 'base-3drawer',
    label: 'Base — 3 Drawer',
    type: 'base',
    description: 'Three graduated drawers, no doors. Fronts size to fill the cabinet.',
    build: (c, spec) => ({
      ...c,
      doorCount: 0,
      drawers: fitDrawerHeights(c, spec, [1, 1.55, 1.75]),
      shelfCount: 0,
      adjustableShelves: false,
    }),
  },
  {
    key: 'base-4drawer',
    label: 'Base — 4 Drawer',
    type: 'base',
    description: 'Four drawers for utensils and flatware. Fronts size to fill the cabinet.',
    build: (c, spec) => ({
      ...c,
      doorCount: 0,
      drawers: fitDrawerHeights(c, spec, [1, 1.2, 1.35, 1.35]),
      shelfCount: 0,
      adjustableShelves: false,
    }),
  },
  {
    key: 'base-sink',
    label: 'Base — Sink (2 Door, no shelf)',
    type: 'base',
    description: '36" sink base with a false front, undermount bowl and faucet.',
    build: (c) => ({
      ...c,
      width: 36,
      doorCount: 2,
      drawers: [{ id: uid(), frontHeight: 6, falseFront: true }],
      shelfCount: 0,
      adjustableShelves: false,
      sink: { style: 'undermount', width: 30, frontToBack: 18, bowlDepth: 9, apronHeight: 10, faucet: true },
      notes: 'Top panel is a false front — the sink bowl leaves no room for a box',
    }),
  },
  {
    key: 'base-sink-farmhouse',
    label: 'Base — Farmhouse Sink',
    type: 'base',
    description: '36" apron-front sink base. The apron replaces the top of the face, so the doors run shorter.',
    build: (c) => ({
      ...c,
      width: 36,
      doorCount: 2,
      drawers: [],
      shelfCount: 0,
      adjustableShelves: false,
      sink: { style: 'farmhouse', width: 30, frontToBack: 19, bowlDepth: 10, apronHeight: 10, faucet: true },
      notes: 'Apron front — check the bowl weight and build a support ledge for it',
    }),
  },
  {
    key: 'filler-base',
    label: 'Filler — Base',
    type: 'filler',
    description: 'Scribe strip closing a base run to a wall or appliance. Cut it oversize and scribe on site.',
    build: (c) => ({ ...c, width: 3, height: 34.5, depth: 24, doorCount: 0, drawers: [], shelfCount: 0 }),
  },
  {
    key: 'filler-wall',
    label: 'Filler — Wall',
    type: 'filler',
    description: 'Scribe strip for a wall run.',
    build: (c) => ({ ...c, width: 3, height: 30, depth: 12, doorCount: 0, drawers: [], shelfCount: 0 }),
  },
  {
    key: 'base-corner-diagonal',
    label: 'Base — Diagonal Corner',
    type: 'base',
    description: '36" x 36" lazy-susan corner. The 45° face carries a single 17" door.',
    build: (c) => ({
      ...c,
      width: 36,
      depth: 24,
      corner: 'diagonal',
      doorCount: 1,
      hingeSide: 'right',
      drawers: [],
      shelfCount: 1,
      adjustableShelves: false,
      notes: 'Confirm the lazy susan diameter before building',
    }),
  },
  {
    key: 'base-corner-blind',
    label: 'Base — Blind Corner',
    type: 'base',
    description: '48" box running into the corner; 24" of it is blind behind the returning run.',
    build: (c) => ({
      ...c,
      width: 48,
      depth: 24,
      corner: 'blind',
      blindWidth: 24,
      blindSide: 'left',
      doorCount: 1,
      hingeSide: 'right',
      drawers: [],
      shelfCount: 1,
      adjustableShelves: true,
      notes: 'Leave pull-out clearance; blind section is only reachable through the opening',
    }),
  },
  {
    key: 'wall-corner-diagonal',
    label: 'Wall — Diagonal Corner',
    type: 'wall',
    description: '24" x 24" angled corner wall cabinet with a single door on the 45° face.',
    build: (c) => ({
      ...c,
      width: 24,
      depth: 12,
      corner: 'diagonal',
      doorCount: 1,
      hingeSide: 'right',
      drawers: [],
      shelfCount: 2,
      adjustableShelves: true,
    }),
  },
  {
    key: 'wall-corner-blind',
    label: 'Wall — Blind Corner',
    type: 'wall',
    description: '36" wall cabinet running into the corner, 12" blind.',
    build: (c) => ({
      ...c,
      width: 36,
      depth: 12,
      corner: 'blind',
      blindWidth: 12,
      blindSide: 'left',
      doorCount: 1,
      hingeSide: 'right',
      drawers: [],
      shelfCount: 2,
      adjustableShelves: true,
    }),
  },
  {
    key: 'wall-2door',
    label: 'Wall — 2 Door, 2 Shelves',
    type: 'wall',
    description: '30" tall wall cabinet with two adjustable shelves.',
    build: (c) => ({ ...c, doorCount: 2, drawers: [], shelfCount: 2, adjustableShelves: true }),
  },
  {
    key: 'wall-1door',
    label: 'Wall — 1 Door, 2 Shelves',
    type: 'wall',
    description: 'Narrow wall cabinet, single door.',
    build: (c) => ({ ...c, width: 18, doorCount: 1, drawers: [], shelfCount: 2, adjustableShelves: true }),
  },
  {
    key: 'wall-open',
    label: 'Wall — Open Shelving',
    type: 'wall',
    description: 'No doors. Finished interior, exposed shelves.',
    build: (c) => ({ ...c, doorCount: 0, drawers: [], shelfCount: 2, adjustableShelves: false }),
  },
  {
    key: 'wall-microwave',
    label: 'Wall — Microwave Bridge',
    type: 'wall',
    description:
      '30" bridge sized to hang an over-range microwave beneath it, with the clearance a listed unit needs over a range.',
    build: (c) => ({
      ...c,
      width: 30,
      height: 12,
      depth: 15,
      // Hang it so a 17" microwave underneath still clears a 36" range by 30".
      mountHeight: bridgeBottomForMicrowave(),
      doorCount: 2,
      drawers: [],
      shelfCount: 0,
      adjustableShelves: false,
      notes: 'Hung to clear a 17" microwave over a 36" range. Verify against the actual model.',
    }),
  },
  {
    key: 'tall-pantry',
    label: 'Tall — Pantry, 4 Shelves',
    type: 'tall',
    description: '84" pantry with two doors and four adjustable shelves.',
    build: (c) => ({ ...c, doorCount: 2, drawers: [], shelfCount: 4, adjustableShelves: true }),
  },
  {
    key: 'tall-oven',
    label: 'Tall — Oven Cabinet',
    type: 'tall',
    description:
      '30" cabinet with a 28-1/2" oven pocket at 30", drawers below and a door above. Doors resize to suit the opening.',
    build: (c) => ({
      ...c,
      width: 30,
      doorCount: 2,
      // Two drawers fill the space under the oven; the pocket sets their size.
      drawers: drawerStack([12, 12]),
      shelfCount: 0,
      adjustableShelves: false,
      oven: { count: 1, width: 28.5, openingHeight: 28.5, bottomHeight: 30, showAppliance: true },
      notes: 'Confirm the rough opening against the oven spec sheet before cutting',
    }),
  },
  {
    key: 'tall-oven-double',
    label: 'Tall — Double Oven Cabinet',
    type: 'tall',
    description: '30" cabinet with a 50" stacked pocket at 24", a drawer below and a short door above.',
    build: (c) => ({
      ...c,
      width: 30,
      doorCount: 2,
      drawers: drawerStack([18]),
      shelfCount: 0,
      adjustableShelves: false,
      oven: { count: 2, width: 28.5, openingHeight: 50, bottomHeight: 24, showAppliance: true },
      notes: 'Double stack — confirm the combined rough opening against the spec sheet',
    }),
  },
  {
    key: 'vanity-2door',
    label: 'Vanity — 2 Door',
    type: 'vanity',
    description: '31-1/2" tall vanity base with a pair of doors.',
    build: (c) => ({ ...c, doorCount: 2, drawers: [], shelfCount: 1, adjustableShelves: true }),
  },
  {
    key: 'vanity-drawers',
    label: 'Vanity — Door + 3 Drawer Bank',
    type: 'vanity',
    description: 'Vanity with a drawer stack. Widen to 48"+ for a double bank.',
    build: (c, spec) => ({
      ...c,
      width: 36,
      doorCount: 0,
      drawers: fitDrawerHeights(c, spec, [1, 1.25, 1.25]),
      shelfCount: 0,
      adjustableShelves: false,
    }),
  },
];

// ---------------------------------------------------------------------------
// Appliances
// ---------------------------------------------------------------------------

export interface AppliancePreset {
  key: string;
  label: string;
  kind: ApplianceKind;
  width: number;
  height: number;
  depth: number;
  mountHeight: number;
  panelReady?: boolean;
  panelCount?: number;
  note?: string;
}

/**
 * Nominal sizes. Always confirm against the actual model's spec sheet —
 * a rough opening that is a quarter inch tight is a rebuild.
 */
export const APPLIANCE_PRESETS: AppliancePreset[] = [
  { key: 'range-30', label: 'Range 30"', kind: 'range', width: 30, height: 36, depth: 25, mountHeight: 0 },
  { key: 'range-36', label: 'Range 36" (pro)', kind: 'range', width: 36, height: 36, depth: 27, mountHeight: 0 },
  { key: 'range-48', label: 'Range 48" (pro)', kind: 'range', width: 48, height: 36, depth: 27, mountHeight: 0 },
  { key: 'cooktop-30', label: 'Cooktop 30"', kind: 'cooktop', width: 30, height: 4, depth: 21, mountHeight: 34.5 },
  { key: 'wall-oven-30', label: 'Wall Oven 30"', kind: 'wallOven', width: 30, height: 29, depth: 24, mountHeight: 30 },
  { key: 'wall-oven-double', label: 'Double Wall Oven 30"', kind: 'wallOven', width: 30, height: 50, depth: 24, mountHeight: 18 },
  { key: 'fridge-36', label: 'Refrigerator 36"', kind: 'refrigerator', width: 36, height: 70, depth: 30, mountHeight: 0 },
  { key: 'fridge-36-panel', label: 'Refrigerator 36" (panel ready)', kind: 'refrigerator', width: 36, height: 84, depth: 25, mountHeight: 0, panelReady: true, panelCount: 2, note: 'French door — two panels' },
  { key: 'fridge-counter-depth', label: 'Counter-Depth Fridge 33"', kind: 'refrigerator', width: 33, height: 70, depth: 25, mountHeight: 0 },
  { key: 'dw-24', label: 'Dishwasher 24"', kind: 'dishwasher', width: 24, height: 34, depth: 24, mountHeight: 0 },
  { key: 'dw-24-panel', label: 'Dishwasher 24" (panel ready)', kind: 'dishwasher', width: 24, height: 34, depth: 24, mountHeight: 0, panelReady: true, panelCount: 1 },
  // Sinks are not in this list on purpose. A sink sits in the countertop and
  // changes how its cabinet is built, so it belongs to the cabinet — put one
  // there and it follows the run, the gap maths and the cut list properly.
  // Standing one on the floor here fought all three.
  { key: 'micro-otr', label: 'Over-Range Microwave 30"', kind: 'microwave', width: 30, height: 17, depth: 15, mountHeight: 66 },
  { key: 'micro-drawer', label: 'Microwave Drawer 24"', kind: 'microwave', width: 24, height: 15, depth: 23, mountHeight: 12 },
  { key: 'hood-30', label: 'Hood 30"', kind: 'hood', width: 30, height: 24, depth: 20, mountHeight: 66 },
  { key: 'hood-36', label: 'Hood 36"', kind: 'hood', width: 36, height: 24, depth: 22, mountHeight: 66 },
  { key: 'wine-24', label: 'Wine Fridge 24"', kind: 'wineFridge', width: 24, height: 34, depth: 24, mountHeight: 0 },
];

export const APPLIANCE_COLOR: Record<ApplianceKind, string> = {
  range: '#5a6068',
  cooktop: '#3f4348',
  wallOven: '#5a6068',
  refrigerator: '#6b7280',
  dishwasher: '#646b74',
  sink: '#8a9099',
  microwave: '#4f555c',
  hood: '#727880',
  wineFridge: '#4a5058',
  other: '#5a6068',
};

export function makeAppliance(preset: AppliancePreset, x = 0, z = 0): Appliance {
  return {
    id: uid(),
    name: preset.label,
    kind: preset.kind,
    width: preset.width,
    height: preset.height,
    depth: preset.depth,
    x,
    z,
    rotation: 0,
    mountHeight: preset.mountHeight,
    panelReady: preset.panelReady,
    panelCount: preset.panelCount,
    notes: preset.note,
  };
}

export const DEFAULT_CROWN: CrownSpec = {
  enabled: false,
  name: 'Crown Moulding',
  height: 3.5,
  projection: 2.5,
  overlap: 1,
  materialId: 'lbr-hardmaple-44',
  costPerLinearFoot: 6.5,
  millInShop: false,
  wasteFactor: 0.2,
};

export const DEFAULT_VIEW: ViewSettings = {
  background: '#14161a',
  wallColor: '#2a2e35',
  floorColor: '#1a1d22',
  counterColor: '#3c4048',
  showGrid: true,
  showWalls: true,
  showCountertops: true,
  brightness: 1,
};

/**
 * Presentation presets. Dark reads well on screen in a shop; the light ones
 * are for showing a client, where a bright room looks like a real kitchen and
 * prints better.
 */
export const VIEW_PRESETS: { key: string; label: string; description: string; view: ViewSettings }[] = [
  {
    key: 'shop-dark',
    label: 'Shop Dark',
    description: 'The working default — easy on the eyes over a long session.',
    view: { ...DEFAULT_VIEW },
  },
  {
    key: 'charcoal',
    label: 'Charcoal',
    description: 'Softer greys, less contrast against pale timber.',
    view: {
      ...DEFAULT_VIEW,
      background: '#22252a',
      wallColor: '#3a3f46',
      floorColor: '#2b2f35',
      counterColor: '#4a5057',
      brightness: 1.05,
    },
  },
  {
    key: 'studio-light',
    label: 'Studio Light',
    description: 'White studio backdrop. Best for a client presentation.',
    view: {
      ...DEFAULT_VIEW,
      background: '#eceef1',
      wallColor: '#f4f5f7',
      floorColor: '#d9dce0',
      counterColor: '#5b6169',
      brightness: 1.25,
    },
  },
  {
    key: 'warm-room',
    label: 'Warm Room',
    description: 'Painted walls and a warm floor — reads like a finished kitchen.',
    view: {
      ...DEFAULT_VIEW,
      background: '#d8d2c8',
      wallColor: '#e8e2d6',
      floorColor: '#9c7d5c',
      counterColor: '#3a3d42',
      brightness: 1.2,
    },
  },
  {
    key: 'blueprint',
    label: 'Blueprint',
    description: 'Cool and flat, for drawings rather than renders.',
    view: {
      ...DEFAULT_VIEW,
      background: '#16283a',
      wallColor: '#1f3b52',
      floorColor: '#1b2f44',
      counterColor: '#2c4a63',
      brightness: 1.1,
    },
  },
];

export const DEFAULT_LIGHT_RAIL: LightRailSpec = {
  enabled: false,
  height: 1.5,
  projection: 0.75,
  costPerLinearFoot: 3.25,
};

/**
 * Clearance above a cooking surface. These are two different rules and they
 * are easy to conflate:
 *
 *  - A hood or over-range microwave is *listed* for the job and mounts much
 *    closer. Manufacturers typically call for around 20", so that is the
 *    figure used here.
 *  - A bare cabinet with nothing protecting its underside wants the full 30".
 */
export const COOKTOP_TO_OVERHEAD_UNIT = 20;
export const COOKTOP_TO_BARE_CABINET = 30;
/** Below this, even a listed unit is too low. */
export const COOKTOP_CLEARANCE_MINIMUM = 18;
/** A typical over-the-range microwave. Always check the actual model. */
export const OTR_MICROWAVE_HEIGHT = 17;

/**
 * Where the underside of a microwave cabinet has to sit if an over-range
 * microwave is going to hang beneath it and still clear the range.
 *
 * Worth knowing before you design the run: a 36" range plus 30" of clearance
 * plus a 17" microwave puts the cabinet's bottom at 83". A wall run of 30"
 * cabinets tops out at 84", which leaves one inch — not a cabinet. Kitchens
 * that carry a microwave *and* a cabinet over the range run their uppers to
 * 90" or 96", not 84".
 */
export function bridgeBottomForMicrowave(
  rangeTop = 36,
  microwaveHeight = OTR_MICROWAVE_HEIGHT,
  clearance = COOKTOP_TO_OVERHEAD_UNIT,
): number {
  return rangeTop + clearance + microwaveHeight;
}

/** Standard bottom of a wall run: 18" of backsplash over a 36" counter. */
export const WALL_CABINET_BOTTOM = 54;
/** The line a wall run tops out on when it starts from that bottom. */
export const DEFAULT_WALL_TOP = WALL_CABINET_BOTTOM + STANDARD_DIMS.wall.height;

/**
 * Where a new wall cabinet should hang.
 *
 * Wall runs are read as a single line across the top, so a short cabinet — a
 * microwave bridge over a range, say — hangs so its *top* matches the rest of
 * the run rather than its bottom. That is why an 18" bridge lands at 66" and
 * not 54".
 *
 * A taller cabinet aligned that way would drop below the counter, so anything
 * that would end up unreasonably low falls back to the standard bottom.
 */
export function wallMountHeight(height: number, existing: Cabinet[]): number {
  const run = existing.filter((c) => c.type === 'wall' && !c.excluded);
  const top = run.length
    ? Math.max(...run.map((c) => (c.mountHeight ?? WALL_CABINET_BOTTOM) + c.height))
    : DEFAULT_WALL_TOP;

  const aligned = top - height;
  return aligned < WALL_CABINET_BOTTOM - 6 ? WALL_CABINET_BOTTOM : aligned;
}

export function makeCabinet(
  type: CabinetType,
  project: Pick<
    Project,
    | 'defaultBoxMaterialId'
    | 'defaultFaceMaterialId'
    | 'defaultBackMaterialId'
    | 'defaultDrawerBoxMaterialId'
    | 'defaultDrawerBottomMaterialId'
    | 'defaultEdgebandId'
  >,
  overrides: Partial<Cabinet> = {},
): Cabinet {
  const dims = STANDARD_DIMS[type];
  return {
    id: uid(),
    name: `${type[0].toUpperCase()}${type.slice(1)} Cabinet`,
    type,
    width: dims.width,
    height: dims.height,
    depth: dims.depth,
    x: 0,
    z: 0,
    rotation: 0,
    mountHeight: type === 'wall' ? 54 : 0,
    boxMaterialId: project.defaultBoxMaterialId,
    faceMaterialId: project.defaultFaceMaterialId,
    backMaterialId: project.defaultBackMaterialId,
    drawerBoxMaterialId: project.defaultDrawerBoxMaterialId,
    drawerBottomMaterialId: project.defaultDrawerBottomMaterialId,
    edgebandId: project.defaultEdgebandId,
    doorCount: 2,
    drawers: [],
    shelfCount: 1,
    adjustableShelves: true,
    finishedLeft: false,
    finishedRight: false,
    hingeId: 'hw-hinge-softclose',
    pullId: 'hw-pull-bar',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Room shapes
// ---------------------------------------------------------------------------

export type RoomShape = 'singleWall' | 'lShape' | 'uShape' | 'galley' | 'closed';

export const ROOM_SHAPES: { key: RoomShape; label: string; description: string }[] = [
  { key: 'singleWall', label: 'Single Wall', description: 'One run along a single wall.' },
  { key: 'lShape', label: 'L-Shape', description: 'Two walls meeting at a corner.' },
  { key: 'uShape', label: 'U-Shape', description: 'Three walls — the classic working kitchen.' },
  { key: 'galley', label: 'Galley', description: 'Two facing runs with an aisle between.' },
  { key: 'closed', label: 'Closed Room', description: 'Four walls. Delete or drag any you do not need.' },
];

/**
 * Walls are plain segments, so any polygon is valid. These are starting
 * points — drag the endpoints in the plan view or type exact coordinates.
 */
/**
 * A raised bar behind a base run.
 *
 * Defaults are the common build: a 42" bar off a 36" counter, framed 4-1/2"
 * thick, with 12" of knee room on the seating side — the depth a stool needs.
 */
export function makeBarTop(project: Project, overrides: Partial<BarTop> = {}): BarTop {
  return {
    id: uid(),
    name: 'Bar Top',
    x: 0,
    z: 0,
    rotation: 0,
    length: 72,
    wallHeight: 42,
    thickness: 4.5,
    offset: 0,
    overhangFront: 12,
    overhangBack: 1.5,
    overhangLeft: 0,
    overhangRight: 0,
    topThickness: 1.5,
    panelStyle: 'shaker',
    panelMaterialId: project.defaultFaceMaterialId,
    ...overrides,
  };
}

/**
 * A window opening. Defaults to a common double-hung over a counter: 36" wide,
 * 48" tall, sill at 42" so it clears a 36" counter and its backsplash.
 */
export function makeWindow(wallId: string, overrides: Partial<WindowOpening> = {}): WindowOpening {
  return {
    id: uid(),
    name: 'Window',
    wallId,
    along: 24,
    width: 36,
    height: 48,
    sillHeight: 42,
    casingWidth: 3.5,
    ...overrides,
  };
}

export function makeRoom(shape: RoomShape, width = 168, depth = 144, height = 96): RoomSpec {
  const w = (x1: number, z1: number, x2: number, z2: number): Wall => ({
    id: uid(),
    x1,
    z1,
    x2,
    z2,
    height,
    thickness: 4.5,
  });

  let walls: Wall[];
  switch (shape) {
    case 'singleWall':
      walls = [w(0, 0, width, 0)];
      break;
    case 'uShape':
      walls = [w(0, depth, 0, 0), w(0, 0, width, 0), w(width, 0, width, depth)];
      break;
    case 'galley':
      walls = [w(0, 0, width, 0), w(0, depth, width, depth)];
      break;
    case 'closed':
      walls = [
        w(0, 0, width, 0),
        w(width, 0, width, depth),
        w(width, depth, 0, depth),
        w(0, depth, 0, 0),
      ];
      break;
    case 'lShape':
    default:
      walls = [w(0, 0, width, 0), w(0, 0, 0, depth)];
      break;
  }
  return { walls, ceilingHeight: height };
}

export function makeProject(name = 'New Project'): Project {
  const now = new Date().toISOString();
  const base: Pick<
    Project,
    | 'defaultBoxMaterialId'
    | 'defaultFaceMaterialId'
    | 'defaultBackMaterialId'
    | 'defaultDrawerBoxMaterialId'
    | 'defaultDrawerBottomMaterialId'
    | 'defaultEdgebandId'
  > = {
    defaultBoxMaterialId: 'ply-prefin-maple-34',
    defaultFaceMaterialId: 'lbr-hardmaple-44',
    defaultBackMaterialId: 'ply-prefin-maple-12',
    defaultDrawerBoxMaterialId: 'bb-12',
    defaultDrawerBottomMaterialId: 'bb-14',
    defaultEdgebandId: 'eb-maple-pg',
  };

  return {
    id: uid(),
    name,
    client: '',
    address: '',
    createdAt: now,
    updatedAt: now,
    room: makeRoom('lShape'),
    cabinets: [],
    appliances: [],
    barTops: [],
    windows: [],
    crown: { ...DEFAULT_CROWN },
    lightRail: { ...DEFAULT_LIGHT_RAIL },
    view: { ...DEFAULT_VIEW },
    defaults: { ...DEFAULT_CONSTRUCTION },
    ...base,
    materials: DEFAULT_MATERIALS.map((m) => ({ ...m })),
    hardware: DEFAULT_HARDWARE.map((h) => ({ ...h })),
    finishes: DEFAULT_FINISHES.map((f) => ({ ...f })),
    selectedFinishId: 'fin-stain-lacquer',
    labor: { ...DEFAULT_LABOR },
    pricing: { ...DEFAULT_PRICING },
    extras: [],
  };
}
