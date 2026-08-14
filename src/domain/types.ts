/** Core data model. All linear dimensions are decimal inches. */

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export type MaterialKind = 'sheet' | 'lumber' | 'edgeband';

/** Sheet goods: plywood, MDF, melamine, particleboard. Priced per sheet. */
export interface SheetMaterial {
  id: string;
  kind: 'sheet';
  name: string;
  species: string;
  thickness: number;
  sheetWidth: number;
  sheetLength: number;
  /** Cost of one full sheet, delivered. */
  costPerSheet: number;
  /** Directional face veneer — parts may not be rotated when nesting. */
  hasGrain: boolean;
  /** Shows on finished surfaces; drives edgebanding and finish decisions. */
  finishGrade: 'paint' | 'stain' | 'prefinished' | 'melamine' | 'utility';
  notes?: string;
}

/** Solid hardwood/softwood. Priced per board foot at a nominal thickness. */
export interface LumberMaterial {
  id: string;
  kind: 'lumber';
  name: string;
  species: string;
  /** Nominal thickness as sold: 1 = 4/4, 1.25 = 5/4, 2 = 8/4. */
  nominalThickness: number;
  /** Actual thickness after surfacing — what you design to. */
  actualThickness: number;
  costPerBoardFoot: number;
  hasGrain: true;
  /** Typical usable length of stock on the rack, for rough-cut planning. */
  stockLength: number;
  /** Typical usable width, for ripping plans. */
  stockWidth: number;
  notes?: string;
}

/** Edgebanding, priced per linear foot. */
export interface EdgebandMaterial {
  id: string;
  kind: 'edgeband';
  name: string;
  species: string;
  thickness: number;
  width: number;
  costPerLinearFoot: number;
  notes?: string;
}

export type Material = SheetMaterial | LumberMaterial | EdgebandMaterial;

// ---------------------------------------------------------------------------
// Hardware
// ---------------------------------------------------------------------------

export type HardwareCategory =
  | 'hinge'
  | 'drawerSlide'
  | 'pull'
  | 'knob'
  | 'shelfPin'
  | 'legLeveler'
  | 'fastener'
  | 'accessory';

export interface HardwareItem {
  id: string;
  name: string;
  category: HardwareCategory;
  /** Cost of one unit as counted (a pair of slides counts as one unit). */
  cost: number;
  unit: 'each' | 'pair' | 'set' | 'box';
  /** For a 'box' unit, how many pieces the box contains. */
  perBox?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Construction settings
// ---------------------------------------------------------------------------

export type Construction = 'faceFrame' | 'frameless';
export type DoorMount = 'fullOverlay' | 'halfOverlay' | 'inset';
export type BackStyle = 'applied' | 'rabbeted' | 'dadoed' | 'none';
export type TopStyle = 'full' | 'stretchers';
/** How the deck, top and fixed shelves are joined to the sides. */
export type CarcassJoinery = 'butt' | 'dado';

export interface ConstructionSpec {
  construction: Construction;
  doorMount: DoorMount;

  /** Reveal around doors on exposed edges (frameless / inset). */
  revealEdge: number;
  /** Gap between a pair of doors, or between stacked drawer fronts. */
  revealBetween: number;
  /** Face-frame overlay: how far the door laps onto the frame per side. */
  overlay: number;

  /** Face frame stock. */
  frameStileWidth: number;
  frameRailWidth: number;
  frameThickness: number;
  /**
   * How far the face frame stands proud of the box on each side.
   *
   * A frame cut flush with the carcass leaves nothing to scribe and no cover
   * for the joint where two cabinets meet, so shops routinely run it a
   * sixteenth to a quarter over. Zero keeps the frame flush, which is what the
   * app built before this was a choice. Sides only — the top and bottom stay
   * flush, since a counter or a soffit lands on them.
   */
  frameOverhang: number;

  /**
   * Width of the narrow face frame a frameless diagonal corner carries on its
   * 45 degree face, and of the matching return stile on whatever butts it.
   *
   * A frameless corner has no frame to hold its door back, so its door and the
   * fronts on both adjoining runs all stand proud into the same corner. A pair
   * of stiles mitred into the box — and a matching strip on the neighbour's
   * abutting end — buys the clearance between them without the slab of filler
   * that reads as a mistake in the drawing.
   */
  cornerFrameWidth: number;
  /**
   * How far a front laps onto that corner stile, per side.
   *
   * The stile only has to hold the two fronts apart, not stay fully visible.
   * Letting each front cover part of it wins the face width back and keeps the
   * frameless look, while what is left exposed is the actual clearance. The
   * gap between the two fronts is what remains of both stiles after this.
   */
  cornerFrameOverlay: number;

  /**
   * Depth a drawer bottom sits into its groove, all round. The panel is cut to
   * the opening plus twice this, so grooving deeper without changing it here
   * leaves the bottom short and the box racks.
   */
  drawerBottomGroove: number;
  /**
   * Depth a shaker or raised field sits into the groove in its rails and
   * stiles, and the slack left so a solid field can move with the seasons.
   * Too little float is what splits a frame in a dry winter.
   */
  panelGroove: number;
  panelFloat: number;
  /**
   * Top rail width on a cabinet carrying crown. A standard 1-1/2" rail gives
   * the moulding almost nothing to fasten to once it laps the cabinet top,
   * so crowned uppers run a wider one.
   */
  crownTopRailWidth: number;

  backStyle: BackStyle;
  /** Depth the back panel sits into a rabbet or dado. */
  backJoineryDepth: number;

  /**
   * How the deck, top and fixed shelves meet the sides.
   *
   * `butt` captures them between the sides and fastens through — the part is
   * cut to the interior width. `dado` housed them in a groove, which means
   * every one of those parts has to be cut longer by the groove depth at each
   * end or the box comes up narrow.
   */
  carcassJoinery: CarcassJoinery;
  carcassDadoDepth: number;

  /** Base cabinets: full top panel, or front+back stretchers. */
  baseTopStyle: TopStyle;
  stretcherWidth: number;

  toeKickHeight: number;
  toeKickDepth: number;
  /**
   * What the toe kick face is made of.
   *  - 'box'     cut from the carcass sheet. Cheapest, and fine when the kick
   *              is not really seen.
   *  - 'face'    cut from the door material so an exposed kick matches the
   *              fronts. Standard on custom work with visible toe space.
   *  - 'painted' cut from the carcass sheet and painted out, usually near
   *              black, so the cabinets read as floating.
   */
  toeKickFinish: 'box' | 'face' | 'painted';
  /** Colour used when the kick is painted out. */
  toeKickPaintColor: string;

  /** Setback of shelves from the front edge. */
  shelfSetback: number;
  /** Total side-to-side clearance for adjustable shelves. */
  shelfSideClearance: number;

  /** Per-side clearance for drawer slides (1/2" is standard). */
  drawerSlideClearance: number;
  /** Drawer box depth is cabinet depth less this. */
  drawerBoxDepthReduction: number;
  drawerBoxHeightReduction: number;
  /** Drawer bottom sits in a groove this far up from the box bottom. */
  drawerBottomGrooveUp: number;

  /**
   * Filler between a corner cabinet and the run returning off it.
   *
   * Frameless doors sit right at the box edge, so a corner door and its
   * neighbour's door collide on opening unless the corner is held off the
   * return. A face frame already provides that setback, which is why the
   * default is zero for framed work and 3" for frameless.
   */
  cornerFillerWidth: number;

  /** Saw kerf used in nesting and cut lists. */
  kerf: number;
  /** Trimmed off each sheet edge before parts are laid out. */
  sheetTrim: number;
}

// ---------------------------------------------------------------------------
// Cabinets
// ---------------------------------------------------------------------------

/**
 * `filler` is a narrow panel that closes the gap between a run and a wall or
 * an appliance. It is a real part with a real cost, and it lives in the run
 * like any other unit so it drags, reorders and packs the same way.
 */
export type CabinetType = 'base' | 'wall' | 'tall' | 'vanity' | 'filler';

/**
 * Corner treatment.
 *  - 'diagonal' turns the front into a 45 degree face, the lazy-susan style.
 *  - 'blind' runs the box past the corner; the far portion is unreachable and
 *    is covered by the cabinet on the returning wall.
 */
export type CornerStyle = 'none' | 'diagonal' | 'blind';

/** Which stile a door is hinged on, looking at the cabinet from the front. */
export type HingeSide = 'left' | 'right';

/**
 * How a finished panel is made up.
 *
 * `slab` is a single sheet — the cheapest exposed end and what the app built
 * before there was a choice. The rest are rail-and-stile assemblies that match
 * a door, which is what an island back or a bar wall normally wants.
 */
export type PanelStyle = 'slab' | 'shaker' | 'raised' | 'beadboard';

/**
 * Shape of the hardware drawn on doors and drawer fronts.
 *
 * `cup` is a bin pull, which only makes sense on a drawer — a door falls back
 * to a knob, which is what a shop would fit anyway.
 */
export type PullStyle = 'bar' | 'knob' | 'cup' | 'edge';

/**
 * A wall oven opening cut into a tall cabinet.
 *
 * The opening splits the face: drawers below it, doors above. Standard for a
 * single oven is a 28-1/2" opening with its floor around 30" so you are not
 * stooping to it; a double stack runs about 50" starting near 24".
 */
export interface OvenSpec {
  count: 1 | 2;
  /** Rough opening width. Always confirm against the model's spec sheet. */
  width: number;
  /** Total rough opening height — for a double, both ovens together. */
  openingHeight: number;
  /** Height above the finished floor to the bottom of the opening. */
  bottomHeight: number;
  /** Draw the appliance in the pocket instead of leaving it empty. */
  showAppliance: boolean;
}

export type SinkStyle = 'undermount' | 'topmount' | 'farmhouse';

/**
 * A sink belongs to the cabinet, not to the appliance list: it sits in the
 * countertop and changes how the cabinet is built, rather than standing on
 * the floor taking up run length.
 */
export interface SinkSpec {
  style: SinkStyle;
  /** Bowl width, left to right. */
  width: number;
  /** Bowl size front to back. */
  frontToBack: number;
  /** How deep the basin is below the counter. */
  bowlDepth: number;
  /**
   * Farmhouse only: height of the exposed apron. It replaces the top of the
   * face, so the doors below get shorter and there is no false front.
   */
  apronHeight: number;
  faucet: boolean;
}

export interface DrawerSpec {
  id: string;
  /** Height of the drawer *front*, not the box. */
  frontHeight: number;
  slideId?: string;
  /** Full-height file/pot drawer boxes may use taller sides. */
  boxHeightOverride?: number;
  /**
   * A fixed panel that looks like a drawer but has no box behind it —
   * standard above a sink, where the bowl leaves no room. Gets no box
   * parts and no slides.
   */
  falseFront?: boolean;
}

export interface Cabinet {
  id: string;
  name: string;
  type: CabinetType;

  /** Outside box dimensions. Height excludes countertop, includes toe kick. */
  width: number;
  height: number;
  depth: number;

  /** Position along the floor plan, inches from room origin. */
  x: number;
  z: number;
  /** Rotation about the vertical axis, degrees. 0 = facing +Z. */
  rotation: number;
  /**
   * Height of the cabinet bottom above the finished floor. Wall cabinets
   * default to 54" (18" of backsplash over a 36" counter).
   */
  mountHeight?: number;

  /**
   * Wall this cabinet belongs to. When set, x/z/rotation are derived from
   * the wall and `along`, which is what makes L and U shaped runs work.
   * Cabinets with no wall are positioned freely — an island, say.
   */
  wallId?: string;
  /** Distance from the wall's starting corner to this cabinet's left edge. */
  along?: number;

  /** Overrides the project default when set. */
  construction?: Construction;
  doorMount?: DoorMount;
  /** Overrides the project's face frame overhang for this cabinet. */
  frameOverhang?: number;

  boxMaterialId: string;
  faceMaterialId: string;
  backMaterialId: string;
  drawerBoxMaterialId: string;
  /** Overrides the project default when set. */
  drawerBottomMaterialId?: string;
  edgebandId: string;

  doorCount: 0 | 1 | 2;
  /**
   * Hinge stile for a single door. A pair always opens from the middle, so
   * this is ignored when doorCount is 2.
   */
  hingeSide?: HingeSide;
  drawers: DrawerSpec[];
  shelfCount: number;
  adjustableShelves: boolean;

  /** Sink dropped into this cabinet's countertop, if any. */
  sink?: SinkSpec;
  /** Wall oven pocket cut into this cabinet, if any. */
  oven?: OvenSpec;

  corner?: CornerStyle;
  /**
   * Blind corners only: how much of the width disappears behind the returning
   * cabinet. The reachable opening is width less this.
   */
  blindWidth?: number;
  /** Blind corners only: which end runs into the corner. */
  blindSide?: 'left' | 'right';
  /** Crown moulding runs across the top of this cabinet. */
  crown?: boolean;

  /**
   * Hold this cabinet where it is when a run is re-flowed. Set automatically
   * for anything placed against an appliance — a microwave bridge lines up
   * with the range below it, and packing it back to the corner would undo
   * the one thing that made its position meaningful.
   */
  pinned?: boolean;

  /**
   * Id of an appliance this cabinet rides on. It tracks that unit rather than
   * holding an absolute position, so moving the fridge takes the cabinet over
   * it along too.
   */
  overAppliance?: string;

  /** Exposed ends get finish-grade material and edgebanding. */
  finishedLeft: boolean;
  finishedRight: boolean;
  /**
   * How a finished end is made up. `slab` is a plain sheet, which is what
   * every end was before this existed, so it stays the default.
   */
  endPanelStyle?: PanelStyle;
  /**
   * Finished panel applied to the back of the box. Islands and peninsulas
   * show their backs to the room, so they get the same treatment as a door
   * rather than the raw carcass sheet. Absent means an unfinished back.
   */
  backPanel?: PanelStyle;

  hingeId?: string;
  pullId?: string;

  /** Excluded from the estimate but kept in the model. */
  excluded?: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export interface Wall {
  id: string;
  /** Endpoints on the floor plane, inches. */
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  height: number;
  thickness: number;
  /**
   * Hidden from the 3D view so you can see into the room past it. Purely
   * visual — a hidden wall's cabinets stay in the cut list and the estimate.
   * Use `excluded` on a cabinet to take it out of the numbers.
   */
  hidden?: boolean;
}

export interface RoomSpec {
  walls: Wall[];
  ceilingHeight: number;
}

/**
 * An opening cut through a wall.
 *
 * Deliberately has no x/z and no footprint. A window is a hole in a wall, not
 * an object standing in the room, so it must never become a run member: it
 * takes no length off a run, packs with nothing, and cannot collide with a
 * cabinet. Everything about it is expressed in the wall's own coordinates,
 * which is what keeps it out of the reflow and collision maths by
 * construction rather than by a special case.
 */
export interface WindowOpening {
  id: string;
  name: string;
  /** Wall this is cut through. */
  wallId: string;
  /** Distance from the wall's starting corner to the left edge of the opening. */
  along: number;
  /** Size of the rough opening. */
  width: number;
  height: number;
  /** Height of the sill above the finished floor. */
  sillHeight: number;
  /** Width of the casing shown around the opening. Cosmetic. */
  casingWidth: number;
  /** Hidden from the 3D view. Purely visual, like a hidden wall. */
  hidden?: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Appliances
// ---------------------------------------------------------------------------

export type ApplianceKind =
  | 'range'
  | 'cooktop'
  | 'wallOven'
  | 'refrigerator'
  | 'dishwasher'
  | 'sink'
  | 'microwave'
  | 'hood'
  | 'wineFridge'
  | 'other';

export interface Appliance {
  id: string;
  name: string;
  kind: ApplianceKind;
  width: number;
  height: number;
  depth: number;
  x: number;
  z: number;
  rotation: number;
  /** Height of the unit's base above the finished floor. */
  mountHeight: number;
  /**
   * Wall this unit stands against. Set for anything in a run — a range
   * between two cabinets is part of that run and shifts along with it when
   * a neighbour is resized, rather than sitting at a fixed spot the
   * cabinets have to leapfrog.
   */
  wallId?: string;
  /** Distance from the wall's starting corner to this unit's left edge. */
  along?: number;
  /**
   * Hold this unit where it is when a run is re-flowed, so the cabinets pack
   * around it. A range centred on a window or a fridge in its alcove has a
   * position that means something; packing it back into the sequence would
   * throw away the one thing that made it right.
   */
  pinned?: boolean;
  /**
   * Panel-ready units take custom door panels built from the cabinet
   * material, which land on the cut list and in the estimate.
   */
  panelReady?: boolean;
  /** Number of panels the unit takes — a French-door fridge takes two. */
  panelCount?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Bar tops
// ---------------------------------------------------------------------------

/**
 * A raised bar: a short pony wall with a countertop on it, standing behind a
 * base run.
 *
 * Deliberately its own object rather than a property of a cabinet. A bar wall
 * is built after the cabinets and does not change them — the base run keeps
 * its own depth, counter and cut list whether or not there is a bar behind it.
 */
export interface BarTop {
  id: string;
  name: string;

  /**
   * Wall this stands against, using the same run model as cabinets and
   * appliances so it shifts along when the run in front of it is re-flowed.
   * Free-standing bars — an island — leave this unset and use x/z.
   */
  wallId?: string;
  along?: number;
  x: number;
  z: number;
  rotation: number;

  /** Length of the pony wall itself, before any end overhang. */
  length: number;
  /** Height of the pony wall off the floor. The slab sits on top of this. */
  wallHeight: number;
  /** Finished thickness of the pony wall. */
  thickness: number;
  /**
   * How far the pony wall stands off the wall line, measured to its back.
   *
   * A bar goes on the *outside* of a run — the seating side is away from the
   * cabinets — so the wall and its slab are built out from the wall line into
   * negative depth. Nudge this to clear a run that is deeper than standard.
   */
  offset: number;

  /**
   * How far the slab reaches past the wall on the seating side. This is the
   * knee room, so it is the number that decides whether a stool fits.
   */
  overhangFront: number;
  /** How far it reaches back over the cabinets behind it. */
  overhangBack: number;
  /** How far the slab runs past each end of the pony wall. */
  overhangLeft: number;
  overhangRight: number;

  topThickness: number;
  counterMaterialId?: string;

  /**
   * Finished panel on the seating side of the wall.
   *
   * `none` means the wall is not shop work — a plastered wall that happens to
   * carry a counter — so it contributes no parts to the cut list at all.
   */
  panelStyle?: PanelStyle | 'none';
  panelMaterialId?: string;

  /**
   * What the pony wall is finished in, for the drawing.
   *
   * A bar wall is sometimes a plastered wall that happens to carry a counter,
   * and sometimes a piece of cabinetry clad to match the doors. Those want
   * different colours, and neither is a safe default for the other, so it is
   * a choice. `custom` uses `finishColor`.
   */
  finish?: 'cabinet' | 'wall' | 'custom';
  finishColor?: string;

  /**
   * Hidden from the 3D view so you can see past it to the run behind. Purely
   * visual, exactly like a hidden room wall — a hidden bar keeps its parts and
   * its place in the estimate. Use `excluded` to take it out of the numbers.
   */
  hidden?: boolean;

  /** Excluded from the estimate but kept in the model. */
  excluded?: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Trim
// ---------------------------------------------------------------------------

export interface CrownSpec {
  /** Add crown across the top of wall and tall cabinets. */
  enabled: boolean;
  name: string;
  /** Vertical face height of the profile. */
  height: number;
  /** How far it stands out from the cabinet face. */
  projection: number;
  /**
   * How far the moulding laps down over the cabinet top. Running it flush
   * leaves a visible seam, so it is normally dropped an inch onto the face.
   */
  overlap: number;
  /** Solid stock the moulding is milled from, or bought as. */
  materialId: string;
  /** Buy-in price per linear foot when not milling it in-house. */
  costPerLinearFoot: number;
  /** Milled in the shop from the project's face material instead of bought. */
  millInShop: boolean;
  /** Extra length allowed for mitres and coping. */
  wasteFactor: number;
}

/** Presentation-only settings for the 3D view. Never affects the estimate. */
export interface ViewSettings {
  background: string;
  wallColor: string;
  floorColor: string;
  counterColor: string;
  /**
   * Presentation overrides for the cabinets themselves.
   *
   * Left unset, the drawing takes its colour from the species of the material
   * each cabinet is actually specified in, which is what you want while you
   * are working. Setting one paints the render without touching the material,
   * the cut list or the estimate — for showing a client the same kitchen in a
   * different finish.
   */
  doorColor?: string;
  boxColor?: string;

  /**
   * Hardware appearance. Presentation only, like the colours above — what a
   * cabinet is actually billed for is its own `pullId`, so changing the look
   * here never moves the estimate.
   */
  pullStyle?: PullStyle;
  pullColor?: string;
  /** 0 for a painted or powder-coated finish, 1 for polished metal. */
  pullMetalness?: number;
  showGrid: boolean;
  showWalls: boolean;
  showCountertops: boolean;
  /** Overall light level, 0.5 dim to 1.6 bright. */
  brightness: number;
}

export interface LightRailSpec {
  enabled: boolean;
  height: number;
  projection: number;
  costPerLinearFoot: number;
}

// ---------------------------------------------------------------------------
// Parts (output of the parts generator)
// ---------------------------------------------------------------------------

/** Summary row for the saved-job library. */
export interface JobSummary {
  id: string;
  name: string;
  client: string;
  updatedAt: string;
  cabinetCount: number;
  linearFeet: number;
  clientTotal: number;
}

export type PartCategory =
  | 'side'
  | 'top'
  | 'bottom'
  | 'stretcher'
  | 'back'
  | 'shelf'
  | 'door'
  | 'drawerFront'
  | 'drawerBoxSide'
  | 'drawerBoxFrontBack'
  | 'drawerBottom'
  | 'faceFrameStile'
  | 'faceFrameRail'
  | 'faceFrameMullion'
  | 'toeKick'
  | 'nailer'
  | 'filler'
  | 'crown'
  | 'lightRail'
  | 'appliancePanel'
  | 'cornerPost'
  /** Any piece of a decorative end or back panel — stile, rail or field. */
  | 'finishedPanel'
  /** Framing and cap for a bar wall. */
  | 'barTop';

/** Which edges of a part are visible once installed. */
export interface EdgeFlags {
  front: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export interface Part {
  id: string;
  cabinetId: string;
  cabinetName: string;
  name: string;
  category: PartCategory;
  materialId: string;
  /** Along the grain when the material is directional. */
  length: number;
  width: number;
  thickness: number;
  qty: number;
  /** 'length' means grain runs along the part's length. */
  grain: 'length' | 'width' | 'none';
  /** Edges needing banding; total is computed by the estimator. */
  banded: EdgeFlags;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Estimating
// ---------------------------------------------------------------------------

export interface LaborRates {
  shopRatePerHour: number;
  installRatePerHour: number;
  designRatePerHour: number;

  /** Baseline build hours per cabinet by type. */
  hoursPerBaseCabinet: number;
  hoursPerWallCabinet: number;
  hoursPerTallCabinet: number;

  hoursPerDoor: number;
  hoursPerDrawer: number;
  hoursPerFinishedEnd: number;
  hoursPerFaceFrame: number;
  /** Corners are slower: angled cuts, fitting, and fussier hardware. */
  hoursPerCornerCabinet: number;
  /** Crown is measured, mitred, coped and fitted on site, per linear foot. */
  hoursPerCrownFoot: number;
  hoursPerAppliancePanel: number;
  /**
   * Building and cladding a bar wall, per linear foot. Only counted where the
   * wall is shop work — a plastered wall carrying a counter costs nothing here.
   */
  hoursPerBarWallFoot: number;

  /** Sanding, sealing, topcoats — per square foot of finished surface. */
  finishHoursPerSqFt: number;

  hoursPerCabinetInstall: number;
  designHoursFlat: number;
  designHoursPerCabinet: number;
}

export interface FinishSpec {
  id: string;
  name: string;
  /** Material cost only; labor comes from finishHoursPerSqFt. */
  costPerSqFt: number;
  /** Both faces of doors and exposed panels get coated. */
  coatsNote?: string;
}

export interface PricingSettings {
  /** Waste added to sheet-good counts beyond what nesting reports. */
  sheetWasteFactor: number;
  /** Waste on solid lumber — defect, snipe, and ripping loss. */
  lumberWasteFactor: number;
  /** Consumables: glue, screws, sandpaper, abrasives, as % of material. */
  consumablesPct: number;

  /** Shop overhead as a percentage of direct cost. */
  overheadPct: number;
  /** Buffer for the unknown, as a percentage of cost. */
  contingencyPct: number;
  /**
   * Gross margin on the sell price (not markup on cost).
   * price = cost / (1 - margin)
   */
  targetMarginPct: number;

  salesTaxPct: number;
  /** Whether labor is taxable in the jurisdiction. */
  taxLabor: boolean;

  deliveryFlat: number;
  depositPct: number;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  address: string;
  createdAt: string;
  updatedAt: string;

  room: RoomSpec;
  cabinets: Cabinet[];
  appliances: Appliance[];
  barTops: BarTop[];
  windows: WindowOpening[];
  crown: CrownSpec;
  lightRail: LightRailSpec;
  view: ViewSettings;

  defaults: ConstructionSpec;
  defaultBoxMaterialId: string;
  defaultFaceMaterialId: string;
  defaultBackMaterialId: string;
  defaultDrawerBoxMaterialId: string;
  /**
   * Stock for drawer bottoms, which is normally thinner than the box sides —
   * a 1/4" panel dropped into a groove. Kept separate so a heavy drawer can
   * take a 1/2" bottom without thickening the sides with it.
   */
  defaultDrawerBottomMaterialId: string;
  defaultEdgebandId: string;

  materials: Material[];
  hardware: HardwareItem[];
  finishes: FinishSpec[];
  selectedFinishId: string;

  labor: LaborRates;
  pricing: PricingSettings;

  /** Extra line items: countertops, appliance panels, subcontracted work. */
  extras: ExtraLineItem[];
}

export interface ExtraLineItem {
  id: string;
  description: string;
  qty: number;
  unitCost: number;
  /** Extras marked as pass-through skip margin and take a flat handling fee. */
  passThrough: boolean;
  markupPct?: number;
}
