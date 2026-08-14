import type {
  BarTop,
  Cabinet,
  ConstructionSpec,
  EdgeFlags,
  Material,
  PanelStyle,
  Part,
  PartCategory,
  Project,
} from './types';
import { materialThickness } from './materials';
import { formatFrac, snap32 } from './units';

/**
 * Material id for trim bought by the linear foot rather than milled from
 * stock. The takeoff deliberately has no material to match, so these parts
 * never consume sheets or board feet; the estimator prices them separately
 * from their run length.
 */
export const BOUGHT_IN = '__bought_in__';

const NONE: EdgeFlags = { front: false, back: false, left: false, right: false };
const FRONT: EdgeFlags = { front: true, back: false, left: false, right: false };
const ALL: EdgeFlags = { front: true, back: true, left: true, right: true };

let partSeq = 0;
const nextId = () => `p${(partSeq++).toString(36)}`;

/** Resolve the construction settings for one cabinet against project defaults. */
export function specFor(cabinet: Cabinet, defaults: ConstructionSpec): ConstructionSpec {
  return {
    ...defaults,
    construction: cabinet.construction ?? defaults.construction,
    doorMount: cabinet.doorMount ?? defaults.doorMount,
    frameOverhang: cabinet.frameOverhang ?? defaults.frameOverhang ?? 0,
  };
}

/** How far the frame runs proud of its box, per side. */
export interface FrameOverhangs {
  left: number;
  right: number;
}

const FRAME_NEIGHBOUR_TOLERANCE = 0.75;

/**
 * Where a face frame runs proud of its box, and by how much.
 *
 * The frame is the cabinet's nominal size — a 24" cabinet has a 24" frame —
 * and the box behind it is narrowed instead. That is the whole point: two
 * frames butt tight while their boxes leave a gap between them, so a run that
 * has to fit an opening nobody framed square has somewhere to give. Growing
 * the frame outward instead would make a 24" cabinet measure 24-1/2" and throw
 * out every run calculation in the job.
 *
 * A side gets no overhang where the box is on show, because a lip hanging over
 * nothing is neither buildable nor what a shop would do:
 *   - a finished end,
 *   - the end of a run, with nothing beside it,
 *   - a neighbour shallower than this cabinet, which leaves the side exposed.
 *
 * Corner cabinets get none at all. They are pinned by two walls, so they have
 * to be built exact, and the cabinets running away from them take up the slack.
 */
export function frameOverhangs(
  cabinet: Cabinet,
  spec: ConstructionSpec,
  project?: Partial<Pick<Project, 'cabinets'>>,
): FrameOverhangs {
  const none = { left: 0, right: 0 };
  if (spec.construction !== 'faceFrame') return none;
  if ((cabinet.corner ?? 'none') !== 'none') return none;
  if (cabinet.type === 'filler') return none;
  const base = spec.frameOverhang ?? 0;
  if (base <= 0) return none;

  const buried = (side: 'left' | 'right') => {
    if (side === 'left' && cabinet.finishedLeft) return false;
    if (side === 'right' && cabinet.finishedRight) return false;

    // Without the rest of the job to look at, assume it sits in a run. A
    // cabinet is far more often between two others than on the end of one.
    if (!project?.cabinets) return true;

    const n = neighbourOn(cabinet, side, project);
    // A shallower neighbour leaves this cabinet's side on show.
    return !!n && planDepthOf(n) >= planDepthOf(cabinet) - 0.5;
  };

  return { left: buried('left') ? base : 0, right: buried('right') ? base : 0 };
}

/** Local so this file need not reach into geometry, which imports it. */
const planDepthOf = (c: Cabinet) => (c.corner === 'diagonal' ? c.width : c.depth);

/**
 * The cabinet butting this one on the given side, in the same run.
 *
 * Sides are named looking at the face, and a run is ordered by distance along
 * its wall, so the neighbour on the left is the one whose right edge lands on
 * this cabinet's left edge.
 */
export function neighbourOn(
  cabinet: Cabinet,
  side: 'left' | 'right',
  project: Partial<Pick<Project, 'cabinets'>>,
): Cabinet | undefined {
  const others = project.cabinets;
  if (!others) return undefined;

  const along = cabinet.along ?? cabinet.x;
  const edge = side === 'left' ? along : along + cabinet.width;
  const upper = cabinet.type === 'wall';

  return others.find((o) => {
    if (o.id === cabinet.id || o.excluded) return false;
    if (o.wallId !== cabinet.wallId) return false;
    if ((o.type === 'wall') !== upper) return false;
    const oAlong = o.along ?? o.x;
    const oEdge = side === 'left' ? oAlong + o.width : oAlong;
    return Math.abs(oEdge - edge) <= FRAME_NEIGHBOUR_TOLERANCE;
  });
}

/** Which ends of a cabinet butt a diagonal corner. */
export interface CornerAdjacency {
  left: boolean;
  right: boolean;
}

const NO_CORNER_ADJACENCY: CornerAdjacency = { left: false, right: false };

/**
 * Where this cabinet meets a diagonal corner.
 *
 * The corner carries a narrow mitred frame on its 45 face; whatever butts it
 * carries a matching return stile on that end. Between the two there is room
 * for both doors to open, which neither gets on its own.
 */
export function cornerAdjacency(
  cabinet: Cabinet,
  spec: ConstructionSpec,
  project?: Partial<Pick<Project, 'cabinets'>>,
): CornerAdjacency {
  // Only frameless needs it: a face frame's own stiles already do this job.
  if (spec.construction !== 'frameless') return NO_CORNER_ADJACENCY;
  if ((cabinet.corner ?? 'none') !== 'none') return NO_CORNER_ADJACENCY;
  if (!project?.cabinets || (spec.cornerFrameWidth ?? 0) <= 0) return NO_CORNER_ADJACENCY;

  const isCorner = (c?: Cabinet) => c?.corner === 'diagonal';
  return {
    left: isCorner(neighbourOn(cabinet, 'left', project)),
    right: isCorner(neighbourOn(cabinet, 'right', project)),
  };
}

/**
 * Outside width of the carcass, which sits behind the frame and is narrower
 * than it wherever the frame is run proud.
 */
export function boxWidth(
  cabinet: Cabinet,
  spec: ConstructionSpec,
  project?: Partial<Pick<Project, 'cabinets'>>,
): number {
  const o = frameOverhangs(cabinet, spec, project);
  return cabinet.width - o.left - o.right;
}

export interface FaceOpening {
  kind: 'door' | 'drawer';
  /** Index into cabinet.drawers for drawer rows. */
  drawerIndex?: number;
  openingWidth: number;
  openingHeight: number;
  /** Finished front panel size covering this opening. */
  frontWidth: number;
  frontHeight: number;
  /** Number of front panels across this opening (2 for a door pair). */
  frontCount: number;
  /**
   * Absolute height of the top of this front, measured from the floor. Set
   * where stacking order alone cannot place it — either side of an oven
   * pocket, for instance.
   */
  topAt?: number;
}

export interface FaceLayout {
  openings: FaceOpening[];
  /** Height of the zone the fronts cover, measured on the cabinet face. */
  faceZoneHeight: number;
  /** Clear opening width inside the box or face frame. */
  interiorOpeningWidth: number;
  warnings: string[];
}

/**
 * The width the doors and drawers actually cover.
 *
 * A square cabinet gives its full width. A diagonal corner presents a 45
 * degree face across the corner, which is longer than either wall leg. A
 * blind corner only shows the reachable part; the rest disappears behind the
 * cabinet on the returning wall.
 */
/**
 * Face width a diagonal corner gives up to fillers.
 *
 * A frameless corner door covers its whole 45 degree face and stands proud of
 * it — and so does the full-overlay front on each neighbouring cabinet. Run
 * all three right up to the corner and they occupy the same space: the fronts
 * touch before any of them opens. A filler at each end sets the corner door
 * back far enough to clear.
 *
 * A face frame needs none. Its stiles already hold the door in from the edges,
 * and the neighbour's stiles do the same, so the two fronts never meet.
 */
export function cornerFillerAllowance(cabinet: Cabinet, spec: ConstructionSpec): number {
  if (cabinet.corner !== 'diagonal') return 0;
  if (spec.construction !== 'frameless') return 0;
  return 2 * cornerFrameSetback(spec);
}

/**
 * How far a front stops short of the corner stile beside it.
 *
 * The stile is only there to hold two fronts apart, so each front may lap onto
 * it; what stays exposed is the working clearance. Setting the front back by
 * the full stile width would give away face for nothing.
 */
export function cornerFrameSetback(spec: ConstructionSpec): number {
  return Math.max(0, (spec.cornerFrameWidth ?? 0) - (spec.cornerFrameOverlay ?? 0));
}

export function frontalWidth(cabinet: Cabinet): number {
  if (cabinet.corner === 'diagonal') {
    // Put the corner at the origin with one leg along each wall. The cabinet
    // fills a `width` x `width` square, and the neighbouring runs (which are
    // `depth` deep) butt into its two sides. What is left exposed is the
    // diagonal from (width, depth) to (depth, width) — a 45 degree face whose
    // length is (width - depth) * sqrt(2).
    //
    // The familiar 36" corner with 24" deep neighbours therefore carries a
    // 12 * sqrt(2) = 17" door, which is exactly what the catalogues list.
    return Math.max(6, (cabinet.width - cabinet.depth) * Math.SQRT2);
  }
  if (cabinet.corner === 'blind') {
    return Math.max(6, cabinet.width - (cabinet.blindWidth ?? 24));
  }
  return cabinet.width;
}

/**
 * Work out door and drawer-front sizes.
 *
 * The user specifies drawer *front* heights (that is what shows), so the
 * calculation runs backwards from the front to the opening for face-frame
 * builds, and directly down the face for frameless.
 */
/** Whether a cabinet takes crown, and how far the moulding laps its face. */
export interface CrownContext {
  crowned: boolean;
  overlap: number;
}

const NO_CROWN: CrownContext = { crowned: false, overlap: 0 };

/**
 * Resolve crown for one cabinet against the project setting.
 *
 * Crown defaults on for wall and tall cabinets, which is where it goes, and a
 * per-cabinet flag overrides that either way.
 */
export function crownContext(
  cabinet: Cabinet,
  project: Partial<Pick<Project, 'crown'>>,
): CrownContext {
  const crowned =
    !!project.crown?.enabled && (cabinet.crown ?? (cabinet.type === 'wall' || cabinet.type === 'tall'));
  return { crowned, overlap: crowned ? (project.crown?.overlap ?? 0) : 0 };
}

export function computeFaceLayout(
  cabinet: Cabinet,
  spec: ConstructionSpec,
  materials: Material[],
  crown: CrownContext = NO_CROWN,
  adjacency: CornerAdjacency = NO_CORNER_ADJACENCY,
): FaceLayout {
  const warnings: string[] = [];
  const t = materialThickness(materials, cabinet.boxMaterialId);
  const isBase = cabinet.type !== 'wall';
  const kick = isBase ? spec.toeKickHeight : 0;

  // A farmhouse apron takes the top of the face, so the doors below are
  // shorter and there is no room for a false front above them.
  const apron = cabinet.sink?.style === 'farmhouse' ? cabinet.sink.apronHeight : 0;
  const faceZoneHeight = cabinet.height - kick - apron;
  const drawerRows = cabinet.drawers.length;
  const hasDoors = cabinet.doorCount > 0;
  const rows = drawerRows + (hasDoors ? 1 : 0);
  const gaps = Math.max(0, rows - 1);
  const openings: FaceOpening[] = [];

  if (rows === 0) {
    return { openings, faceZoneHeight, interiorOpeningWidth: cabinet.width - 2 * t, warnings };
  }

  // Corner cabinets present a narrower (blind) or wider (diagonal) face than
  // their plan width, and the fronts are sized against that, not the box. A
  // frameless diagonal also gives up a filler at each end so its door clears
  // the fronts on the two runs meeting it.
  const faceWidth = frontalWidth(cabinet) - cornerFillerAllowance(cabinet, spec);

  /*
   * An oven pocket splits the face in two: drawers below it, doors above.
   * Neither stack can be worked out by running down from the top, so each
   * front carries the absolute height of its own top edge.
   */
  if (cabinet.oven) {
    const oven = cabinet.oven;
    const openTop = oven.bottomHeight + oven.openingHeight;
    const below = oven.bottomHeight - kick;
    const above = cabinet.height - openTop;
    const span = spec.construction === 'faceFrame'
      ? faceWidth - 2 * spec.frameStileWidth + 2 * spec.overlay
      : faceWidth - 2 * spec.revealEdge;

    if (below < 3) {
      warnings.push(
        `${cabinet.name}: the oven opening starts ${snap32(oven.bottomHeight)}" up, leaving no usable height ` +
          `below it. Raise it or drop the drawers.`,
      );
    }
    if (above < 0) {
      warnings.push(
        `${cabinet.name}: the oven opening runs past the top of the cabinet. Lower it or make the cabinet taller.`,
      );
    }
    if (oven.width > faceWidth - 2 * t) {
      warnings.push(
        `${cabinet.name}: a ${snap32(oven.width)}" opening will not fit between the sides of a ` +
          `${snap32(cabinet.width)}" cabinet.`,
      );
    }

    // Drawers fill the space under the oven, sharing it evenly.
    if (cabinet.drawers.length > 0 && below > 3) {
      const gaps = (cabinet.drawers.length - 1) * spec.revealBetween;
      const each = (below - 2 * spec.revealEdge - gaps) / cabinet.drawers.length;
      let top = oven.bottomHeight - spec.revealEdge;
      cabinet.drawers.forEach((_, i) => {
        openings.push({
          kind: 'drawer',
          drawerIndex: i,
          openingWidth: faceWidth - 2 * t,
          openingHeight: each,
          frontWidth: span,
          frontHeight: each,
          frontCount: 1,
          topAt: top,
        });
        top -= each + spec.revealBetween;
      });
    }

    // Doors fill whatever is left above the opening.
    if (cabinet.doorCount > 0 && above > 3) {
      const h = above - 2 * spec.revealEdge;
      openings.push({
        kind: 'door',
        openingWidth: faceWidth - 2 * t,
        openingHeight: h,
        frontWidth: cabinet.doorCount === 2 ? (span - spec.revealBetween) / 2 : span,
        frontHeight: h,
        frontCount: cabinet.doorCount,
        topAt: cabinet.height - spec.revealEdge,
      });
    }

    return { openings, faceZoneHeight, interiorOpeningWidth: faceWidth - 2 * t, warnings };
  }

  if (spec.construction === 'faceFrame') {
    const stile = spec.frameStileWidth;
    const rail = spec.frameRailWidth;
    /*
     * A crowned cabinet runs a wider top rail so the moulding has something to
     * lap onto. The parts generator already cut it that way; sizing the doors
     * against the narrow rail here meant the fronts ran up behind the crown.
     */
    const topRail = crown.crowned ? spec.crownTopRailWidth : rail;
    // The frame is the cabinet's nominal size, so the opening comes off that
    // and never moves when the box behind it is narrowed for tolerance.
    const openingWidth = faceWidth - 2 * stile;
    const inset = spec.doorMount === 'inset';
    // Overlay per side; a half-overlay pair shares the center stile.
    const ov = inset ? -spec.revealEdge : spec.doorMount === 'halfOverlay' ? spec.overlay / 2 : spec.overlay;

    // Drawer openings derive from the requested front height.
    const requested = cabinet.drawers.map((d) => Math.max(1, d.frontHeight - 2 * ov));
    // Rails: top + bottom + one between each adjacent pair of openings. The
    // top one may be wider than the rest when the cabinet takes crown.
    const railTotal = topRail + (1 + gaps) * rail;

    /*
     * A face frame eats height a frameless box does not: a rail above, below
     * and between every front. Drawer heights fitted to a frameless face
     * therefore overrun once the same cabinet is switched to face frame — by
     * the whole rail stack — and with no door to absorb it the frame walks off
     * the bottom of the cabinet and the fronts hang over the toe kick.
     *
     * Re-fit the openings to what the frame actually leaves, keeping the
     * proportions the drawer heights asked for.
     */
    let drawerOpenings = requested;
    if (!hasDoors && drawerRows > 0) {
      const available = faceZoneHeight - railTotal;
      const asked = requested.reduce((a, b) => a + b, 0);
      if (asked > 0 && available > 0 && Math.abs(available - asked) > 1 / 32) {
        drawerOpenings = requested.map((o) => (o * available) / asked);
        warnings.push(
          `${cabinet.name}: drawer fronts re-fitted to the face frame — its rails take ` +
            `${snap32(railTotal)}" of the ${snap32(faceZoneHeight)}" face, leaving ${snap32(available)}" of openings.`,
        );
      }
    }

    const usedByDrawers = drawerOpenings.reduce((a, b) => a + b, 0);
    const doorOpeningHeight = faceZoneHeight - railTotal - usedByDrawers;

    if (hasDoors && doorOpeningHeight < 4) {
      warnings.push(
        `${cabinet.name}: door opening computes to ${doorOpeningHeight.toFixed(2)}" — reduce drawer front heights or raise the cabinet.`,
      );
    }

    cabinet.drawers.forEach((_, i) => {
      openings.push({
        kind: 'drawer',
        drawerIndex: i,
        openingWidth,
        openingHeight: drawerOpenings[i],
        frontWidth: openingWidth + 2 * ov,
        // The front covers its opening plus the overlay, so it follows the
        // re-fitted opening rather than the height asked for the other build.
        frontHeight: drawerOpenings[i] + 2 * ov,
        frontCount: 1,
      });
    });

    if (hasDoors) {
      const totalDoorWidth = openingWidth + 2 * ov;
      const frontWidth =
        cabinet.doorCount === 2 ? (totalDoorWidth - spec.revealBetween) / 2 : totalDoorWidth;
      openings.push({
        kind: 'door',
        openingWidth,
        openingHeight: Math.max(1, doorOpeningHeight),
        frontWidth,
        frontHeight: Math.max(1, doorOpeningHeight + 2 * ov),
        frontCount: cabinet.doorCount,
      });
    }

    return { openings, faceZoneHeight, interiorOpeningWidth: openingWidth, warnings };
  }

  // --- Frameless -----------------------------------------------------------
  const inset = spec.doorMount === 'inset';
  const boxOpeningWidth = faceWidth - 2 * t;

  /*
   * An end butting a diagonal corner carries a return stile, so the fronts on
   * that side stop short of it. Paired with the corner's own mitred frame,
   * that is what leaves the two doors room to open past each other.
   */
  const returnStile = cornerFrameSetback(spec);
  const returns = (adjacency.left ? returnStile : 0) + (adjacency.right ? returnStile : 0);

  // Total width the fronts span, and the height available to them.
  const spanWidth =
    (inset ? boxOpeningWidth - 2 * spec.revealEdge : faceWidth - 2 * spec.revealEdge) - returns;
  /*
   * Frameless has no top rail to widen, so the crown laps straight over the
   * door. The fronts have to give up that much height or the moulding lands on
   * top of them — which is what was showing in the render.
   */
  const crownLap = crown.crowned ? crown.overlap : 0;
  const spanHeight = inset
    ? faceZoneHeight - 2 * t - 2 * spec.revealEdge - crownLap
    : faceZoneHeight - 2 * spec.revealEdge - crownLap;

  const usedByDrawers = cabinet.drawers.reduce((a, d) => a + d.frontHeight, 0);
  const doorHeight = spanHeight - usedByDrawers - gaps * spec.revealBetween;

  if (hasDoors && doorHeight < 4) {
    warnings.push(
      `${cabinet.name}: door height computes to ${doorHeight.toFixed(2)}" — reduce drawer front heights or raise the cabinet.`,
    );
  }
  if (!hasDoors && Math.abs(doorHeight) > 0.03 && drawerRows > 0) {
    warnings.push(
      `${cabinet.name}: drawer fronts leave ${doorHeight.toFixed(2)}" of unused face height. Adjust drawer heights to fill the cabinet.`,
    );
  }

  cabinet.drawers.forEach((d, i) => {
    openings.push({
      kind: 'drawer',
      drawerIndex: i,
      openingWidth: boxOpeningWidth,
      openingHeight: d.frontHeight,
      frontWidth: spanWidth,
      frontHeight: d.frontHeight,
      frontCount: 1,
    });
  });

  if (hasDoors) {
    const frontWidth =
      cabinet.doorCount === 2 ? (spanWidth - spec.revealBetween) / 2 : spanWidth;
    openings.push({
      kind: 'door',
      openingWidth: boxOpeningWidth,
      openingHeight: Math.max(1, doorHeight),
      frontWidth,
      frontHeight: Math.max(1, doorHeight),
      frontCount: cabinet.doorCount,
    });
  }

  if (cabinet.doorCount === 1 && spanWidth > 24) {
    warnings.push(`${cabinet.name}: a single ${spanWidth.toFixed(1)}" door will sag and swing wide — use a pair.`);
  }

  return { openings, faceZoneHeight, interiorOpeningWidth: boxOpeningWidth, warnings };
}

interface PartInput {
  name: string;
  category: PartCategory;
  materialId: string;
  length: number;
  width: number;
  qty: number;
  grain: Part['grain'];
  banded?: EdgeFlags;
  notes?: string;
}

export interface CabinetParts {
  parts: Part[];
  warnings: string[];
  layout: FaceLayout;
}

/**
 * Break a single cabinet down into cut parts.
 *
 * Joinery model used here (the common American shop build):
 *  - Sides run full height. Base/tall cabinets get a toe notch cut in the
 *    front bottom corner rather than sitting on a separate ladder base.
 *  - Deck and top are captured between the sides, so their length is the
 *    cabinet width less two side thicknesses.
 *  - Base cabinets use front and rear stretchers; wall and tall cabinets get
 *    a full top panel.
 *  - Backs are rabbeted into the sides by default.
 */
export interface PanelPiece {
  name: string;
  length: number;
  width: number;
  qty: number;
  grain: 'length' | 'width' | 'none';
  notes?: string;
}

/**
 * The pieces that make up one finished panel.
 *
 * Shared by cabinet backs, applied end panels and bar walls, so a shaker back
 * is cut the same way as a shaker door and the three cannot drift apart.
 *
 * `width` runs across the panel and `height` up it. A slab is a single sheet;
 * the rail-and-stile styles put full-height stiles at the edges with the rails
 * between them, each rail carrying a tongue at both ends.
 */
export function panelPieces(
  style: PanelStyle,
  width: number,
  height: number,
  spec: ConstructionSpec,
): PanelPiece[] {
  if (style === 'slab' || style === 'beadboard') {
    return [
      {
        name: style === 'beadboard' ? 'Finished Panel (beadboard)' : 'Finished Panel',
        length: height,
        width,
        qty: 1,
        grain: 'length',
        notes: style === 'beadboard' ? 'Beaded face, beads running vertically' : undefined,
      },
    ];
  }

  const stile = spec.frameStileWidth;
  const rail = spec.frameRailWidth;
  const raised = style === 'raised';
  const groove = spec.panelGroove ?? 3 / 8;
  const float = spec.panelFloat ?? 1 / 8;

  return [
    { name: 'Panel Stile', length: height, width: stile, qty: 2, grain: 'length' },
    {
      name: 'Panel Rail',
      length: width - 2 * stile + 2 * groove,
      width: rail,
      qty: 2,
      grain: 'length',
      notes: `Length includes a ${formatFrac(groove)}" tongue at each end`,
    },
    {
      name: raised ? 'Raised Field' : 'Flat Field',
      length: height - 2 * rail + 2 * groove - float,
      width: width - 2 * stile + 2 * groove - float,
      qty: 1,
      grain: 'length',
      notes:
        (raised ? 'Raised on all four edges; floats in the groove' : 'Floats in the groove — do not glue') +
        `. ${formatFrac(float)}" of movement allowed`,
    },
  ];
}

/** One groove to cut in a side panel, measured from the panel's bottom edge. */
export interface GrooveSetout {
  label: string;
  /** Distance from the bottom edge of the side to the lower edge of the groove. */
  fromBottom: number;
  /** Width of the groove, which is the thickness of what lands in it. */
  width: number;
  depth: number;
}

/**
 * Where the grooves go on a side panel.
 *
 * A cut list gives you sizes but not setout, and a housed carcass is only as
 * square as its grooves line up. These are measured from the bottom edge of
 * the side — the edge that sits on the floor — because that is the edge you
 * register against on the saw or the CNC.
 *
 * Returns nothing for a butt-jointed box, which has no grooves to cut.
 */
export function grooveSetout(
  cabinet: Cabinet,
  spec: ConstructionSpec,
  materials: Material[],
): GrooveSetout[] {
  if (spec.carcassJoinery !== 'dado') return [];
  const t = materialThickness(materials, cabinet.boxMaterialId);
  const depth = spec.carcassDadoDepth ?? 0;
  if (depth <= 0) return [];

  const isWall = cabinet.type === 'wall';
  const kick = isWall ? 0 : spec.toeKickHeight;
  const H = cabinet.height;
  const out: GrooveSetout[] = [];

  out.push({ label: 'Deck', fromBottom: kick, width: t, depth });

  // Fixed shelves are housed; adjustable ones ride on pins and get none.
  if (cabinet.shelfCount > 0 && !cabinet.adjustableShelves) {
    const interiorBottom = kick + t;
    const span = H - t - interiorBottom;
    const gap = span / (cabinet.shelfCount + 1);
    for (let i = 1; i <= cabinet.shelfCount; i++) {
      out.push({
        label: `Shelf ${i}`,
        fromBottom: interiorBottom + gap * i,
        width: t,
        depth,
      });
    }
  }

  // Stretchers are screwed to the top edge, so only a full top is housed.
  if (isWall || spec.baseTopStyle === 'full') {
    out.push({ label: 'Top', fromBottom: H - t, width: t, depth });
  }

  return out;
}

export function generateCabinetParts(
  cabinet: Cabinet,
  project: Pick<Project, 'defaults' | 'materials'> &
    Partial<Pick<Project, 'crown' | 'defaultDrawerBottomMaterialId' | 'cabinets'>>,
): CabinetParts {
  const spec = specFor(cabinet, project.defaults);
  const mats = project.materials;
  const t = materialThickness(mats, cabinet.boxMaterialId);
  const bt = materialThickness(mats, cabinet.backMaterialId);
  const dbt = materialThickness(mats, cabinet.drawerBoxMaterialId);
  const ft = spec.frameThickness;

  const crown = crownContext(cabinet, project);
  const adjacency = cornerAdjacency(cabinet, spec, project);
  const layout = computeFaceLayout(cabinet, spec, mats, crown, adjacency);
  const warnings = [...layout.warnings];
  const out: Part[] = [];

  const add = (p: PartInput) => {
    if (p.qty <= 0) return;
    if (p.length <= 0 || p.width <= 0) {
      warnings.push(`${cabinet.name}: skipped "${p.name}" — computed a non-positive size.`);
      return;
    }
    out.push({
      id: nextId(),
      cabinetId: cabinet.id,
      cabinetName: cabinet.name,
      name: p.name,
      category: p.category,
      materialId: p.materialId,
      length: snap32(p.length),
      width: snap32(p.width),
      thickness:
        p.materialId === cabinet.faceMaterialId && spec.construction === 'faceFrame' && p.category.startsWith('faceFrame')
          ? ft
          : materialThickness(mats, p.materialId),
      qty: p.qty,
      grain: p.grain,
      banded: p.banded ?? NONE,
      notes: p.notes,
    });
  };

  // A filler is one panel, not a carcass. Bail out before any box parts.
  if (cabinet.type === 'filler') {
    add({
      name: 'Filler / Scribe',
      category: 'filler',
      materialId: cabinet.faceMaterialId,
      length: cabinet.height,
      width: cabinet.width,
      qty: 1,
      grain: 'length',
      banded: FRONT,
      notes: 'Cut oversize and scribe to the wall on site',
    });
    if (cabinet.width > 6) {
      warnings.push(
        `${cabinet.name}: a ${snap32(cabinet.width)}" filler is wide enough to read as a mistake. ` +
          `Over about 4", widen the cabinets or add another unit instead.`,
      );
    }
    return { parts: out, warnings, layout };
  }

  const isWall = cabinet.type === 'wall';
  const isBase = !isWall;
  const kick = isBase ? spec.toeKickHeight : 0;
  const frameless = spec.construction === 'frameless';
  const corner = cabinet.corner ?? 'none';
  const crowned =
    !!project.crown?.enabled && (cabinet.crown ?? (cabinet.type === 'wall' || cabinet.type === 'tall'));

  // A face frame occupies depth at the front, so the box gets shallower.
  const boxDepth = frameless ? cabinet.depth : cabinet.depth - ft;
  const backAllowance = spec.backStyle === 'none' ? 0 : bt;
  const sideDepth = spec.backStyle === 'applied' ? boxDepth - bt : boxDepth;
  /*
   * Every carcass part is cut to the box, which is narrower than the cabinet
   * wherever the frame runs proud of it. The frame keeps the nominal width, so
   * the run maths and the elevation are unaffected — only what gets cut is.
   */
  const bw = boxWidth(cabinet, spec, project);
  /*
   * Interior width is what fits between the sides. Anything housed in a dado
   * has to be cut longer by the groove depth at each end, or the box finishes
   * narrow by twice the dado — the single easiest way to cut a whole job wrong.
   */
  const dado = spec.carcassJoinery === 'dado' ? (spec.carcassDadoDepth ?? 0) : 0;
  const interiorWidth = bw - 2 * t;
  const housedWidth = interiorWidth + 2 * dado;
  /*
   * The deck runs the full depth of the box, back panel to front edge.
   *
   * The toe kick is *not* deducted here. This is a notched-side build: the
   * notch only removes material from the sides below the kick height, and the
   * deck lands on top of that notch where the side is still full depth. The
   * kick face then closes the notch beneath it. Setting the deck back as well
   * left every base cabinet with a bottom 3" short of its own doors, both in
   * the cut list and on screen. A deck is only set back when the box sits on
   * a separate ladder base, which is not the joinery modelled here.
   *
   * Written against boxDepth rather than sideDepth so it holds for all three
   * back styles: an applied back shortens the sides but not the deck.
   */
  const deckDepth = boxDepth - backAllowance;

  // --- Box ----------------------------------------------------------------
  const sideBanded: EdgeFlags = frameless ? FRONT : NONE;
  const toeNote = isBase
    ? `Toe notch ${spec.toeKickHeight}" H x ${spec.toeKickDepth}" D at front bottom`
    : undefined;

  const grooves = grooveSetout(cabinet, spec, mats);
  const setoutNote = grooves.length
    ? `Dados ${formatFrac(grooves[0].width)}" wide x ${formatFrac(grooves[0].depth)}" deep, ` +
      `from bottom edge: ${grooves.map((g) => `${g.label} ${formatFrac(g.fromBottom)}"`).join(', ')}`
    : undefined;

  if (corner === 'diagonal') {
    // A diagonal corner is not a box. Both sides run back to the walls and the
    // deck is a pentagon: a square blank with the front corner cut at 45.
    const legDepth = cabinet.width;
    add({
      name: 'Side (wall leg)',
      category: 'side',
      materialId: cabinet.boxMaterialId,
      length: cabinet.height,
      width: legDepth - t,
      qty: 2,
      grain: 'length',
      banded: sideBanded,
      notes: `${toeNote ?? ''}${toeNote ? '. ' : ''}One per wall, mitred to the 45 face`.trim(),
    });
    add({
      name: isBase ? 'Deck / Bottom (corner)' : 'Bottom (corner)',
      category: 'bottom',
      materialId: cabinet.boxMaterialId,
      length: cabinet.width - t,
      width: cabinet.width - t,
      qty: 1,
      grain: 'length',
      banded: FRONT,
      notes: `Square blank — cut the front corner at 45 to a ${snap32(frontalWidth(cabinet)).toFixed(2)}" face`,
    });
    add({
      name: 'Corner Post',
      category: 'cornerPost',
      materialId: cabinet.faceMaterialId,
      length: cabinet.height - kick,
      width: 2,
      qty: 2,
      grain: 'length',
      notes: 'Bevelled to land the 45 degree face on the door opening',
    });

    // Frameless corners need holding off the returning run or the two doors
    // foul each other on opening. A face frame already sets the door back.
    // A narrow frame on the 45 face rather than a slab of filler. Mitred into
    // the box sides so it reads as cabinetwork, and inset so the door sits
    // proud of it the way an overlay door should.
    if (frameless && (spec.cornerFrameWidth ?? 0) > 0) {
      add({
        name: 'Corner Frame Stile',
        category: 'faceFrameStile',
        materialId: cabinet.faceMaterialId,
        length: cabinet.height - kick,
        width: spec.cornerFrameWidth,
        qty: 2,
        grain: 'length',
        banded: FRONT,
        notes: 'Mitred into the box side at each end of the 45 face; door lands proud of it',
      });
    }
  } else {
    add({
      name: 'Side',
      category: 'side',
      materialId: cabinet.boxMaterialId,
      length: cabinet.height,
      width: sideDepth,
      qty: 2,
      grain: 'length',
      banded: sideBanded,
      // Setout rides on the side, because that is the part being grooved and
      // the sheet the operator has in front of them when they cut it.
      notes: [toeNote, setoutNote].filter(Boolean).join('. ') || undefined,
    });

    add({
      name: isBase ? 'Deck / Bottom' : 'Bottom',
      category: 'bottom',
      materialId: cabinet.boxMaterialId,
      length: housedWidth,
      width: deckDepth,
      qty: 1,
      grain: 'length',
      banded: frameless ? FRONT : NONE,
      notes:
        corner === 'blind'
          ? `Blind corner — ${snap32(cabinet.blindWidth ?? 24)}" of this runs behind the returning cabinet`
          : undefined,
    });

    if (corner === 'blind') {
      // The blind section needs a filler panel closing the dead space so the
      // returning cabinet has something to scribe and fasten to.
      add({
        name: 'Blind Filler Panel',
        category: 'filler',
        materialId: cabinet.faceMaterialId,
        length: cabinet.height - kick,
        width: Math.max(3, (cabinet.blindWidth ?? 24) - sideDepth + 3),
        qty: 1,
        grain: 'length',
        banded: FRONT,
        notes: 'Closes the dead corner; scribe to the returning run on site',
      });
    }
  }

  if (corner === 'diagonal') {
    // Mirror of the deck: a square blank with the front corner taken off.
    add({
      name: isBase ? 'Top Stretcher (corner)' : 'Top (corner)',
      category: isBase ? 'stretcher' : 'top',
      materialId: cabinet.boxMaterialId,
      length: cabinet.width - t,
      width: isBase ? spec.stretcherWidth : cabinet.width - t,
      qty: 1,
      grain: 'length',
      notes: isBase ? 'Gusset across the 45 face' : 'Square blank, front corner cut at 45',
    });
  } else if (isBase && spec.baseTopStyle === 'stretchers') {
    // An apron sink drops through the front of the cabinet, so the front
    // stretcher cannot exist — the apron closes that edge instead.
    const apronFront = cabinet.sink?.style === 'farmhouse';
    add({
      name: 'Top Stretcher',
      category: 'stretcher',
      materialId: cabinet.boxMaterialId,
      length: interiorWidth,
      width: spec.stretcherWidth,
      qty: apronFront ? 1 : 2,
      grain: 'length',
      notes: apronFront ? 'Rear only — the apron takes the front' : 'One at front, one at back',
    });
  } else {
    add({
      name: 'Top',
      category: 'top',
      materialId: cabinet.boxMaterialId,
      length: housedWidth,
      width: deckDepth,
      qty: 1,
      grain: 'length',
      banded: frameless ? FRONT : NONE,
    });
  }

  if (isWall) {
    add({
      name: 'Hanging Nailer',
      category: 'nailer',
      materialId: cabinet.boxMaterialId,
      length: interiorWidth,
      width: 3.5,
      qty: 2,
      grain: 'length',
      notes: 'Top and bottom, behind the back panel',
    });
  }

  // --- Back ---------------------------------------------------------------
  if (spec.backStyle !== 'none' && corner === 'diagonal') {
    // Two backs, one against each wall.
    add({
      name: 'Back (wall leg)',
      category: 'back',
      materialId: cabinet.backMaterialId,
      length: isWall ? cabinet.height : cabinet.height - kick,
      width: cabinet.width - t,
      qty: 2,
      grain: 'length',
      notes: 'One per wall',
    });
  } else if (spec.backStyle !== 'none') {
    const joined = spec.backStyle === 'rabbeted' || spec.backStyle === 'dadoed';
    const backWidth = joined ? interiorWidth + 2 * spec.backJoineryDepth : bw;
    const backHeight = isWall
      ? joined
        ? cabinet.height - 2 * t + 2 * spec.backJoineryDepth
        : cabinet.height
      : cabinet.height - kick;
    add({
      name: 'Back',
      category: 'back',
      materialId: cabinet.backMaterialId,
      length: backHeight,
      width: backWidth,
      qty: 1,
      grain: 'length',
      notes: spec.backStyle === 'applied' ? 'Applied to rear edges' : `${spec.backStyle} ${spec.backJoineryDepth}" deep`,
    });
  }

  // --- Oven pocket --------------------------------------------------------
  if (cabinet.oven) {
    const oven = cabinet.oven;
    add({
      name: 'Oven Deck',
      category: 'bottom',
      materialId: cabinet.boxMaterialId,
      length: interiorWidth,
      width: Math.min(cabinet.depth - 1, 24),
      qty: 1,
      grain: 'length',
      banded: FRONT,
      notes: 'Carries the oven — fasten into both sides',
    });
    add({
      name: 'Oven Bearer',
      category: 'nailer',
      materialId: cabinet.boxMaterialId,
      length: Math.min(cabinet.depth - 2, 23),
      width: 3,
      qty: 2,
      grain: 'length',
      notes: 'One each side under the deck; a wall oven is heavy',
    });
    add({
      name: 'Oven Header',
      category: 'stretcher',
      materialId: cabinet.boxMaterialId,
      length: interiorWidth,
      width: 3.5,
      qty: 1,
      grain: 'length',
      notes: `Closes the top of the ${snap32(oven.openingHeight)}" opening`,
    });
  }

  // --- Farmhouse sink -----------------------------------------------------
  if (cabinet.sink?.style === 'farmhouse') {
    // The sink's own apron is the exposed face, so the shop does not build a
    // panel across the front. What it does build is the ledger the bowl sits
    // on, and a filler either side if the cabinet is wider than the sink.
    add({
      name: 'Sink Support Ledger',
      category: 'nailer',
      materialId: cabinet.boxMaterialId,
      length: deckDepth - 2,
      width: 3.5,
      qty: 2,
      grain: 'length',
      notes: 'Carries the filled weight of the bowl — fasten into the sides, not just the deck',
    });

    const sideFill = (interiorWidth - cabinet.sink.width) / 2;
    if (sideFill > 0.25) {
      add({
        name: 'Apron Side Filler',
        category: 'filler',
        materialId: cabinet.faceMaterialId,
        length: cabinet.sink.apronHeight,
        width: sideFill,
        qty: 2,
        grain: 'length',
        banded: ALL,
        notes: 'Closes the face beside the sink apron',
      });
    }

    if (cabinet.sink.width > cabinet.width - 2 * t) {
      warnings.push(
        `${cabinet.name}: a ${snap32(cabinet.sink.width)}" farmhouse bowl will not pass between the sides of a ` +
          `${snap32(cabinet.width)}" cabinet. Widen the cabinet or use a narrower sink.`,
      );
    }
  }

  if (cabinet.sink && cabinet.sink.style !== 'farmhouse' && cabinet.sink.width > cabinet.width - 2 * t) {
    warnings.push(
      `${cabinet.name}: the ${snap32(cabinet.sink.width)}" bowl is wider than the ${snap32(cabinet.width - 2 * t)}" ` +
        `opening. Widen the cabinet.`,
    );
  }

  // --- Toe kick -----------------------------------------------------------
  if (isBase) {
    // A kick that matches the fronts is cut from the door material; painted
    // and plain kicks come off the carcass sheet.
    const kickMaterial =
      spec.toeKickFinish === 'face' ? cabinet.faceMaterialId : cabinet.boxMaterialId;
    const kickNote =
      spec.toeKickFinish === 'face'
        ? 'Matches the door material'
        : spec.toeKickFinish === 'painted'
          ? 'Painted out'
          : undefined;

    if (corner === 'diagonal') {
      add({
        name: 'Toe Kick (45 face)',
        category: 'toeKick',
        materialId: kickMaterial,
        length: frontalWidth(cabinet),
        width: spec.toeKickHeight,
        qty: 1,
        grain: 'length',
        notes: `Mitred both ends at 22.5 degrees to meet the returning kicks${kickNote ? `. ${kickNote}` : ''}`,
      });
      add({
        name: 'Toe Kick (wall leg)',
        category: 'toeKick',
        materialId: kickMaterial,
        length: cabinet.width - cabinet.depth,
        width: spec.toeKickHeight,
        qty: 2,
        grain: 'length',
        notes: kickNote,
      });
    } else {
      add({
        name: 'Toe Kick Face',
        category: 'toeKick',
        materialId: kickMaterial,
        // Full box width: the ends land in the notches cut in the sides, so
        // cutting it to the interior width leaves the notch open at each end
        // and a gap at every joint in the run.
        length: bw,
        width: spec.toeKickHeight,
        qty: 1,
        grain: 'length',
        notes: `Let into the side notches, ends flush with the sides${kickNote ? `. ${kickNote}` : ''}`,
      });
    }
  }

  // --- Finished back and applied end panels -------------------------------
  /*
   * An island or peninsula shows its back to the room, so it gets the same
   * treatment as a door rather than the raw carcass sheet. The panel covers
   * the box above the toe kick, matching where the doors start on the front.
   *
   * Finished *ends* work differently: `slab` means the side panel itself is
   * cut from finish-grade stock and edgebanded, which is what the estimate has
   * always priced, so it adds no part. Any other style is a decorative panel
   * applied over that side, which does.
   */
  const panelFace = (
    name: string,
    style: PanelStyle,
    width: number,
    height: number,
    qty: number,
    note: string,
  ) => {
    for (const piece of panelPieces(style, width, height, spec)) {
      add({
        name: `${name} — ${piece.name}`,
        category: 'finishedPanel',
        materialId: cabinet.faceMaterialId,
        length: piece.length,
        width: piece.width,
        qty: piece.qty * qty,
        grain: piece.grain,
        banded: style === 'slab' || style === 'beadboard' ? FRONT : NONE,
        notes: piece.notes ? `${note}. ${piece.notes}` : note,
      });
    }
  };

  const panelHeight = cabinet.height - kick;
  if (cabinet.backPanel) {
    panelFace('Back', cabinet.backPanel, bw, panelHeight, 1, 'Finished back');
  }

  // The matching half of the corner's frame, on whatever butts it.
  const returnStiles = (adjacency.left ? 1 : 0) + (adjacency.right ? 1 : 0);
  if (returnStiles > 0) {
    add({
      name: 'Corner Return Stile',
      category: 'faceFrameStile',
      materialId: cabinet.faceMaterialId,
      length: cabinet.height - kick,
      width: spec.cornerFrameWidth,
      qty: returnStiles,
      grain: 'length',
      banded: FRONT,
      notes: 'Closes the end against the corner cabinet so both doors clear',
    });
  }

  const appliedEnds =
    (cabinet.finishedLeft ? 1 : 0) + (cabinet.finishedRight ? 1 : 0);
  const endStyle = cabinet.endPanelStyle ?? 'slab';
  if (appliedEnds > 0 && endStyle !== 'slab') {
    panelFace('End', endStyle, cabinet.depth, panelHeight, appliedEnds, 'Applied end panel');
  }

  // --- Shelves ------------------------------------------------------------
  if (cabinet.shelfCount > 0) {
    if (corner === 'diagonal') {
      add({
        name: cabinet.adjustableShelves ? 'Adjustable Shelf (corner)' : 'Fixed Shelf (corner)',
        category: 'shelf',
        materialId: cabinet.boxMaterialId,
        length: cabinet.width - t - spec.shelfSideClearance,
        width: cabinet.width - t - spec.shelfSideClearance,
        qty: cabinet.shelfCount,
        grain: 'length',
        banded: FRONT,
        notes: 'Square blank, front corner cut at 45 to match the deck',
      });
    } else {
      add({
        name: cabinet.adjustableShelves ? 'Adjustable Shelf' : 'Fixed Shelf',
        category: 'shelf',
        materialId: cabinet.boxMaterialId,
        // An adjustable shelf sits on pins and wants clearance; a fixed one is
        // housed in the sides, so it takes the dado allowance instead.
        length: cabinet.adjustableShelves
          ? interiorWidth - spec.shelfSideClearance
          : housedWidth,
        width: deckDepth - spec.shelfSetback,
        qty: cabinet.shelfCount,
        grain: 'length',
        banded: FRONT,
        notes:
          corner === 'blind'
            ? 'Reaches into the blind section; a pull-out is the usual alternative'
            : undefined,
      });
    }
  }

  // --- Face frame ---------------------------------------------------------
  if (!frameless) {
    const stileLength = cabinet.height - kick;
    // Rails span the face, which on a corner is the 45 degree front or the
    // reachable part of a blind — not the cabinet's plan width. The frame is
    // full nominal width regardless of how far the box is set in behind it.
    const railLength = frontalWidth(cabinet) - 2 * spec.frameStileWidth;
    const railCount = 2 + Math.max(0, layout.openings.length - 1);

    add({
      name: 'Face Frame Stile',
      category: 'faceFrameStile',
      materialId: cabinet.faceMaterialId,
      length: stileLength,
      width: spec.frameStileWidth,
      qty: 2,
      grain: 'length',
    });
    // A crowned cabinet runs a wider top rail: the moulding laps an inch down
    // over the cabinet top, so a 1-1/2" rail leaves almost nothing to fasten
    // into once that lap is taken off.
    const topRailWidth = crowned ? spec.crownTopRailWidth : spec.frameRailWidth;
    add({
      name: crowned ? 'Face Frame Top Rail (crown)' : 'Face Frame Rail',
      category: 'faceFrameRail',
      materialId: cabinet.faceMaterialId,
      length: railLength,
      width: topRailWidth,
      qty: 1,
      grain: 'length',
      notes: crowned ? 'Wider so the crown has something to fasten into' : undefined,
    });
    if (railCount > 1) {
      add({
        name: 'Face Frame Rail',
        category: 'faceFrameRail',
        materialId: cabinet.faceMaterialId,
        length: railLength,
        width: spec.frameRailWidth,
        qty: railCount - 1,
        grain: 'length',
      });
    }

    if (cabinet.doorCount === 2 && spec.doorMount === 'inset') {
      const doorOpening = layout.openings.find((o) => o.kind === 'door');
      if (doorOpening) {
        add({
          name: 'Center Mullion',
          category: 'faceFrameMullion',
          materialId: cabinet.faceMaterialId,
          length: doorOpening.openingHeight,
          width: spec.frameStileWidth,
          qty: 1,
          grain: 'length',
          notes: 'Inset door pair divider',
        });
      }
    }
  }

  // --- Doors and drawer fronts -------------------------------------------
  for (const op of layout.openings) {
    if (op.kind === 'door') {
      add({
        name: 'Door',
        category: 'door',
        materialId: cabinet.faceMaterialId,
        length: op.frontHeight,
        width: op.frontWidth,
        qty: op.frontCount,
        grain: 'length',
        banded: ALL,
        notes: `${spec.doorMount} on ${spec.construction === 'faceFrame' ? 'face frame' : 'frameless box'}`,
      });
    } else {
      const idx = op.drawerIndex ?? 0;
      const isFalse = !!cabinet.drawers[idx]?.falseFront;
      add({
        name: isFalse ? `False Front ${idx + 1}` : `Drawer Front ${idx + 1}`,
        category: 'drawerFront',
        materialId: cabinet.faceMaterialId,
        length: op.frontHeight,
        width: op.frontWidth,
        qty: 1,
        grain: 'length',
        banded: ALL,
        notes: isFalse ? 'Fixed panel — no drawer box behind it' : undefined,
      });
    }
  }

  // --- Drawer boxes -------------------------------------------------------
  const bottomMaterialId =
    cabinet.drawerBottomMaterialId ?? project.defaultDrawerBottomMaterialId ?? 'bb-14';
  const bottomThickness = materialThickness(mats, bottomMaterialId);
  const bottomGroove = spec.drawerBottomGroove ?? 0.25;
  const boxOuterWidth =
    (frameless ? interiorWidth : layout.interiorOpeningWidth) - 2 * spec.drawerSlideClearance;
  const boxDepthInside = cabinet.depth - spec.drawerBoxDepthReduction;

  /*
   * Box heights follow the front the layout actually produced, not the height
   * stored on the drawer. A face frame re-fits those fronts to its rails, and
   * reading the stored height here would build a box taller than the opening
   * it has to pass through.
   */
  const fittedFront = new Map<number, number>();
  const fittedOpening = new Map<number, number>();
  for (const op of layout.openings) {
    if (op.kind === 'drawer' && op.drawerIndex !== undefined) {
      fittedFront.set(op.drawerIndex, op.frontHeight);
      fittedOpening.set(op.drawerIndex, op.openingHeight);
    }
  }

  cabinet.drawers.forEach((d, i) => {
    // A false front is a fixed panel — no box, no bottom, no slides.
    if (d.falseFront) return;
    /*
     * The box has to pass through the hole in front of it. On a frameless box
     * that hole is the front itself, so the front is the right reference. On a
     * face frame the front laps the rails and is larger than the opening it
     * covers — size off the front there and the drawer will not go in.
     */
    const constrained =
      spec.construction === 'faceFrame'
        ? (fittedOpening.get(i) ?? d.frontHeight)
        : (fittedFront.get(i) ?? d.frontHeight);
    const boxHeight = d.boxHeightOverride ?? Math.max(2.5, constrained - spec.drawerBoxHeightReduction);
    if (boxOuterWidth <= 0 || boxDepthInside <= 0) {
      warnings.push(`${cabinet.name}: drawer ${i + 1} box does not fit — check width and depth.`);
      return;
    }
    add({
      name: `Drawer ${i + 1} Box Side`,
      category: 'drawerBoxSide',
      materialId: cabinet.drawerBoxMaterialId,
      length: boxDepthInside,
      width: boxHeight,
      qty: 2,
      grain: 'length',
      banded: FRONT,
    });
    add({
      name: `Drawer ${i + 1} Box Front/Back`,
      category: 'drawerBoxFrontBack',
      materialId: cabinet.drawerBoxMaterialId,
      length: boxOuterWidth - 2 * dbt,
      width: boxHeight,
      qty: 2,
      grain: 'length',
      banded: FRONT,
    });
    /*
     * The bottom is its own stock, normally thinner than the sides. The groove
     * depth is what sizes the panel, not the panel's thickness — a 1/2" bottom
     * still drops into a 1/4"-deep groove — so only the material and the note
     * change when the stock does. The groove has to be cut to suit its width.
     */
    add({
      name: `Drawer ${i + 1} Bottom`,
      category: 'drawerBottom',
      materialId: bottomMaterialId,
      length: boxOuterWidth - 2 * dbt + 2 * bottomGroove,
      width: boxDepthInside - 2 * dbt + 2 * bottomGroove,
      qty: 1,
      grain: 'none',
      notes:
        `${formatFrac(bottomThickness)}" panel in a ` +
        `${formatFrac(bottomGroove)}"-deep groove all round`,
    });
  });

  // --- Sanity checks ------------------------------------------------------
  if (corner === 'diagonal' && cabinet.width - cabinet.depth < 8) {
    warnings.push(
      `${cabinet.name}: a ${cabinet.width}" diagonal corner against ${cabinet.depth}" deep runs leaves only a ` +
        `${frontalWidth(cabinet).toFixed(1)}" door. Widen it — 36" is standard for a 24" base run.`,
    );
  }
  if (corner === 'blind' && frontalWidth(cabinet) < 12) {
    warnings.push(
      `${cabinet.name}: the blind section leaves a ${frontalWidth(cabinet).toFixed(1)}" opening, too narrow to reach through.`,
    );
  }
  if (corner === 'diagonal' && frameless && spec.cornerFillerWidth <= 0) {
    warnings.push(
      `${cabinet.name}: a frameless corner with no filler will jam its door against the neighbouring door. ` +
        `Set a corner filler under Settings → Construction.`,
    );
  }
  if (bw <= 2 * t) warnings.push(`${cabinet.name}: width is smaller than two side panels.`);
  if (isBase && cabinet.height <= spec.toeKickHeight + 6)
    warnings.push(`${cabinet.name}: height leaves no usable box above the toe kick.`);
  if (cabinet.depth <= spec.toeKickDepth + 4)
    warnings.push(`${cabinet.name}: depth is too shallow for the toe kick setback.`);

  return { parts: out, warnings, layout };
}

export interface ProjectParts {
  parts: Part[];
  warnings: string[];
  byCabinet: Map<string, CabinetParts>;
}

/**
 * Run of trim across the top of a cabinet.
 *
 * Only the faces that show get moulding: the front always, plus either end
 * that is not buried against a neighbour of the same height. Exposed ends are
 * detected by looking for another crowned cabinet butting that end at the
 * same top height.
 */
export function crownRunLength(cabinet: Cabinet, all: Cabinet[]): number {
  const topOf = (c: Cabinet) => (c.mountHeight ?? (c.type === 'wall' ? 54 : 0)) + c.height;
  const myTop = topOf(cabinet);
  /*
   * Neighbours are found along the wall, not along world x/z. Comparing raw
   * coordinates only works on a wall at zero degrees; on any other wall every
   * cabinet looked like it had two exposed ends and picked up a returned
   * mitre at each, quietly inflating the crown footage in the cut list.
   */
  const runOf = (c: Cabinet) => c.along ?? c.x;
  const sameRun = all.filter(
    (c) =>
      c.id !== cabinet.id &&
      !c.excluded &&
      Math.abs(topOf(c) - myTop) < 0.5 &&
      c.wallId === cabinet.wallId,
  );

  const mine = runOf(cabinet);
  const touchesLeft = sameRun.some((c) => Math.abs(runOf(c) + c.width - mine) < 0.5);
  const touchesRight = sameRun.some((c) => Math.abs(mine + cabinet.width - runOf(c)) < 0.5);

  let run = frontalWidth(cabinet);
  if (!touchesLeft) run += cabinet.depth;
  if (!touchesRight) run += cabinet.depth;
  return run;
}

/**
 * Shop-built woodwork for a bar wall.
 *
 * The stone or butcher block on top is priced the way every other counter in
 * this app is — as an extra line item — so it is not a cut part here. What the
 * shop actually cuts is the substrate the wall is skinned with and the
 * finished panel on the seating side.
 */
export function generateBarTopParts(
  bar: BarTop,
  project: Pick<Project, 'defaults' | 'materials' | 'defaultBoxMaterialId' | 'defaultFaceMaterialId'>,
): { parts: Part[]; warnings: string[] } {
  const spec = project.defaults;
  const out: Part[] = [];
  const warnings: string[] = [];
  const faceMaterial = bar.panelMaterialId ?? project.defaultFaceMaterialId;
  // A plastered wall carrying a counter is somebody else's work. It still gets
  // checked for height and knee room, because the slab on top is ours.
  const shopBuilt = (bar.panelStyle ?? 'slab') !== 'none';

  const add = (p: PartInput) => {
    if (p.qty <= 0) return;
    if (p.length <= 0 || p.width <= 0) {
      warnings.push(`${bar.name}: skipped "${p.name}" — computed a non-positive size.`);
      return;
    }
    out.push({
      id: nextId(),
      cabinetId: bar.id,
      cabinetName: bar.name,
      name: p.name,
      category: p.category,
      materialId: p.materialId,
      length: snap32(p.length),
      width: snap32(p.width),
      thickness: materialThickness(project.materials, p.materialId),
      qty: p.qty,
      grain: p.grain,
      banded: p.banded ?? NONE,
      notes: p.notes,
    });
  };

  if (shopBuilt) {
    add({
      name: 'Bar Wall Substrate',
      category: 'barTop',
      materialId: project.defaultBoxMaterialId,
      length: bar.length,
      width: bar.wallHeight,
      qty: 1,
      grain: 'length',
      notes: 'Skin for the pony wall; the finished panel lands on this',
    });

    for (const piece of panelPieces(bar.panelStyle as PanelStyle, bar.length, bar.wallHeight, spec)) {
      add({
        name: `Bar Wall — ${piece.name}`,
        category: 'finishedPanel',
        materialId: faceMaterial,
        length: piece.length,
        width: piece.width,
        qty: piece.qty,
        grain: piece.grain,
        banded: NONE,
        notes: piece.notes ? `Seating side. ${piece.notes}` : 'Seating side',
      });
    }
  }

  // A bar that does not clear the counter behind it is a drawing error, not a
  // design choice — the slab would land on the countertop.
  if (bar.wallHeight <= 36) {
    warnings.push(
      `${bar.name}: at ${snap32(bar.wallHeight)}" the wall is no taller than the counter behind it. ` +
        `A raised bar normally frames to 42".`,
    );
  }
  if (bar.overhangFront < 10) {
    warnings.push(
      `${bar.name}: ${snap32(bar.overhangFront)}" of knee room is tight for seating — 12" is the usual minimum, 15" is comfortable.`,
    );
  }

  return { parts: out, warnings };
}

/** Plan footprint of a bar top slab, including every overhang. */
export function barTopSlabSize(bar: BarTop): { length: number; depth: number } {
  return {
    length: bar.length + bar.overhangLeft + bar.overhangRight,
    depth: bar.thickness + bar.overhangFront + bar.overhangBack,
  };
}

export function generateProjectParts(project: Project): ProjectParts {
  partSeq = 0;
  const parts: Part[] = [];
  const warnings: string[] = [];
  const byCabinet = new Map<string, CabinetParts>();

  for (const cab of project.cabinets) {
    if (cab.excluded) continue;
    const res = generateCabinetParts(cab, project);
    byCabinet.set(cab.id, res);
    parts.push(...res.parts);
    warnings.push(...res.warnings);
  }

  for (const bar of project.barTops ?? []) {
    if (bar.excluded) continue;
    const res = generateBarTopParts(bar, project);
    parts.push(...res.parts);
    warnings.push(...res.warnings);
  }

  const active = project.cabinets.filter((c) => !c.excluded);

  // --- Crown moulding -----------------------------------------------------
  const crown = project.crown;
  if (crown?.enabled) {
    for (const cab of active) {
      // Default to crowning wall and tall cabinets, which is where it goes.
      const wants = cab.crown ?? (cab.type === 'wall' || cab.type === 'tall');
      if (!wants) continue;
      const run = crownRunLength(cab, active) * (1 + crown.wasteFactor);
      parts.push({
        id: nextId(),
        cabinetId: cab.id,
        cabinetName: cab.name,
        name: crown.name,
        category: 'crown',
        materialId: crown.millInShop ? crown.materialId : BOUGHT_IN,
        length: snap32(run),
        width: crown.height,
        thickness: crown.projection,
        qty: 1,
        grain: 'length',
        banded: NONE,
        notes: crown.millInShop
          ? `Milled in shop. Includes ${(crown.wasteFactor * 100).toFixed(0)}% for mitres`
          : `Bought in. Includes ${(crown.wasteFactor * 100).toFixed(0)}% for mitres`,
      });
    }
  }

  // --- Light rail ---------------------------------------------------------
  const rail = project.lightRail;
  if (rail?.enabled) {
    for (const cab of active.filter((c) => c.type === 'wall')) {
      parts.push({
        id: nextId(),
        cabinetId: cab.id,
        cabinetName: cab.name,
        name: 'Light Rail',
        category: 'lightRail',
        materialId: BOUGHT_IN,
        length: snap32(frontalWidth(cab) * 1.1),
        width: rail.height,
        thickness: rail.projection,
        qty: 1,
        grain: 'length',
        notes: 'Under the wall cabinets, hides the task lighting',
        banded: NONE,
      });
    }
  }

  // --- Appliance panels ---------------------------------------------------
  for (const app of project.appliances ?? []) {
    if (!app.panelReady) continue;
    const count = app.panelCount ?? 1;
    const panelWidth = app.width / count;
    parts.push({
      id: nextId(),
      cabinetId: app.id,
      cabinetName: app.name,
      name: 'Appliance Panel',
      category: 'appliancePanel',
      materialId: project.defaultFaceMaterialId,
      length: snap32(app.height),
      width: snap32(panelWidth),
      thickness: 0.75,
      qty: count,
      grain: 'length',
      banded: ALL,
      notes: `${app.name} — confirm the manufacturer's panel spec before cutting`,
    });
  }

  return { parts, warnings, byCabinet };
}

/** Merge identical parts across cabinets into a single cut-list row. */
export interface CutListRow {
  key: string;
  materialId: string;
  name: string;
  category: PartCategory;
  length: number;
  width: number;
  thickness: number;
  grain: Part['grain'];
  qty: number;
  cabinets: string[];
  banded: EdgeFlags;
  /** Machining the part needs — toe notch, dado setout, grain note. */
  notes?: string;
}

export function rollupCutList(parts: Part[]): CutListRow[] {
  const map = new Map<string, CutListRow>();
  for (const p of parts) {
    /*
     * Notes are part of the key, not just carried along. Two sides can be the
     * same size and material and still be different parts — one grooved for
     * two shelves, one for three. Merging those on size alone would hand the
     * shop a single row and lose one of the setouts.
     */
    const key = [
      p.materialId,
      p.name,
      p.length.toFixed(4),
      p.width.toFixed(4),
      p.grain,
      p.notes ?? '',
    ].join('|');
    const existing = map.get(key);
    if (existing) {
      existing.qty += p.qty;
      if (!existing.cabinets.includes(p.cabinetName)) existing.cabinets.push(p.cabinetName);
    } else {
      map.set(key, {
        key,
        materialId: p.materialId,
        name: p.name,
        category: p.category,
        length: p.length,
        width: p.width,
        thickness: p.thickness,
        grain: p.grain,
        qty: p.qty,
        cabinets: [p.cabinetName],
        banded: p.banded,
        notes: p.notes,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => a.materialId.localeCompare(b.materialId) || b.length * b.width - a.length * a.width,
  );
}
