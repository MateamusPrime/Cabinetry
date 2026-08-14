import type {
  Appliance,
  BarTop,
  Cabinet,
  ConstructionSpec,
  Material,
  PanelStyle,
  Project,
  RoomSpec,
  Wall,
  WindowOpening,
} from './types';
import { materialThickness, speciesColor } from './materials';
import {
  computeFaceLayout,
  cornerAdjacency,
  cornerFillerAllowance,
  cornerFrameSetback,
  crownContext,
  frameOverhangs,
  specFor,
} from './partsGenerator';
import {
  APPLIANCE_COLOR,
  bridgeBottomForMicrowave,
  COOKTOP_CLEARANCE_MINIMUM,
  COOKTOP_TO_BARE_CABINET,
  COOKTOP_TO_OVERHEAD_UNIT,
  OTR_MICROWAVE_HEIGHT,
} from './defaults';

export type BoxRole =
  | 'box'
  | 'back'
  | 'shelf'
  | 'kick'
  | 'frame'
  | 'door'
  | 'drawerFront'
  | 'stretcher'
  | 'crown'
  | 'filler';

export interface Box3D {
  key: string;
  role: BoxRole;
  /** Centre point in cabinet-local space. */
  pos: [number, number, number];
  size: [number, number, number];
  color: string;
  label?: string;
  /** Rotation about the vertical axis, radians. Used for 45° corner faces. */
  rotY?: number;
  /**
   * Horizontal outline in cabinet-local XZ. When set, the part is extruded
   * vertically instead of drawn as a box, so a corner deck or shelf is a real
   * pentagon rather than an L that leaves a void at the 45 degree face.
   * `pos` still gives the vertical centre and `size[1]` the thickness.
   */
  polygon?: [number, number][];
}

/**
 * Build the solid geometry for one cabinet in its own coordinate space:
 *   x runs left to right across the face,
 *   y runs up from the finished floor,
 *   z runs from the back of the cabinet toward the viewer.
 *
 * This shares `computeFaceLayout` with the parts generator, so what you see
 * on screen and what lands on the cut list are derived from one calculation.
 */
export function buildCabinetGeometry(
  cabinet: Cabinet,
  project: Pick<Project, 'defaults' | 'materials'> &
    Partial<Pick<Project, 'crown' | 'view' | 'cabinets'>>,
  opts: { showDoors?: boolean } = {},
): Box3D[] {
  const spec: ConstructionSpec = specFor(cabinet, project.defaults);
  const mats: Material[] = project.materials;

  const t = materialThickness(mats, cabinet.boxMaterialId);
  const bt = materialThickness(mats, cabinet.backMaterialId);
  const ft = spec.frameThickness;
  const frameless = spec.construction === 'frameless';
  const faceThickness = materialThickness(mats, cabinet.faceMaterialId);

  const W = cabinet.width;
  const H = cabinet.height;
  const yBase = cabinet.mountHeight ?? (cabinet.type === 'wall' ? 54 : 0);
  const isWall = cabinet.type === 'wall';
  const kick = isWall ? 0 : spec.toeKickHeight;

  const boxDepth = frameless ? cabinet.depth : cabinet.depth - ft;
  const backAllowance = spec.backStyle === 'none' ? 0 : bt;
  const sideDepth = spec.backStyle === 'applied' ? boxDepth - bt : boxDepth;
  const sideZStart = boxDepth - sideDepth;

  /*
   * Where the carcass sits across the cabinet. A face frame runs proud of its
   * box on any buried side, so the box is set in from the nominal width — the
   * frame still spans the full width in front of it.
   */
  const oh = frameOverhangs(cabinet, spec, project);
  const boxX0 = oh.left;
  const boxX1 = W - oh.right;

  const boxMat = mats.find((m) => m.id === cabinet.boxMaterialId);
  const faceMat = mats.find((m) => m.id === cabinet.faceMaterialId);
  const backMat = mats.find((m) => m.id === cabinet.backMaterialId);
  /*
   * A view override paints the render without touching the specification, so
   * a client can be shown the same kitchen in a different finish while the cut
   * list and the estimate stay on the material actually chosen. Unset, the
   * colour comes from that material's species as before.
   */
  const boxColor =
    project.view?.boxColor || speciesColor(boxMat && 'species' in boxMat ? boxMat.species : 'Maple');
  const faceColor =
    project.view?.doorColor || speciesColor(faceMat && 'species' in faceMat ? faceMat.species : 'Maple');
  const backColor =
    project.view?.boxColor || speciesColor(backMat && 'species' in backMat ? backMat.species : 'Maple');
  // Show the kick in whatever it is actually made of. It sits 3" back in its
  // own shadow, so darkening it on top of that just turned it into a black
  // hole on a light-background render.
  const kickColor =
    spec.toeKickFinish === 'painted'
      ? spec.toeKickPaintColor
      : spec.toeKickFinish === 'face'
        ? faceColor
        : boxColor;

  const out: Box3D[] = [];
  let seq = 0;
  const push = (
    role: BoxRole,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    color: string,
    label?: string,
  ) => {
    const w = x1 - x0;
    const h = y1 - y0;
    const d = z1 - z0;
    if (w <= 0.005 || h <= 0.005 || d <= 0.005) return;
    out.push({
      key: `${cabinet.id}-${role}-${seq++}`,
      role,
      pos: [x0 + w / 2, yBase + y0 + h / 2, z0 + d / 2],
      size: [w, h, d],
      color,
      label,
    });
  };

  const corner = cabinet.corner ?? 'none';

  // --- Filler -------------------------------------------------------------
  // A single panel standing at the front of the run, flush with the doors.
  if (cabinet.type === 'filler') {
    push('filler', 0, W, 0, H, cabinet.depth - faceThickness, cabinet.depth, faceColor, 'Filler');
    return out;
  }

  // --- Diagonal corner ----------------------------------------------------
  // Not a box at all: a square footprint against both walls with the front
  // corner taken off at 45 degrees.
  if (corner === 'diagonal') {
    const D = cabinet.depth;
    const faceLen = Math.max(6, (W - D) * Math.SQRT2);

    /*
     * Two carcass sides, one facing each returning run — each carrying the
     * same toe notch every other base gets. Running them straight to the floor
     * left the sides standing in front of the kick face, which hid the recess
     * and made the corner read as though it had no toe kick at all.
     */
    const legDepthAt = D - spec.toeKickDepth;
    if (kick > 0) {
      push('box', W - t, W, kick, H, 0, D, boxColor, 'Side (back wall run)');
      push('box', W - t, W, 0, kick, 0, legDepthAt, boxColor, 'Side (back wall run, toe leg)');
      push('box', 0, D, kick, H, W - t, W, boxColor, 'Side (left wall run)');
      push('box', 0, legDepthAt, 0, kick, W - t, W, boxColor, 'Side (left wall run, toe leg)');
    } else {
      push('box', W - t, W, 0, H, 0, D, boxColor, 'Side (back wall run)');
      push('box', 0, D, 0, H, W - t, W, boxColor, 'Side (left wall run)');
    }

    // Backs against each wall.
    if (spec.backStyle !== 'none') {
      push('back', 0, W, kick, H, 0, bt, backColor, 'Back (back wall)');
      push('back', 0, bt, kick, H, 0, W, backColor, 'Back (left wall)');
    }

    /**
     * Interior outline of a horizontal panel: a pentagon bounded by the two
     * backs, the two side panels, and the 45 degree face.
     *
     * The diagonal sits on the line x + z = W + D - t, which meets the side
     * panels exactly at (W - t, D) and (D, W - t). Building it as two boxes
     * instead leaves a triangular void you can see straight through.
     */
    const panelOutline = (inset: number): [number, number][] => {
      const a = bt + inset;
      const b = W - t - inset;
      const c = D - inset;
      return [
        [a, a],
        [b, a],
        [b, c],
        [c, b],
        [a, b],
      ];
    };

    const pushPanel = (
      role: BoxRole,
      y0: number,
      thickness: number,
      inset: number,
      label: string,
    ) => {
      const poly = panelOutline(inset);
      // Bounding box so the 2D elevation, which cannot draw a polygon, still
      // has something sensible to show.
      const xs = poly.map((p) => p[0]);
      const zs = poly.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const z0 = Math.min(...zs);
      const z1 = Math.max(...zs);
      out.push({
        key: `${cabinet.id}-${role}-${seq++}`,
        role,
        pos: [(x0 + x1) / 2, yBase + y0 + thickness / 2, (z0 + z1) / 2],
        size: [x1 - x0, thickness, z1 - z0],
        color: boxColor,
        label,
        polygon: poly,
      });
    };

    pushPanel('box', kick, t, 0, 'Deck');

    if (!isWall) {
      push('stretcher', bt, W - t, H - t, H, bt, D, boxColor, 'Top gusset');
    } else {
      pushPanel('box', H - t, t, 0, 'Top');
    }

    for (let i = 1; i <= cabinet.shelfCount; i++) {
      const span = H - t - (kick + t);
      const y = kick + t + (span / (cabinet.shelfCount + 1)) * i;
      pushPanel('shelf', y, t, cabinet.adjustableShelves ? spec.shelfSideClearance / 2 : 0, `Shelf ${i}`);
    }

    /*
     * Everything on the 45 degree face is placed in that face's own frame:
     * `along` runs across it and `out` stands proud of it. Without this the
     * corner rendered frameless no matter what the project was set to,
     * because the branch returned before the face-frame code ever ran.
     */
    const cx = (W + D) / 2;
    const cz = (W + D) / 2;
    // Unit vector across the face, and the outward normal.
    const ax = Math.SQRT1_2;
    const az = -Math.SQRT1_2;
    const nx = Math.SQRT1_2;
    const nz = Math.SQRT1_2;

    const onFace = (
      role: BoxRole,
      along: number,
      widthAlong: number,
      y0: number,
      y1: number,
      outAt: number,
      thickness: number,
      color: string,
      label: string,
    ) => {
      if (widthAlong <= 0.01 || y1 - y0 <= 0.01) return;
      const off = outAt + thickness / 2;
      out.push({
        key: `${cabinet.id}-face-${seq++}`,
        role,
        pos: [cx + ax * along + nx * off, yBase + (y0 + y1) / 2, cz + az * along + nz * off],
        size: [widthAlong, y1 - y0, thickness],
        color,
        label,
        rotY: Math.PI / 4,
      });
    };

    const framed = spec.construction === 'faceFrame';
    const crownC = crownContext(cabinet, project);
    const layoutC = computeFaceLayout(cabinet, spec, mats, crownC);
    const door = layoutC.openings.find((o) => o.kind === 'door');

    if (framed) {
      const stile = spec.frameStileWidth;
      const rail = spec.frameRailWidth;
      /*
       * A crowned cabinet runs a wider top rail so the moulding has something
       * to fasten into once it laps down over the top. The corner draws its own
       * frame on the 45 face, and was drawing a standard rail there while the
       * cut list cut the wide one — the two disagreed on every crowned corner.
       */
      const topRail = crownC.crowned ? spec.crownTopRailWidth : rail;
      const ft2 = spec.frameThickness;
      const half = faceLen / 2;

      /*
       * The frame occupies the last of the box's depth rather than standing on
       * the outside of it, so the 45 face finishes flush and the stiles mitre
       * into the wall legs. A square cabinet gets this for free — its box is
       * cut shallower by the frame thickness — but the corner is built to the
       * diagonal, so the frame has to be set back into it here instead.
       */
      const frameIn = -ft2;

      // Stiles down each edge of the 45 face, mitred into the wall legs.
      onFace('frame', -(half - stile / 2), stile, kick, H, frameIn, ft2, faceColor, 'Corner stile');
      onFace('frame', half - stile / 2, stile, kick, H, frameIn, ft2, faceColor, 'Corner stile');
      // Rails between them.
      const railLen = faceLen - 2 * stile;
      onFace('frame', 0, railLen, H - topRail, H, frameIn, ft2, faceColor, 'Top rail');
      onFace('frame', 0, railLen, kick, kick + rail, frameIn, ft2, faceColor, 'Bottom rail');
    }

    if (opts.showDoors !== false && door) {
      const inset = spec.doorMount === 'inset';
      /*
       * The frame is now flush with the 45 face, so an overlay door lands
       * straight on that face — the same plane a frameless door sits on — and
       * an inset one is recessed into the frame's own thickness.
       */
      const doorOut = framed && inset ? -faceThickness : 0;
      const doorBottom = framed
        ? kick + spec.frameRailWidth - (inset ? 0 : spec.overlay)
        : kick + spec.revealEdge;

      onFace(
        'door',
        0,
        door.frontWidth,
        doorBottom,
        doorBottom + door.frontHeight,
        doorOut,
        faceThickness,
        faceColor,
        'Corner door',
      );
    }

    /*
     * A narrow frame at each end of a frameless 45 face, mitred into the box
     * side. Set at the face of the box rather than standing proud of it, so
     * the door laps over it the way an overlay door should — a slab of filler
     * sitting out in front of the box is what read as wrong in the drawing.
     */
    const cornerStile = cornerFillerAllowance(cabinet, spec) / 2;
    if (cornerStile > 0) {
      const half = faceLen / 2;
      for (const side of [-1, 1] as const) {
        onFace(
          'frame',
          side * (half - cornerStile / 2),
          cornerStile,
          kick,
          H,
          -faceThickness,
          faceThickness,
          faceColor,
          'Corner frame stile',
        );
      }
    }

    if (kick > 0) {
      onFace('kick', 0, faceLen, 0, kick, -spec.toeKickDepth, t, kickColor, 'Toe kick');
    }

    // Crown for corners is handled by `crownRuns` along with everything else,
    // so its 45 face chains into the neighbouring runs and mitres properly.

    return out;
  }

  // --- Sides --------------------------------------------------------------
  // Base and tall cabinets carry a toe notch, so each side is drawn as an
  // upper panel plus a rear leg rather than one rectangle.
  const drawSide = (x0: number, x1: number) => {
    if (kick > 0) {
      push('box', x0, x1, kick, H, sideZStart, boxDepth, boxColor, 'Side');
      push('box', x0, x1, 0, kick, sideZStart, boxDepth - spec.toeKickDepth, boxColor, 'Side (toe leg)');
    } else {
      push('box', x0, x1, 0, H, sideZStart, boxDepth, boxColor, 'Side');
    }
  };
  drawSide(boxX0, boxX0 + t);
  drawSide(boxX1 - t, boxX1);

  // --- Deck ---------------------------------------------------------------
  // Full depth, back panel to front edge. The deck sits above the toe notch,
  // where the side is still full depth, so the kick setback does not apply to
  // it — and the front stretcher and shelves below key off this too.
  const deckZ0 = backAllowance;
  const deckZ1 = boxDepth;
  push('box', boxX0 + t, boxX1 - t, kick, kick + t, deckZ0, deckZ1, boxColor, 'Deck');

  // --- Top ----------------------------------------------------------------
  if (!isWall && spec.baseTopStyle === 'stretchers') {
    // An apron sink drops through the front of the cabinet, so there is no
    // front stretcher to run across it — the apron itself closes that edge.
    if (cabinet.sink?.style !== 'farmhouse') {
      push('stretcher', boxX0 + t, boxX1 - t, H - t, H, deckZ1 - spec.stretcherWidth, deckZ1, boxColor, 'Front stretcher');
    }
    push('stretcher', boxX0 + t, boxX1 - t, H - t, H, deckZ0, deckZ0 + spec.stretcherWidth, boxColor, 'Rear stretcher');
  } else {
    push('box', boxX0 + t, boxX1 - t, H - t, H, deckZ0, deckZ1, boxColor, 'Top');
  }

  // --- Back ---------------------------------------------------------------
  if (spec.backStyle !== 'none') {
    const joined = spec.backStyle === 'rabbeted' || spec.backStyle === 'dadoed';
    const bx0 = boxX0 + (joined ? t - spec.backJoineryDepth : 0);
    const bx1 = boxX1 - (joined ? t - spec.backJoineryDepth : 0);
    const by0 = isWall ? (joined ? t - spec.backJoineryDepth : 0) : kick;
    const by1 = isWall ? (joined ? H - t + spec.backJoineryDepth : H) : H;
    push('back', bx0, bx1, by0, by1, 0, bt, backColor, 'Back');
  }

  // --- Finished back and applied end panels -------------------------------
  /*
   * An island or peninsula shows its back to the room. Drawn as real rails,
   * stiles and a field rather than one flat sheet so a shaker back reads the
   * same way a shaker door does, and so the raised style has something to
   * catch the light on.
   *
   * The field is set slightly proud of the frame for `raised` and slightly
   * behind it for `shaker`, which is the whole visual difference between them.
   */
  const panelFrame = (
    style: PanelStyle,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    outer: number,
    inner: number,
    label: string,
  ) => {
    const flip = outer < inner;
    const face = (a: number, b: number) => (flip ? ([a, b] as const) : ([b, a] as const));

    if (style === 'slab' || style === 'beadboard') {
      const [z0, z1] = face(outer, inner);
      push('frame', x0, x1, y0, y1, z0, z1, faceColor, label);
      return;
    }

    const s = spec.frameStileWidth;
    const r = spec.frameRailWidth;
    const [fz0, fz1] = face(outer, inner);
    // Stiles run the full height, rails sit between them — same as a door.
    push('frame', x0, x0 + s, y0, y1, fz0, fz1, faceColor, `${label} stile`);
    push('frame', x1 - s, x1, y0, y1, fz0, fz1, faceColor, `${label} stile`);
    push('frame', x0 + s, x1 - s, y0, y0 + r, fz0, fz1, faceColor, `${label} rail`);
    push('frame', x0 + s, x1 - s, y1 - r, y1, fz0, fz1, faceColor, `${label} rail`);

    // The field: proud of the frame when raised, recessed when shaker.
    const depth = Math.abs(inner - outer);
    const raised = style === 'raised';
    const fieldOuter = flip
      ? outer + (raised ? depth * 0.35 : depth * 0.6)
      : outer - (raised ? depth * 0.35 : depth * 0.6);
    const [pz0, pz1] = face(fieldOuter, inner);
    push('frame', x0 + s, x1 - s, y0 + r, y1 - r, pz0, pz1, faceColor, `${label} panel`);
  };

  const panelThickness = faceThickness;
  const panelBottom = kick;
  if (cabinet.backPanel) {
    // Applied to the back of the box, so it spans the box, not the frame.
    panelFrame(cabinet.backPanel, boxX0, boxX1, panelBottom, H, -panelThickness, 0, 'Back panel');
  }

  const endStyle = cabinet.endPanelStyle ?? 'slab';
  if (endStyle !== 'slab') {
    // An applied end stands on the outside of the side panel, so it is drawn
    // in the z–y plane: across the depth rather than across the width.
    const endPanel = (atLeft: boolean) => {
      const s = spec.frameStileWidth;
      const r = spec.frameRailWidth;
      // Stands on the outside of the side panel, which is set in on a frame
      // cabinet — though a finished end takes no overhang, so usually flush.
      const x0 = atLeft ? boxX0 - panelThickness : boxX1;
      const x1 = atLeft ? boxX0 : boxX1 + panelThickness;
      const z0 = sideZStart;
      const z1 = boxDepth;
      const raised = endStyle === 'raised';

      if (endStyle === 'beadboard') {
        push('frame', x0, x1, panelBottom, H, z0, z1, faceColor, 'End panel');
        return;
      }
      push('frame', x0, x1, panelBottom, H, z0, z0 + s, faceColor, 'End panel stile');
      push('frame', x0, x1, panelBottom, H, z1 - s, z1, faceColor, 'End panel stile');
      push('frame', x0, x1, panelBottom, panelBottom + r, z0 + s, z1 - s, faceColor, 'End panel rail');
      push('frame', x0, x1, H - r, H, z0 + s, z1 - s, faceColor, 'End panel rail');
      const shrink = raised ? panelThickness * 0.35 : panelThickness * 0.6;
      push(
        'frame',
        atLeft ? x0 + shrink : x0,
        atLeft ? x1 : x1 - shrink,
        panelBottom + r,
        H - r,
        z0 + s,
        z1 - s,
        faceColor,
        'End panel field',
      );
    };
    if (cabinet.finishedLeft) endPanel(true);
    if (cabinet.finishedRight) endPanel(false);
  }

  // --- Toe kick -----------------------------------------------------------
  /*
   * The kick spans the full width of the box, not the width between the sides.
   * It is let into the notches cut in the sides, so its ends land in them —
   * running it only between the sides left the notch open at each end and put
   * a gap the thickness of two sides at every joint in a run.
   */
  if (kick > 0) {
    push('kick', boxX0, boxX1, 0, kick, boxDepth - spec.toeKickDepth - t, boxDepth - spec.toeKickDepth, kickColor, 'Toe kick');
  }

  // --- Shelves ------------------------------------------------------------
  if (cabinet.shelfCount > 0) {
    const interiorBottom = kick + t;
    const interiorTop = H - t;
    const span = interiorTop - interiorBottom;
    const gap = span / (cabinet.shelfCount + 1);
    for (let i = 1; i <= cabinet.shelfCount; i++) {
      const y = interiorBottom + gap * i;
      push('shelf', boxX0 + t, boxX1 - t, y, y + t, deckZ0, deckZ1 - spec.shelfSetback, boxColor, `Shelf ${i}`);
    }
  }

  // --- Face frame ---------------------------------------------------------
  const adjacency = cornerAdjacency(cabinet, spec, project);
  const layout = computeFaceLayout(
    cabinet,
    spec,
    mats,
    crownContext(cabinet, project),
    adjacency,
  );

  /*
   * The return stile on an end that butts a diagonal corner. It is drawn at
   * its full width, but the front only stops short by the setback — the front
   * laps over the rest of it, which is what keeps the run looking frameless.
   */
  const returnW = adjacency.left || adjacency.right ? (spec.cornerFrameWidth ?? 0) : 0;
  const returnSetback = cornerFrameSetback(spec);
  if (returnW > 0) {
    if (adjacency.left) {
      push('frame', boxX0, boxX0 + returnW, kick, H, boxDepth - faceThickness, boxDepth, faceColor, 'Corner return stile');
    }
    if (adjacency.right) {
      push('frame', boxX1 - returnW, boxX1, kick, H, boxDepth - faceThickness, boxDepth, faceColor, 'Corner return stile');
    }
  }
  const frameZ0 = boxDepth;
  const frameZ1 = boxDepth + ft;
  const inset = spec.doorMount === 'inset';
  const ov = inset ? -spec.revealEdge : spec.doorMount === 'halfOverlay' ? spec.overlay / 2 : spec.overlay;

  // Opening positions, measured top-down over the face zone.
  interface PlacedOpening {
    top: number;
    bottom: number;
    x0: number;
    x1: number;
    kind: 'door' | 'drawer';
    frontWidth: number;
    frontHeight: number;
    frontCount: number;
  }
  const placed: PlacedOpening[] = [];

  if (!frameless) {
    const stile = spec.frameStileWidth;
    const rail = spec.frameRailWidth;
    /*
     * The frame can run proud of the box on each side, which is what gives a
     * run something to scribe to the wall and something to cover the joint
     * where two cabinets meet. Everything on the face is measured off the
     * frame, so the whole thing shifts out with it.
     */
    // The frame is the cabinet's nominal width; the box behind it is the part
    // that narrows, so the face always spans 0..W.
    const fx0 = 0;
    const fx1 = W;
    push('frame', fx0, fx0 + stile, kick, H, frameZ0, frameZ1, faceColor, 'Stile');
    push('frame', fx1 - stile, fx1, kick, H, frameZ0, frameZ1, faceColor, 'Stile');

    // Same as frameless: an apron takes the top of the face, so the frame
    // starts below it.
    const apronFF = cabinet.sink?.style === 'farmhouse' ? cabinet.sink.apronHeight : 0;
    // A crowned cabinet runs a wider top rail so the moulding has something
    // to fasten into once it laps down over the cabinet top.
    const crownedFF =
      !!project.crown?.enabled && (cabinet.crown ?? (cabinet.type === 'wall' || cabinet.type === 'tall'));
    const topRail = crownedFF ? spec.crownTopRailWidth : rail;

    let cursor = H - apronFF;
    push('frame', fx0 + stile, fx1 - stile, cursor - topRail, cursor, frameZ0, frameZ1, faceColor, 'Top rail');
    cursor -= topRail;

    layout.openings.forEach((op, i) => {
      const top = cursor;
      const bottom = cursor - op.openingHeight;
      placed.push({
        top,
        bottom,
        x0: fx0 + stile,
        x1: fx1 - stile,
        kind: op.kind,
        frontWidth: op.frontWidth,
        frontHeight: op.frontHeight,
        frontCount: op.frontCount,
      });
      cursor = bottom;
      const isLast = i === layout.openings.length - 1;
      push('frame', fx0 + stile, fx1 - stile, cursor - rail, cursor, frameZ0, frameZ1, faceColor, isLast ? 'Bottom rail' : 'Mid rail');
      cursor -= rail;
    });

    if (cabinet.doorCount === 2 && inset) {
      const doorOp = placed.find((p) => p.kind === 'door');
      if (doorOp) {
        push('frame', W / 2 - stile / 2, W / 2 + stile / 2, doorOp.bottom, doorOp.top, frameZ0, frameZ1, faceColor, 'Mullion');
      }
    }
  } else {
    // Frameless: fronts stack directly over the face zone. On a blind corner
    // the reachable opening is offset to whichever end is not in the corner.
    const blind = corner === 'blind' ? (cabinet.blindWidth ?? 24) : 0;
    // An end butting a diagonal corner gives its stile up to the return.
    const faceX0 =
      (blind && cabinet.blindSide !== 'right' ? blind : 0) + (adjacency.left ? returnSetback : 0);
    const faceX1 =
      (blind && cabinet.blindSide === 'right' ? W - blind : W) - (adjacency.right ? returnSetback : 0);

    // A farmhouse apron owns the top of the face, so the fronts start beneath
    // it. Without this the doors hang from the cabinet top and leave a void
    // above the toe kick.
    const apron = cabinet.sink?.style === 'farmhouse' ? cabinet.sink.apronHeight : 0;
    let cursor = H - apron - spec.revealEdge;
    for (const op of layout.openings) {
      // An oven pocket splits the face, so those fronts carry their own top
      // edge rather than following the running stack.
      const top = op.topAt ?? cursor;
      const bottom = top - op.frontHeight;
      placed.push({
        top,
        bottom,
        x0: faceX0 + spec.revealEdge,
        x1: faceX1 - spec.revealEdge,
        kind: op.kind,
        frontWidth: op.frontWidth,
        frontHeight: op.frontHeight,
        frontCount: op.frontCount,
      });
      cursor = bottom - spec.revealBetween;
    }
  }

  // --- Oven pocket --------------------------------------------------------
  if (cabinet.oven) {
    const oven = cabinet.oven;
    const ow = Math.min(oven.width, W - 2 * t);
    const ox = (W - ow) / 2;
    const oy0 = oven.bottomHeight;
    const oy1 = oy0 + oven.openingHeight;
    const back = Math.max(bt, cabinet.depth - 25);

    // The pocket itself: a recess you can see into.
    push('box', ox, ox + ow, oy0, oy0 + 0.75, back, cabinet.depth, boxColor, 'Oven deck');
    push('box', ox - t, ox, oy0, oy1, back, cabinet.depth, boxColor, 'Oven side');
    push('box', ox + ow, ox + ow + t, oy0, oy1, back, cabinet.depth, boxColor, 'Oven side');
    push('box', ox, ox + ow, oy1, oy1 + 0.75, back, cabinet.depth, boxColor, 'Oven header');

    if (oven.showAppliance) {
      const inset = 0.5;
      const bodies = oven.count === 2 ? 2 : 1;
      const each = (oven.openingHeight - (bodies - 1) * 1) / bodies;
      for (let i = 0; i < bodies; i++) {
        const y0 = oy0 + i * (each + 1);
        push('box', ox + inset, ox + ow - inset, y0, y0 + each, cabinet.depth - 24, cabinet.depth, '#3b4046', 'Wall oven');
        // A hint of a control panel and handle so it reads as an appliance.
        push(
          'box',
          ox + inset,
          ox + ow - inset,
          y0 + each * 0.78,
          y0 + each * 0.95,
          cabinet.depth,
          cabinet.depth + 0.4,
          '#23262a',
          'Oven controls',
        );
        push(
          'box',
          ox + inset + 1,
          ox + ow - inset - 1,
          y0 + each * 0.66,
          y0 + each * 0.73,
          cabinet.depth,
          cabinet.depth + 1.1,
          '#9aa0a8',
          'Oven handle',
        );
      }
    }
  }

  // --- Doors and drawer fronts -------------------------------------------
  if (opts.showDoors !== false) {
    const frontZ0 = inset ? boxDepth - faceThickness : frameless ? boxDepth : frameZ1;
    const frontZ1 = frontZ0 + faceThickness;

    for (const p of placed) {
      const role: BoxRole = p.kind === 'door' ? 'door' : 'drawerFront';
      const yTop = frameless ? p.top : p.top + ov;
      const yBot = frameless ? p.bottom : p.bottom - ov;

      if (p.frontCount === 2) {
        const leftX0 = frameless ? p.x0 : p.x0 - ov;
        const rightX1 = frameless ? p.x1 : p.x1 + ov;
        push('door', leftX0, leftX0 + p.frontWidth, yBot, yTop, frontZ0, frontZ1, faceColor, 'Door');
        push('door', rightX1 - p.frontWidth, rightX1, yBot, yTop, frontZ0, frontZ1, faceColor, 'Door');
      } else if (p.frontCount === 1 || p.kind === 'drawer') {
        const cx = (p.x0 + p.x1) / 2;
        push(role, cx - p.frontWidth / 2, cx + p.frontWidth / 2, yBot, yTop, frontZ0, frontZ1, faceColor, p.kind === 'door' ? 'Door' : 'Drawer front');
      }
    }
  }

  // --- Farmhouse apron surround -------------------------------------------
  // The bowl's own apron fills the middle; these close the face beside it.
  if (cabinet.sink?.style === 'farmhouse') {
    const ap = cabinet.sink.apronHeight;
    const bowl = Math.min(cabinet.sink.width, W - 1);
    const bx0 = (W - bowl) / 2;
    const zFront = cabinet.depth - faceThickness;
    push('filler', 0, bx0, H - ap, H, zFront, cabinet.depth, faceColor, 'Apron filler');
    push('filler', bx0 + bowl, W, H - ap, H, zFront, cabinet.depth, faceColor, 'Apron filler');
  }

  // Crown is not built per cabinet. `crownRuns` chains each cabinet's face
  // line into continuous paths and sweeps the profile along them, so a row
  // reads as one length of moulding with real mitres at the corners rather
  // than a separate box sitting on every cabinet.

  return out;
}

export interface CrownRunPath {
  /** Polyline the moulding follows, in world x/z at its own height. */
  points: [number, number][];
  /** Height of the underside of the run. */
  y: number;
  height: number;
  projection: number;
  color: string;
}

const CROWN_JOIN_TOLERANCE = 0.75;

/**
 * Where the moulding stops at a free end of a run.
 *
 * `face` is the point on the cabinet's front, `back` the matching point at the
 * wall. With nothing beside it the crown returns the whole way back — the
 * outside mitre at the end of a row. Beside something deeper it returns
 * nothing and dies into that cabinet's face instead. Beside something
 * shallower it returns only the difference.
 *
 * Returns null when the return collapses to nothing, so the caller adds no
 * point at all rather than a zero-length segment the sweep cannot normalise.
 */
function returnPoint(
  face: [number, number],
  back: [number, number],
  cab: Cabinet,
  project: Pick<Project, 'cabinets'> & Partial<Pick<Project, 'room'>>,
): [number, number] | null {
  const depth = planDepth(cab);
  if (depth <= 0) return null;

  let neighbourDepth = 0;
  const wall = project.room?.walls.find((w) => w.id === cab.wallId);
  if (wall && cab.wallId) {
    const frame = wallFrame(wall, roomCentre(project.room!));
    const at = projectOntoWall(frame, face[0], face[1]).along;
    const top = (cab.mountHeight ?? (cab.type === 'wall' ? 54 : 0)) + cab.height;

    for (const other of project.cabinets) {
      if (other.id === cab.id || other.excluded || other.wallId !== cab.wallId) continue;
      // Only something that reaches this height can be died into.
      const otherTop = (other.mountHeight ?? (other.type === 'wall' ? 54 : 0)) + other.height;
      if (otherTop < top - 0.5) continue;

      const from = other.along ?? 0;
      const to = from + other.width;
      if (at < from - CROWN_JOIN_TOLERANCE || at > to + CROWN_JOIN_TOLERANCE) continue;
      neighbourDepth = Math.max(neighbourDepth, planDepth(other));
    }
  }

  const back_ = Math.max(0, depth - neighbourDepth);
  if (back_ <= 1 / 32) return null;

  const f = back_ / depth;
  return [face[0] + (back[0] - face[0]) * f, face[1] + (back[1] - face[1]) * f];
}

/**
 * Crown as continuous mitred runs rather than a box per cabinet.
 *
 * Every crowned cabinet contributes the line across its own face — the front
 * edge on a normal box, the 45 degree face on a corner. Those lines are then
 * chained end to end, so a run that turns a corner becomes one path and the
 * sweep can mitre it properly.
 *
 * Where a run stops against nothing, the moulding returns back to the wall —
 * the outside mitre at the end of a row. Where it stops against something
 * deeper, a tall pantry beside a 12" upper, it does not return at all: it dies
 * into that cabinet's face, which is what actually gets built.
 */
export function crownRuns(
  project: Pick<Project, 'cabinets' | 'crown' | 'materials'> & Partial<Pick<Project, 'room' | 'view'>>,
): CrownRunPath[] {
  const crown = project.crown;
  if (!crown?.enabled) return [];

  const eq = (a: [number, number], b: [number, number]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1]) < CROWN_JOIN_TOLERANCE;

  interface Seg {
    a: [number, number];
    b: [number, number];
    /** Inward direction, for building the return at a free end. */
    backA: [number, number];
    backB: [number, number];
    y: number;
    colour: string;
    /** Cabinet this length of moulding crosses, for resolving its free ends. */
    cab: Cabinet;
  }

  const segs: Seg[] = [];

  for (const cab of project.cabinets) {
    if (cab.excluded) continue;
    const wants = cab.crown ?? (cab.type === 'wall' || cab.type === 'tall');
    if (!wants) continue;

    const base = cab.mountHeight ?? (cab.type === 'wall' ? 54 : 0);
    const y = base + cab.height - (crown.overlap ?? 0);
    const faceMat = project.materials.find((m) => m.id === cab.faceMaterialId);
    // Crown is face material, so it follows the door override too — otherwise
    // painting the doors leaves the moulding above them the old timber colour.
    const colour =
      project.view?.doorColor || speciesColor(faceMat && 'species' in faceMat ? faceMat.species : 'Maple');

    const flat = (p: [number, number, number]): [number, number] => [p[0], p[2]];

    if (cab.corner === 'diagonal') {
      const D = cab.depth;
      const a = flat(toWorld(cab, [cab.width, 0, D]));
      const b = flat(toWorld(cab, [D, 0, cab.width]));
      // Returns head back along each wall leg.
      segs.push({
        a,
        b,
        backA: flat(toWorld(cab, [cab.width, 0, 0])),
        backB: flat(toWorld(cab, [0, 0, cab.width])),
        y,
        colour,
        cab,
      });
    } else {
      const a = flat(toWorld(cab, [0, 0, cab.depth]));
      const b = flat(toWorld(cab, [cab.width, 0, cab.depth]));
      segs.push({
        a,
        b,
        backA: flat(toWorld(cab, [0, 0, 0])),
        backB: flat(toWorld(cab, [cab.width, 0, 0])),
        y,
        colour,
        cab,
      });
    }
  }

  // Chain segments that meet, so a run turning a corner is one path.
  const runs: CrownRunPath[] = [];
  const used = new Set<number>();

  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const first = segs[i];
    const chain: Seg[] = [first];

    // Extend forward.
    let grew = true;
    while (grew) {
      grew = false;
      const tail = chain[chain.length - 1];
      for (let j = 0; j < segs.length; j++) {
        if (used.has(j)) continue;
        const s = segs[j];
        if (Math.abs(s.y - tail.y) > 0.01) continue;
        if (eq(s.a, tail.b)) {
          chain.push(s);
          used.add(j);
          grew = true;
          break;
        }
        if (eq(s.b, tail.b)) {
          chain.push({ ...s, a: s.b, b: s.a, backA: s.backB, backB: s.backA });
          used.add(j);
          grew = true;
          break;
        }
      }
    }

    // Extend backward.
    grew = true;
    while (grew) {
      grew = false;
      const head = chain[0];
      for (let j = 0; j < segs.length; j++) {
        if (used.has(j)) continue;
        const s = segs[j];
        if (Math.abs(s.y - head.y) > 0.01) continue;
        if (eq(s.b, head.a)) {
          chain.unshift(s);
          used.add(j);
          grew = true;
          break;
        }
        if (eq(s.a, head.a)) {
          chain.unshift({ ...s, a: s.b, b: s.a, backA: s.backB, backB: s.backA });
          used.add(j);
          grew = true;
          break;
        }
      }
    }

    /*
     * Orient the path so it runs the way the cabinets face.
     *
     * The sweep takes the moulding's outward direction from the path
     * direction, so a chain that happened to be assembled backward projected
     * its profile into the wall instead of out into the room — the crown was
     * there, but buried, which read as no profile at all. Only the cabinet
     * that started its own chain came out right.
     */
    {
      const first = chain[0];
      const dx = first.b[0] - first.a[0];
      const dz = first.b[1] - first.a[1];
      const dl = Math.hypot(dx, dz) || 1;
      // Normal the sweep will derive, and the way the cabinet actually faces.
      const pathN: [number, number] = [-dz / dl, dx / dl];
      const faceN: [number, number] = [first.a[0] - first.backA[0], first.a[1] - first.backA[1]];
      if (pathN[0] * faceN[0] + pathN[1] * faceN[1] < 0) {
        chain.reverse();
        for (let k = 0; k < chain.length; k++) {
          const s = chain[k];
          chain[k] = { ...s, a: s.b, b: s.a, backA: s.backB, backB: s.backA };
        }
      }
    }

    const points: [number, number][] = [chain[0].a];
    for (const s of chain) points.push(s.b);

    /*
     * Close each open end. A run that stops against thin air returns to the
     * wall; one that stops against something deeper dies into that cabinet's
     * face and returns nothing, which is how it is actually built.
     */
    const head = chain[0];
    const tail = chain[chain.length - 1];
    const headReturn = returnPoint(head.a, head.backA, head.cab, project);
    const tailReturn = returnPoint(tail.b, tail.backB, tail.cab, project);
    if (headReturn && !eq(headReturn, head.a)) points.unshift(headReturn);
    if (tailReturn && !eq(tailReturn, tail.b)) points.push(tailReturn);

    runs.push({
      points,
      y: chain[0].y,
      height: crown.height,
      projection: crown.projection,
      color: chain[0].colour,
    });
  }

  return runs;
}

export interface SinkGeometry {
  /** Basin panels, in cabinet-local space. */
  boxes: Box3D[];
  /** Hole to cut in the countertop, as a local x/z rectangle. */
  cutout: { x0: number; x1: number; z0: number; z1: number } | null;
  /** Faucet base, local coordinates. */
  faucet: { x: number; y: number; z: number } | null;
  /** Farmhouse apron replaces the counter's front edge over this span. */
  apron: { x0: number; x1: number; height: number } | null;
}

/**
 * Basin, cutout and faucet for a cabinet carrying a sink.
 *
 * A farmhouse bowl hangs through the front of the cabinet and sits proud of
 * the counter, so its cutout runs right to the front edge; an undermount or
 * top-mount is a hole in the middle of the slab.
 */
export function buildSinkGeometry(cabinet: Cabinet, counterTop: number): SinkGeometry {
  const sink = cabinet.sink;
  if (!sink) return { boxes: [], cutout: null, faucet: null, apron: null };

  const farmhouse = sink.style === 'farmhouse';
  const w = Math.min(sink.width, cabinet.width - 1);
  const x0 = (cabinet.width - w) / 2;
  const x1 = x0 + w;

  // Front to back: a farmhouse bowl comes forward to the cabinet face.
  const z1 = farmhouse ? cabinet.depth : cabinet.depth - 3;
  const z0 = Math.max(1, z1 - sink.frontToBack);

  const wall = 0.5;
  const rim = farmhouse ? counterTop + 1 : counterTop;
  /*
   * On a farmhouse the exposed apron has to land exactly where the face
   * stops, or the doors finish short of the sink and leave a gap. The face
   * reserves `apronHeight` measured down from the cabinet top, so the apron
   * bottom is pinned to that same line rather than derived from bowl depth.
   */
  const apronBottom = cabinet.height - sink.apronHeight;
  const floor = farmhouse ? Math.max(apronBottom + 1, rim - sink.bowlDepth) : rim - sink.bowlDepth;
  const frontBottom = farmhouse ? apronBottom : floor;
  const basin = '#9aa2ab';

  const boxes: Box3D[] = [];
  let seq = 0;
  const push = (bx0: number, bx1: number, by0: number, by1: number, bz0: number, bz1: number) => {
    if (bx1 - bx0 <= 0.01 || by1 - by0 <= 0.01 || bz1 - bz0 <= 0.01) return;
    boxes.push({
      key: `${cabinet.id}-sink-${seq++}`,
      role: 'box',
      pos: [(bx0 + bx1) / 2, (by0 + by1) / 2, (bz0 + bz1) / 2],
      size: [bx1 - bx0, by1 - by0, bz1 - bz0],
      color: basin,
      label: 'Sink',
    });
  };

  // Four walls and a floor, so it reads as a basin rather than a solid block.
  push(x0, x1, floor, floor + wall, z0, z1);
  push(x0, x0 + wall, floor, rim, z0, z1);
  push(x1 - wall, x1, floor, rim, z0, z1);
  push(x0, x1, floor, rim, z0, z0 + wall);
  // The front. On a farmhouse this is the exposed apron, so it runs all the
  // way down to where the doors begin.
  push(x0, x1, frontBottom, rim, z1 - wall, z1);

  return {
    boxes,
    cutout: { x0, x1, z0, z1 },
    faucet: sink.faucet ? { x: cabinet.width / 2, y: counterTop, z: Math.max(1.5, z0 - 2.5) } : null,
    apron: farmhouse ? { x0, x1, height: sink.apronHeight } : null,
  };
}

/** Solid boxes for an appliance, in room space. */
export function buildApplianceGeometry(app: Appliance): Box3D[] {
  const color = APPLIANCE_COLOR[app.kind] ?? '#5a6068';
  const boxes: Box3D[] = [
    {
      key: `${app.id}-body`,
      role: 'box',
      pos: [app.width / 2, app.mountHeight + app.height / 2, app.depth / 2],
      size: [app.width, app.height, app.depth],
      color,
    },
  ];

  // A hint of a control panel or handle so units read at a glance.
  if (app.kind === 'range' || app.kind === 'cooktop') {
    boxes.push({
      key: `${app.id}-top`,
      role: 'box',
      pos: [app.width / 2, app.mountHeight + app.height + 0.4, app.depth / 2],
      size: [app.width - 1, 0.8, app.depth - 1],
      color: '#26292e',
    });
  }
  if (app.kind === 'refrigerator' || app.kind === 'dishwasher' || app.kind === 'wineFridge') {
    boxes.push({
      key: `${app.id}-handle`,
      role: 'box',
      pos: [app.width / 2, app.mountHeight + app.height * 0.75, app.depth + 0.6],
      size: [app.width * 0.6, 0.5, 0.5],
      color: '#9aa0a8',
    });
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// Wall-relative placement
// ---------------------------------------------------------------------------

export interface WallFrame {
  /** Corner the run is measured from. */
  originX: number;
  originZ: number;
  /** Unit vector along the wall, pointing the way cabinets are laid out. */
  dx: number;
  dz: number;
  /** Unit normal pointing into the room. */
  nx: number;
  nz: number;
  length: number;
  /** Rotation, in degrees, for a cabinet sitting on this wall. */
  rotation: number;
}

/** Rough middle of the room, used to decide which way a wall faces. */
export function roomCentre(room: RoomSpec): { x: number; z: number } {
  const pts = room.walls.flatMap((w) => [
    { x: w.x1, z: w.z1 },
    { x: w.x2, z: w.z2 },
  ]);
  if (pts.length === 0) return { x: 0, z: 0 };
  return {
    x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
    z: pts.reduce((a, p) => a + p.z, 0) / pts.length,
  };
}

/**
 * Local frame for a wall.
 *
 * Cabinets are modelled with +x running across the face and +z out the front,
 * and `toWorld` maps local +x to (cos, -sin) and local +z to (sin, cos). So a
 * wall whose direction is (dx, dz) puts the cabinet front along (-dz, dx).
 *
 * Walls can be drawn in either direction, so rather than trusting the winding
 * we pick whichever end to start from makes the front face the room. That is
 * what lets an L or U shaped room work no matter how the walls were entered.
 */
export function wallFrame(wall: Wall, centre: { x: number; z: number }): WallFrame {
  let dx = wall.x2 - wall.x1;
  let dz = wall.z2 - wall.z1;
  const length = Math.hypot(dx, dz) || 1;
  dx /= length;
  dz /= length;

  let originX = wall.x1;
  let originZ = wall.z1;
  // Front direction implied by this wall direction.
  let nx = -dz;
  let nz = dx;

  const mx = (wall.x1 + wall.x2) / 2;
  const mz = (wall.z1 + wall.z2) / 2;
  if ((centre.x - mx) * nx + (centre.z - mz) * nz < 0) {
    // Facing away from the room — run the wall the other way instead.
    dx = -dx;
    dz = -dz;
    nx = -nx;
    nz = -nz;
    originX = wall.x2;
    originZ = wall.z2;
  }

  return {
    originX,
    originZ,
    dx,
    dz,
    nx,
    nz,
    length,
    rotation: (Math.atan2(-dz, dx) * 180) / Math.PI,
  };
}

/** Where a cabinet sits once assigned to a wall at distance `along`. */
export function placeOnWall(
  frame: WallFrame,
  along: number,
): { x: number; z: number; rotation: number } {
  return {
    x: frame.originX + frame.dx * along,
    z: frame.originZ + frame.dz * along,
    rotation: frame.rotation,
  };
}

/** Project a free point onto a wall, returning distance along and offset out. */
export function projectOntoWall(
  frame: WallFrame,
  x: number,
  z: number,
): { along: number; offset: number } {
  const rx = x - frame.originX;
  const rz = z - frame.originZ;
  return {
    along: rx * frame.dx + rz * frame.dz,
    offset: rx * frame.nx + rz * frame.nz,
  };
}

/**
 * Layout problems that are not overlaps — clearances and reachability that
 * only show up once appliances and cabinets are combined.
 */
export function layoutWarnings(project: Pick<Project, 'cabinets' | 'appliances' | 'room'>): string[] {
  const out: string[] = [];
  const apps = project.appliances ?? [];

  const cooking = apps.filter((a) => a.kind === 'range' || a.kind === 'cooktop');
  const overhead = apps.filter((a) => a.kind === 'microwave' || a.kind === 'hood');

  for (const cook of cooking) {
    const cookTop = cook.mountHeight + cook.height;

    // A listed hood or over-range microwave mounts around 20" up; only flag
    // it when it drops below what any manufacturer will accept.
    for (const above of overhead) {
      if (!overlapsInPlan(cook, above)) continue;
      const gap = above.mountHeight - cookTop;
      if (gap < COOKTOP_CLEARANCE_MINIMUM) {
        out.push(
          `${above.name} sits ${gap.toFixed(1)}" above ${cook.name}. Listed over-range units want about ` +
            `${COOKTOP_TO_OVERHEAD_UNIT}" — check the model's manual.`,
        );
      }
    }

    for (const cab of project.cabinets) {
      if (cab.excluded || cab.type !== 'wall') continue;
      const bottom = cab.mountHeight ?? 54;
      if (!overlapsInPlan(cook, cab)) continue;
      // A cabinet with an approved unit hung beneath it is fine; a bare
      // cabinet straight over a burner is not.
      const shielded = overhead.some((o) => overlapsInPlan(cook, o) && o.mountHeight < bottom + 1);
      if (!shielded && bottom - cookTop < COOKTOP_TO_BARE_CABINET) {
        const room = bottom - cookTop;
        // A short cabinet over a range is a microwave bridge in all but name,
        // so say what its underside would have to reach for one to fit.
        const needed = bridgeBottomForMicrowave(cookTop);
        out.push(
          cab.height <= 24
            ? `${cab.name} leaves ${room.toFixed(1)}" over ${cook.name} — not enough for a microwave. ` +
              `Its underside needs to reach ${needed}" (${COOKTOP_TO_OVERHEAD_UNIT}" clearance plus a ` +
              `${OTR_MICROWAVE_HEIGHT}" unit), which puts the top of the run at ${(needed + cab.height).toFixed(0)}".`
            : `${cab.name} is only ${room.toFixed(1)}" above ${cook.name}. ` +
              `Allow ${COOKTOP_TO_BARE_CABINET}" to a bare cabinet, or hang a hood or microwave beneath it.`,
        );
      }
    }
  }

  return out;
}

export interface RunStatus {
  wallId: string;
  wallIndex: number;
  wallLength: number;
  /** Where the run can start, past anything occupying that end. */
  startsAt: number;
  /** Where the run has to stop, short of anything occupying the far end. */
  endsAt: number;
  /** Wall length less both blocked ends. */
  usable: number;
  /** Wall taken by this run's cabinets. */
  used: number;
  /** Wall taken by appliances standing in this run. */
  applianceUsed: number;
  /**
   * Furthest point anything in this run reaches. The leftover is measured
   * from here, so the figure and the dimension line agree with what is
   * actually on screen even when the run is not packed tight.
   */
  filledTo: number;
  remaining: number;
  cabinetCount: number;
  applianceCount: number;
  /** What is holding the ends of the wall, for the read-out. */
  blockedBy: string[];
  /** True when the run is within a sixteenth of filling the usable length. */
  full: boolean;
}

/** Height band a run occupies, used to decide what can block it. */
function runBand(upper: boolean): [number, number] {
  return upper ? [50, 108] : [0, 38];
}

/** Vertical extent of anything placed in the room. */
function verticalExtent(item: Cabinet | Appliance): [number, number] {
  if ('type' in item) {
    const y = item.mountHeight ?? (item.type === 'wall' ? 54 : 0);
    return [y, y + item.height];
  }
  return [item.mountHeight, item.mountHeight + item.height];
}

/**
 * Where an item lands along a wall, if it is against that wall at all.
 *
 * Everything in the room is a candidate — a corner base, a tall pantry, a
 * fridge, a range. Anything standing against this wall takes up run length
 * whether or not it was assigned to this wall.
 */
function spanAlongWall(
  item: Cabinet | Appliance,
  frame: WallFrame,
  wallLength: number,
  upper: boolean,
): { from: number; to: number } | null {
  const [by0, by1] = runBand(upper);
  const [iy0, iy1] = verticalExtent(item);
  // No vertical overlap means it cannot be in the way of this run.
  if (Math.min(iy1, by1) - Math.max(iy0, by0) <= 1) return null;

  const f = footprint(item);

  const corners: [number, number][] = [
    [f.x0, f.z0],
    [f.x1, f.z0],
    [f.x1, f.z1],
    [f.x0, f.z1],
  ];
  const p = corners.map(([x, z]) => projectOntoWall(frame, x, z));
  const from = Math.min(...p.map((q) => q.along));
  const to = Math.max(...p.map((q) => q.along));
  const offsetMin = Math.min(...p.map((q) => q.offset));

  // Has to be up against this wall, and actually within its length.
  if (offsetMin > 3) return null;
  if (to <= 0.5 || from >= wallLength - 0.5) return null;
  return { from, to };
}

/**
 * How much of a wall a run has taken and what is left.
 *
 * The start offset matters: a diagonal corner cabinet on the adjoining wall
 * runs its full width back along *this* wall too, so the run here cannot
 * begin at zero. Without that, a second wall's run starts inside the corner
 * cabinet and everything after it is wrong.
 */
export function runStatus(
  project: Pick<Project, 'room' | 'cabinets'> & Partial<Pick<Project, 'appliances'>>,
  wallId: string,
  upper: boolean,
): RunStatus {
  const wallIndex = project.room.walls.findIndex((w) => w.id === wallId);
  const wall = project.room.walls[wallIndex];
  const wallLength = wall ? Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) : 0;

  const mine = project.cabinets.filter(
    (c) => c.wallId === wallId && !c.excluded && (c.type === 'wall') === upper,
  );

  /*
   * Anything standing against this wall takes run length off it, whichever
   * wall it was assigned to — a corner base, a tall pantry, a fridge.
   *
   * Everything is projected onto this wall's frame rather than reasoned about
   * by which corner is shared, because a wall's run origin depends on which
   * way it faces, so a shared corner can fall at either end of this run.
   */
  let startsAt = 0;
  let endsAt = wallLength;
  const blockedBy: string[] = [];
  let applianceUsed = 0;
  let applianceCount = 0;
  // Furthest point each run member reaches, used to find where the run stops.
  const reach: { to: number }[] = mine.map((c) => ({ to: (c.along ?? 0) + c.width }));

  if (wall) {
    const centre = roomCentre(project.room);
    const frame = wallFrame(wall, centre);
    const mineIds = new Set(mine.map((c) => c.id));

    const foreign: { name: string; from: number; to: number }[] = [];
    for (const c of project.cabinets) {
      if (c.excluded || mineIds.has(c.id)) continue;
      const span = spanAlongWall(c, frame, wallLength, upper);
      if (span) foreign.push({ name: c.name, ...span });
    }
    for (const a of project.appliances ?? []) {
      const span = spanAlongWall(a, frame, wallLength, upper);
      if (span) foreign.push({ name: a.name, ...span });
    }

    // Spans this run's own cabinets already occupy.
    const covered = mine
      .map((c) => ({ from: c.along ?? 0, to: (c.along ?? 0) + c.width }))
      .sort((a, b) => a.from - b.from);

    /**
     * The parts of a span that no cabinet in this run already covers.
     *
     * A microwave hung under a bridge shares that cabinet's stretch of wall,
     * so counting both put the run 30" over when nothing was wrong. Working
     * in segments rather than a single total also means a unit sitting at
     * along 0 behind a cabinet no longer looks like it is blocking the
     * start of the run.
     */
    const uncoveredSegments = (from: number, to: number) => {
      const segs: { from: number; to: number }[] = [];
      let cursor = from;
      for (const c of covered) {
        if (c.to <= cursor) continue;
        if (c.from >= to) break;
        if (c.from > cursor) segs.push({ from: cursor, to: Math.min(c.from, to) });
        cursor = Math.max(cursor, c.to);
        if (cursor >= to) break;
      }
      if (cursor < to) segs.push({ from: cursor, to });
      return segs.filter((s) => s.to - s.from > 0.05);
    };

    for (const item of foreign) {
      let counted = false;
      for (const seg of uncoveredSegments(item.from, item.to)) {
        if (seg.from <= 1) {
          startsAt = Math.max(startsAt, seg.to);
          blockedBy.push(item.name);
        } else if (seg.to >= wallLength - 1) {
          endsAt = Math.min(endsAt, seg.from);
          blockedBy.push(item.name);
        } else {
          // Standing in the run — a range between two cabinets.
          applianceUsed += seg.to - seg.from;
          reach.push({ to: seg.to });
          counted = true;
        }
      }
      if (counted) applianceCount += 1;
    }
  }

  const usable = Math.max(0, endsAt - startsAt);
  const used = mine.reduce((a, c) => a + c.width, 0);

  // Measure the leftover from where the run actually stops. Deriving it from
  // the cabinet widths alone ignored every appliance standing in the run, so
  // the gap read long and its dimension line started back before the range.
  const filledTo = Math.min(
    endsAt,
    Math.max(startsAt, ...reach.map((r) => r.to), startsAt),
  );
  const remaining = Math.max(0, endsAt - filledTo);

  return {
    wallId,
    wallIndex,
    wallLength,
    startsAt,
    endsAt,
    usable,
    used,
    applianceUsed,
    filledTo,
    remaining,
    cabinetCount: mine.length,
    applianceCount,
    blockedBy: [...new Set(blockedBy)],
    full: remaining < 1 / 16,
  };
}

/**
 * Every wall a unit genuinely stands on.
 *
 * A unit belongs to the wall it is assigned to. Only a diagonal corner spans
 * two, because it runs its full width back along both walls that meet at its
 * corner — that is what makes it need both hidden before it disappears.
 *
 * Deliberately *not* geometric for ordinary cabinets: the end of a plain base
 * in the corner touches the returning wall, but it is not standing on it, and
 * treating that as spanning left it on screen after its own wall was hidden.
 */
export function wallsTouchedBy(item: Cabinet | Appliance, room: RoomSpec): string[] {
  const assigned = 'wallId' in item ? item.wallId : undefined;
  const isDiagonalCorner = 'type' in item && item.corner === 'diagonal';

  if (!isDiagonalCorner) return assigned ? [assigned] : [];

  const centre = roomCentre(room);
  const f = footprint(item as Cabinet);
  const corners: [number, number][] = [
    [f.x0, f.z0],
    [f.x1, f.z0],
    [f.x1, f.z1],
    [f.x0, f.z1],
  ];

  const out: string[] = assigned ? [assigned] : [];
  for (const wall of room.walls) {
    if (out.includes(wall.id)) continue;
    const frame = wallFrame(wall, centre);
    const p = corners.map(([x, z]) => projectOntoWall(frame, x, z));
    const from = Math.min(...p.map((q) => q.along));
    const to = Math.max(...p.map((q) => q.along));
    const offsetMin = Math.min(...p.map((q) => q.offset));

    if (offsetMin > 3) continue;
    if (to <= 0.5 || from >= frame.length - 0.5) continue;
    out.push(wall.id);
  }
  return out;
}

/**
 * Whether a unit shows in the 3D view.
 *
 * A unit disappears only when every wall it stands against is hidden, so
 * hiding one wall of a corner leaves the corner cabinet in place — it is
 * still holding up the run on the wall you can see.
 */
export function isVisibleWithWalls(item: Cabinet | Appliance, room: RoomSpec): boolean {
  const walls = wallsTouchedBy(item, room);
  if (walls.length === 0) return true;
  const byId = new Map(room.walls.map((w) => [w.id, w]));
  return walls.some((id) => !byId.get(id)?.hidden);
}

/**
 * Where an appliance sits along a wall, for packing cabinets around it.
 * Returns null when it is not against this wall or not in the run's band.
 */
export function applianceSpan(
  appliance: Appliance,
  frame: WallFrame,
  upper: boolean,
): { from: number; to: number } | null {
  return spanAlongWall(appliance, frame, frame.length, upper);
}

/**
 * Solid geometry for a bar top, in its own frame: x along its length, y up
 * from the floor, z measured from the wall line.
 *
 * The wall and slab are built out into negative z, because a bar faces away
 * from the run it stands behind — the seating side is the outside face.
 */
export function buildBarTopGeometry(
  bar: BarTop,
  project: Pick<Project, 'materials' | 'defaults' | 'defaultFaceMaterialId'> &
    Partial<Pick<Project, 'view'>>,
  counterColor: string,
): Box3D[] {
  const spec = project.defaults;
  const faceMat = project.materials.find(
    (m) => m.id === (bar.panelMaterialId ?? project.defaultFaceMaterialId),
  );
  // A bar wall clad to match the doors takes the door override with everything
  // else; one that is really a plastered wall follows the room walls instead.
  const cabinetColor =
    project.view?.doorColor || speciesColor(faceMat && 'species' in faceMat ? faceMat.species : 'Maple');
  /*
   * A wall built by others is a painted wall, so it takes the room's wall
   * colour whichever way `finish` happens to be set — picking "no panel" is
   * itself the statement that this is plasterwork, not cabinetry.
   */
  const builtByOthers = (bar.panelStyle ?? 'slab') === 'none';
  const faceColor =
    builtByOthers || bar.finish === 'wall'
      ? (project.view?.wallColor ?? cabinetColor)
      : bar.finish === 'custom'
        ? (bar.finishColor ?? cabinetColor)
        : cabinetColor;

  const out: Box3D[] = [];
  let seq = 0;
  const push = (
    role: BoxRole,
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    color: string,
    label?: string,
  ) => {
    if (x1 - x0 <= 0 || y1 - y0 <= 0 || z1 - z0 <= 0) return;
    out.push({
      key: `${bar.id}-${seq++}`,
      role,
      pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
      size: [x1 - x0, y1 - y0, z1 - z0],
      color,
    });
    if (label) out[out.length - 1].label = label;
  };

  // Back of the wall sits at -offset; it is built toward the seating side.
  const back = -bar.offset;
  const front = back - bar.thickness;
  const top = bar.wallHeight;

  push('box', 0, bar.length, 0, top, front, back, faceColor, 'Bar wall');

  // Finished panel on the seating side, standing proud of the wall. A wall
  // built by others has none — the slab just lands on a plastered wall.
  const style = bar.panelStyle ?? 'slab';
  const pt = 0.75;
  const pz1 = front;
  const pz0 = front - pt;
  if (style === 'none') {
    // Nothing to clad.
  } else if (style === 'slab' || style === 'beadboard') {
    push('frame', 0, bar.length, 0, top, pz0, pz1, faceColor, 'Bar panel');
  } else {
    const s = spec.frameStileWidth;
    const r = spec.frameRailWidth;
    push('frame', 0, s, 0, top, pz0, pz1, faceColor, 'Bar panel stile');
    push('frame', bar.length - s, bar.length, 0, top, pz0, pz1, faceColor, 'Bar panel stile');
    push('frame', s, bar.length - s, 0, r, pz0, pz1, faceColor, 'Bar panel rail');
    push('frame', s, bar.length - s, top - r, top, pz0, pz1, faceColor, 'Bar panel rail');
    const shrink = style === 'raised' ? pt * 0.35 : pt * 0.6;
    push('frame', s, bar.length - s, r, top - r, pz0 + shrink, pz1, faceColor, 'Bar panel field');
  }

  // The slab, carrying every overhang.
  push(
    'box',
    -bar.overhangLeft,
    bar.length + bar.overhangRight,
    top,
    top + bar.topThickness,
    front - bar.overhangFront,
    back + bar.overhangBack,
    counterColor,
    'Bar top',
  );

  return out;
}

/**
 * Rectangles to punch out of a wall elevation, in the wall's own coordinates:
 * x measured along the wall from its starting corner, y up from the floor.
 *
 * Openings are clamped into the wall rather than dropped, so a window nudged
 * past the end still reads as an opening you can see and drag back instead of
 * silently vanishing. Anything left with no area at all is skipped, because a
 * degenerate hole makes the whole extruded wall fail to triangulate.
 */
export function wallOpeningRects(
  wall: Pick<Wall, 'height'>,
  wallLength: number,
  windows: WindowOpening[],
): { x0: number; x1: number; y0: number; y1: number }[] {
  const out: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const w of windows) {
    if (w.hidden) continue;
    const x0 = Math.max(0, Math.min(wallLength, w.along));
    const x1 = Math.max(0, Math.min(wallLength, w.along + w.width));
    const y0 = Math.max(0, Math.min(wall.height, w.sillHeight));
    const y1 = Math.max(0, Math.min(wall.height, w.sillHeight + w.height));
    if (x1 - x0 <= 1 / 64 || y1 - y0 <= 1 / 64) continue;
    out.push({ x0, x1, y0, y1 });
  }
  return out;
}

/** Re-derive x, z and rotation for everything assigned to a wall. */
export function applyWallPlacements(
  project: Pick<Project, 'room' | 'cabinets'> & Partial<Pick<Project, 'appliances' | 'barTops'>>,
) {
  const centre = roomCentre(project.room);
  const frames = new Map(project.room.walls.map((w) => [w.id, wallFrame(w, centre)]));

  const place = (item: { wallId?: string; along?: number; x: number; z: number; rotation: number }) => {
    if (!item.wallId) return;
    const frame = frames.get(item.wallId);
    if (!frame) return;
    const p = placeOnWall(frame, item.along ?? 0);
    item.x = p.x;
    item.z = p.z;
    item.rotation = p.rotation;
  };

  for (const c of project.cabinets) place(c);
  for (const a of project.appliances ?? []) place(a);
  for (const b of project.barTops ?? []) place(b);
}

/** Cabinet-local point rotated and translated into room space. */
export function toWorld(
  item: { x: number; z: number; rotation: number },
  local: [number, number, number],
): [number, number, number] {
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const [lx, ly, lz] = local;
  return [item.x + lx * cos + lz * sin, ly, item.z - lx * sin + lz * cos];
}

/**
 * Depth a cabinet actually occupies in plan.
 *
 * A diagonal corner is square: it runs the full width back along both walls,
 * so its plan depth is its width, not the nominal 24". Getting this wrong
 * makes corners silently overlap their neighbours.
 */
export function planDepth(item: Cabinet | Appliance): number {
  return 'type' in item && item.corner === 'diagonal' ? item.width : item.depth;
}

/**
 * Axis-aligned footprint of anything standing in the room, for plan view,
 * run maths and collision checks.
 *
 * Cabinets and appliances both sit at an (x, z) origin and rotate about it,
 * so they have to go through the same rotation here. Treating an appliance as
 * an axis-aligned box of (x..x+width, z..z+depth) is only correct on a wall
 * at zero degrees; on any other wall it puts the appliance somewhere it is
 * not, which silently drops it out of its run and invents overlaps with its
 * neighbours.
 */
export function footprint(item: Cabinet | Appliance): {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
} {
  const d = planDepth(item);
  const corners: [number, number][] = [
    [0, 0],
    [item.width, 0],
    [item.width, d],
    [0, d],
  ];
  const pts = corners.map(([x, z]) => {
    const w = toWorld(item, [x, 0, z]);
    return [w[0], w[2]] as [number, number];
  });
  return {
    x0: Math.min(...pts.map((p) => p[0])),
    x1: Math.max(...pts.map((p) => p[0])),
    z0: Math.min(...pts.map((p) => p[1])),
    z1: Math.max(...pts.map((p) => p[1])),
  };
}

/**
 * Which edge of a door panel carries the pull, viewed from the front.
 *
 * The pull goes on the edge that opens, opposite the hinges. A pair is hinged
 * on both outer stiles and opens from the middle, so each leaf takes its pull
 * on its inner edge. A single door follows the cabinet's hinge side: hinged
 * right means it swings open to the left, so the pull sits on the left stile.
 *
 * `panelCentreX` is the panel's centre in cabinet-local X, which is what
 * distinguishes the two leaves of a pair.
 */
export function doorPullSide(cabinet: Cabinet, panelCentreX: number): 'left' | 'right' {
  if ((cabinet.doorCount ?? 0) >= 2) {
    return panelCentreX < cabinet.width / 2 ? 'right' : 'left';
  }
  return (cabinet.hingeSide ?? 'right') === 'left' ? 'right' : 'left';
}

/**
 * Whether two things share plan footprint, ignoring height.
 *
 * One definition for the whole app: this test decides whether a microwave is
 * over a range, whether a sink sits in a cabinet, and which upper a base
 * measures its clearance to. Those had drifted into four separate copies, each
 * comparing raw x/z, so they disagreed with each other on any rotated wall.
 */
export function overlapsInPlan(a: Cabinet | Appliance, b: Cabinet | Appliance): boolean {
  const fa = footprint(a);
  const fb = footprint(b);
  return (
    Math.min(fa.x1, fb.x1) - Math.max(fa.x0, fb.x0) > 1 &&
    Math.min(fa.z1, fb.z1) - Math.max(fa.z0, fb.z0) > 1
  );
}

interface Occupant {
  id: string;
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Vertical extent, so a wall cabinet does not fight the base run below. */
  y0: number;
  y1: number;
}

function cabinetOccupant(c: Cabinet): Occupant {
  const f = footprint(c);
  const y0 = c.mountHeight ?? (c.type === 'wall' ? 54 : 0);
  return { id: c.id, name: c.name, ...f, y0, y1: y0 + c.height };
}

function applianceOccupant(a: Appliance): Occupant {
  return {
    id: a.id,
    name: a.name,
    ...footprint(a),
    y0: a.mountHeight,
    y1: a.mountHeight + a.height,
  };
}

export interface Collision {
  a: string;
  b: string;
  aName: string;
  bName: string;
}

/**
 * Anything sharing the same space, so the layout gets flagged before it is
 * cut. Overlap has to be checked in all three axes: a wall cabinet sitting
 * over a base run shares its plan footprint but not its volume.
 */
export function findCollisions(cabinets: Cabinet[], appliances: Appliance[] = []): Collision[] {
  const items: Occupant[] = [
    ...cabinets.filter((c) => !c.excluded).map(cabinetOccupant),
    ...appliances.map(applianceOccupant),
  ];

  const hits: Collision[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      // A shared face is fine — cabinets are meant to butt. Only real volume
      // overlap counts.
      if (ox > 0.05 && oz > 0.05 && oy > 0.05) {
        hits.push({ a: a.id, b: b.id, aName: a.name, bName: b.name });
      }
    }
  }
  return hits;
}
