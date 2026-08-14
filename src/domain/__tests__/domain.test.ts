import { describe, expect, it } from 'vitest';
import { boardFeet, formatFeetInches, formatFrac, parseDim } from '../units';
import {
  APPLIANCE_PRESETS,
  bridgeBottomForMicrowave,
  CABINET_PRESETS,
  fitDrawerHeights,
  makeAppliance,
  makeBarTop,
  makeCabinet,
  makeProject,
  makeRoom,
  makeWindow,
  wallMountHeight,
} from '../defaults';
import {
  barTopSlabSize,
  BOUGHT_IN,
  computeFaceLayout,
  cornerAdjacency,
  cornerFillerAllowance,
  cornerFrameSetback,
  crownContext,
  boxWidth,
  crownRunLength,
  frameOverhangs,
  generateBarTopParts,
  frontalWidth,
  generateCabinetParts,
  generateProjectParts,
  grooveSetout,
  panelPieces,
  rollupCutList,
  specFor,
} from '../partsGenerator';
import { looksLikeProject, migrateProject, useProject } from '../../store/useProject';
import type { BarTop, Cabinet, Project } from '../types';
import { nestSheetMaterial } from '../nesting';
import { computeEstimate, hingesForDoor, linearFeet } from '../estimate';
import {
  applyWallPlacements,
  buildBarTopGeometry,
  buildCabinetGeometry,
  buildSinkGeometry,
  crownRuns,
  doorPullSide,
  findCollisions,
  footprint,
  isVisibleWithWalls,
  layoutWarnings,
  placeOnWall,
  planDepth,
  projectOntoWall,
  overlapsInPlan,
  roomCentre,
  runStatus,
  toWorld,
  wallFrame,
  wallOpeningRects,
  wallsTouchedBy,
} from '../geometry';
import type { SheetMaterial } from '../types';
import { isSheet } from '../materials';

describe('units', () => {
  it('parses the ways a shop writes dimensions', () => {
    expect(parseDim('24')).toBe(24);
    expect(parseDim('24.5')).toBe(24.5);
    expect(parseDim('24 1/2')).toBe(24.5);
    expect(parseDim('24-1/2')).toBe(24.5);
    expect(parseDim('1/2')).toBe(0.5);
    expect(parseDim('.75')).toBe(0.75);
    expect(parseDim('34 1/2"')).toBe(34.5);
    expect(parseDim("2'")).toBe(24);
    expect(parseDim("2' 6")).toBe(30);
    expect(parseDim(`2' 6 1/4"`)).toBe(30.25);
    expect(parseDim('30 3/16')).toBeCloseTo(30.1875, 6);
  });

  it('handles metric input', () => {
    expect(parseDim('25.4mm')).toBeCloseTo(1, 6);
    expect(parseDim('2.54cm')).toBeCloseTo(1, 6);
  });

  it('rejects nonsense instead of guessing', () => {
    expect(parseDim('abc')).toBeNull();
    expect(parseDim('')).toBeNull();
    expect(parseDim('1/0')).toBeNull();
  });

  it('formats back to reduced fractions', () => {
    expect(formatFrac(24.5)).toBe('24 1/2');
    expect(formatFrac(24)).toBe('24');
    expect(formatFrac(0.75)).toBe('3/4');
    expect(formatFrac(23.75)).toBe('23 3/4');
    expect(formatFrac(0.0625)).toBe('1/16');
    // Rounds up cleanly rather than showing 23 16/16.
    expect(formatFrac(23.99999)).toBe('24');
  });

  it('round-trips parse and format', () => {
    for (const v of [0.125, 1.5, 12.3125, 34.5, 95.9375]) {
      expect(parseDim(formatFrac(v, 32))).toBeCloseTo(v, 6);
    }
  });

  it('formats feet and inches', () => {
    expect(formatFeetInches(30.25)).toBe(`2' 6 1/4"`);
    expect(formatFeetInches(24)).toBe(`2'`);
    expect(formatFeetInches(6)).toBe(`6"`);
  });

  it('computes board feet', () => {
    // 1" x 12" x 12" = 1 board foot.
    expect(boardFeet(1, 12, 12, 1)).toBe(1);
    expect(boardFeet(1, 6, 96, 2)).toBe(8);
  });
});

describe('face layout', () => {
  const project = makeProject();

  it('frameless full-overlay door pair fills the width less reveals', () => {
    const cab = makeCabinet('base', project, { width: 30, doorCount: 2, drawers: [] });
    const spec = specFor(cab, project.defaults);
    const layout = computeFaceLayout(cab, spec, project.materials);
    const door = layout.openings.find((o) => o.kind === 'door')!;

    // Two doors plus the gap between them plus the two edge reveals = width.
    const span = door.frontWidth * 2 + spec.revealBetween + spec.revealEdge * 2;
    expect(span).toBeCloseTo(30, 6);
  });

  it('frameless door height fills the face zone above the toe kick', () => {
    const cab = makeCabinet('base', project, { height: 34.5, doorCount: 2, drawers: [] });
    const spec = specFor(cab, project.defaults);
    const layout = computeFaceLayout(cab, spec, project.materials);
    const door = layout.openings.find((o) => o.kind === 'door')!;
    expect(door.frontHeight).toBeCloseTo(34.5 - spec.toeKickHeight - 2 * spec.revealEdge, 6);
  });

  it('drawer fronts eat into the door height by exactly their size plus the reveal', () => {
    const withDrawer = makeCabinet('base', project, {
      height: 34.5,
      doorCount: 2,
      drawers: [{ id: 'd1', frontHeight: 6 }],
    });
    const spec = specFor(withDrawer, project.defaults);
    const layout = computeFaceLayout(withDrawer, spec, project.materials);
    const door = layout.openings.find((o) => o.kind === 'door')!;
    const expected = 34.5 - spec.toeKickHeight - 2 * spec.revealEdge - 6 - spec.revealBetween;
    expect(door.frontHeight).toBeCloseTo(expected, 6);
  });

  it('face frame overlay doors lap the frame by the overlay on each side', () => {
    const cab = makeCabinet('base', project, {
      width: 30,
      doorCount: 1,
      drawers: [],
      construction: 'faceFrame',
      doorMount: 'fullOverlay',
    });
    const spec = specFor(cab, project.defaults);
    const layout = computeFaceLayout(cab, spec, project.materials);
    const door = layout.openings.find((o) => o.kind === 'door')!;
    const opening = 30 - 2 * spec.frameStileWidth;
    expect(door.openingWidth).toBeCloseTo(opening, 6);
    expect(door.frontWidth).toBeCloseTo(opening + 2 * spec.overlay, 6);
  });

  it('inset doors sit inside the opening with a reveal all round', () => {
    const cab = makeCabinet('base', project, {
      width: 30,
      doorCount: 1,
      drawers: [],
      construction: 'faceFrame',
      doorMount: 'inset',
    });
    const spec = specFor(cab, project.defaults);
    const layout = computeFaceLayout(cab, spec, project.materials);
    const door = layout.openings.find((o) => o.kind === 'door')!;
    const opening = 30 - 2 * spec.frameStileWidth;
    expect(door.frontWidth).toBeCloseTo(opening - 2 * spec.revealEdge, 6);
    expect(door.frontWidth).toBeLessThan(door.openingWidth);
  });

  it('warns when drawer heights leave no room for a door', () => {
    const cab = makeCabinet('base', project, {
      height: 34.5,
      doorCount: 2,
      drawers: [
        { id: 'a', frontHeight: 14 },
        { id: 'b', frontHeight: 14 },
      ],
    });
    const spec = specFor(cab, project.defaults);
    const layout = computeFaceLayout(cab, spec, project.materials);
    expect(layout.warnings.length).toBeGreaterThan(0);
  });
});

describe('parts generation', () => {
  const project = makeProject();

  // Part sizes are snapped to the nearest 1/32" because that is the finest
  // division anyone cuts to, so comparisons allow half a snap step.
  const SNAP_TOL = 1 / 64 + 1e-9;
  const nearCut = (actual: number, expected: number) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(SNAP_TOL);

  it('captures the deck between the sides', () => {
    const cab = makeCabinet('base', project, { width: 24 });
    const { parts } = generateCabinetParts(cab, project);
    const side = parts.find((p) => p.category === 'side')!;
    const deck = parts.find((p) => p.category === 'bottom')!;
    expect(side.qty).toBe(2);
    nearCut(deck.length, 24 - 2 * side.thickness);
  });

  it('the deck runs the full box depth, not set back by the toe kick', () => {
    const cab = makeCabinet('base', project, { width: 24, depth: 24 });
    const spec = specFor(cab, project.defaults);
    const { parts } = generateCabinetParts(cab, project);
    const deck = parts.find((p) => p.category === 'bottom')!;
    const back = parts.find((p) => p.category === 'back');

    // The toe notch is cut in the sides below the deck, so it takes nothing
    // off the deck itself. Deducting it too left the bottom 3" shy of the
    // doors — a real short cut, not just a gap on screen.
    const frame = spec.construction === 'frameless' ? 0 : spec.frameThickness;
    nearCut(deck.width, 24 - frame - (back?.thickness ?? 0));
    expect(deck.width).toBeGreaterThan(24 - spec.toeKickDepth);
  });

  it('the drawn deck reaches as far forward as the side above it', () => {
    const cab = makeCabinet('base', project, { width: 24, depth: 24 });
    const boxes = buildCabinetGeometry(cab, project);
    const frontOf = (b: { pos: [number, number, number]; size: [number, number, number] }) =>
      b.pos[2] + b.size[2] / 2;

    const deck = boxes.find((b) => b.label === 'Deck')!;
    const side = boxes.find((b) => b.label === 'Side')!;
    expect(frontOf(deck)).toBeCloseTo(frontOf(side), 3);
  });

  it('sides run the full cabinet height', () => {
    const cab = makeCabinet('base', project, { height: 34.5 });
    const { parts } = generateCabinetParts(cab, project);
    const side = parts.find((p) => p.category === 'side')!;
    expect(side.length).toBeCloseTo(34.5, 3);
  });

  it('base cabinets get stretchers, wall cabinets get a full top', () => {
    const base = generateCabinetParts(makeCabinet('base', project), project).parts;
    const wall = generateCabinetParts(makeCabinet('wall', project), project).parts;
    expect(base.some((p) => p.category === 'stretcher')).toBe(true);
    expect(base.some((p) => p.category === 'top')).toBe(false);
    expect(wall.some((p) => p.category === 'top')).toBe(true);
    expect(wall.some((p) => p.category === 'toeKick')).toBe(false);
  });

  it('produces a face frame only for face-frame cabinets', () => {
    const frameless = generateCabinetParts(makeCabinet('base', project, { construction: 'frameless' }), project).parts;
    const framed = generateCabinetParts(makeCabinet('base', project, { construction: 'faceFrame' }), project).parts;
    expect(frameless.some((p) => p.category === 'faceFrameStile')).toBe(false);
    expect(framed.some((p) => p.category === 'faceFrameStile')).toBe(true);
    expect(framed.find((p) => p.category === 'faceFrameStile')!.qty).toBe(2);
  });

  it('drawer boxes clear the slides on both sides', () => {
    const cab = makeCabinet('base', project, {
      width: 24,
      doorCount: 0,
      drawers: [{ id: 'd1', frontHeight: 8 }],
    });
    const spec = specFor(cab, project.defaults);
    const { parts } = generateCabinetParts(cab, project);
    const side = parts.find((p) => p.category === 'side')!;
    const fb = parts.find((p) => p.category === 'drawerBoxFrontBack')!;
    const dbt = parts.find((p) => p.category === 'drawerBoxSide')!.thickness;

    const interior = 24 - 2 * side.thickness;
    const boxOuter = interior - 2 * spec.drawerSlideClearance;
    nearCut(fb.length, boxOuter - 2 * dbt);

    // The finished box must actually clear the opening on both sides.
    const boxSide = parts.find((p) => p.category === 'drawerBoxSide')!;
    expect(fb.length + 2 * boxSide.thickness).toBeLessThanOrEqual(interior - 2 * spec.drawerSlideClearance + SNAP_TOL);
  });

  it('a false front produces a panel but no drawer box', () => {
    const cab = makeCabinet('base', project, {
      width: 36,
      doorCount: 2,
      drawers: [{ id: 'ff', frontHeight: 6, falseFront: true }],
    });
    const { parts } = generateCabinetParts(cab, project);
    expect(parts.some((p) => p.category === 'drawerFront')).toBe(true);
    expect(parts.some((p) => p.category === 'drawerBoxSide')).toBe(false);
    expect(parts.some((p) => p.category === 'drawerBottom')).toBe(false);
  });

  it('a false front takes no drawer slides', () => {
    const project2 = makeProject();
    project2.cabinets.push(
      makeCabinet('base', project2, {
        doorCount: 2,
        drawers: [
          { id: 'ff', frontHeight: 6, falseFront: true },
          { id: 'real', frontHeight: 8 },
        ],
      }),
    );
    const est = computeEstimate(project2);
    const slides = est.hardwareCounts.find((h) => h.item.category === 'drawerSlide');
    expect(slides?.qty).toBe(1);
  });

  it('never emits a part with a non-positive dimension', () => {
    const cab = makeCabinet('base', project, { width: 12, height: 34.5, depth: 24, doorCount: 1 });
    const { parts } = generateCabinetParts(cab, project);
    for (const p of parts) {
      expect(p.length).toBeGreaterThan(0);
      expect(p.width).toBeGreaterThan(0);
      expect(p.qty).toBeGreaterThan(0);
    }
  });

  it('flags a cabinet too narrow to build', () => {
    const cab = makeCabinet('base', project, { width: 1 });
    const { warnings } = generateCabinetParts(cab, project);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('rolls identical parts from different cabinets into one row', () => {
    const a = makeCabinet('base', project, { name: 'Base 1', width: 24, doorCount: 2, drawers: [] });
    const b = makeCabinet('base', project, { name: 'Base 2', width: 24, doorCount: 2, drawers: [] });
    const parts = [...generateCabinetParts(a, project).parts, ...generateCabinetParts(b, project).parts];
    const rows = rollupCutList(parts);
    const sideRow = rows.find((r) => r.category === 'side')!;
    expect(sideRow.qty).toBe(4);
    expect(sideRow.cabinets.length).toBe(2);
  });
});

describe('cabinet presets', () => {
  it('every preset builds a cabinet with no layout warnings', () => {
    for (const preset of CABINET_PRESETS) {
      const project = makeProject();
      const cab = preset.build(makeCabinet(preset.type, project), project.defaults);
      const { warnings } = generateCabinetParts(cab, project);
      expect(warnings, `preset "${preset.key}" produced: ${warnings.join(' | ')}`).toHaveLength(0);
    }
  });

  it('drawer-only presets fill the face exactly', () => {
    for (const key of ['base-3drawer', 'base-4drawer', 'vanity-drawers']) {
      const preset = CABINET_PRESETS.find((p) => p.key === key)!;
      const project = makeProject();
      const cab = preset.build(makeCabinet(preset.type, project), project.defaults);
      const spec = specFor(cab, project.defaults);

      const faceZone = cab.height - spec.toeKickHeight;
      const sum = cab.drawers.reduce((a, d) => a + d.frontHeight, 0);
      const gaps = (cab.drawers.length - 1) * spec.revealBetween;
      expect(sum + gaps + 2 * spec.revealEdge, `preset "${key}"`).toBeCloseTo(faceZone, 6);
    }
  });

  it('drawer stacks re-fit when the cabinet height changes', () => {
    const project = makeProject();
    const tall = fitDrawerHeights({ height: 40.5, type: 'base' }, project.defaults, [1, 1, 1]);
    const short = fitDrawerHeights({ height: 34.5, type: 'base' }, project.defaults, [1, 1, 1]);
    expect(tall.reduce((a, d) => a + d.frontHeight, 0)).toBeGreaterThan(
      short.reduce((a, d) => a + d.frontHeight, 0),
    );
  });
});

describe('corner cabinets', () => {
  const project = makeProject();

  it('a 36" diagonal corner with 24" neighbours carries a 17" door', () => {
    const cab = makeCabinet('base', project, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    // (36 - 24) * sqrt(2) = 16.97", which is the catalogue figure.
    expect(frontalWidth(cab)).toBeCloseTo(16.97, 1);
  });

  it('a blind corner only shows the reachable part', () => {
    const cab = makeCabinet('base', project, { width: 48, corner: 'blind', blindWidth: 24 });
    expect(frontalWidth(cab)).toBeCloseTo(24, 6);
  });

  it('sizes the corner door against the face, not the plan width', () => {
    const cab = makeCabinet('base', project, { width: 48, corner: 'blind', blindWidth: 24, doorCount: 1 });
    const spec = specFor(cab, project.defaults);
    const layout = computeFaceLayout(cab, spec, project.materials);
    const door = layout.openings.find((o) => o.kind === 'door')!;
    // 24" of reachable face, less a reveal each side.
    expect(door.frontWidth).toBeCloseTo(24 - 2 * spec.revealEdge, 6);
  });

  it('a frameless corner door is held back by its own narrow frame', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'frameless', cornerFrameWidth: 1.5 };
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const spec = specFor(cab, p.defaults);
    const door = computeFaceLayout(cab, spec, p.materials).openings.find((o) => o.kind === 'door')!;

    // The 45 face is still 17". The door stops short of each stile by the
    // setback, not the whole stile — it laps the rest, which is what keeps the
    // run reading frameless instead of giving away face for nothing.
    expect(frontalWidth(cab)).toBeCloseTo(16.97, 1);
    expect(cornerFrameSetback(spec)).toBeCloseTo(1, 6);
    expect(door.frontWidth).toBeCloseTo(16.97 - 2 - 2 * spec.revealEdge, 1);
  });

  it('lapping the stile wins face width back', () => {
    const doorWidth = (overlay: number) => {
      const p = makeProject();
      p.defaults = {
        ...p.defaults,
        construction: 'frameless',
        cornerFrameWidth: 1.5,
        cornerFrameOverlay: overlay,
      };
      const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
      return computeFaceLayout(cab, specFor(cab, p.defaults), p.materials).openings.find(
        (o) => o.kind === 'door',
      )!.frontWidth;
    };
    // Half an inch a side lapped is an inch of door back.
    expect(doorWidth(0.5) - doorWidth(0)).toBeCloseTo(1, 3);
  });

  it('lapping never eats past the stile', () => {
    const p = makeProject();
    p.defaults = {
      ...p.defaults,
      construction: 'frameless',
      cornerFrameWidth: 1.5,
      cornerFrameOverlay: 5,
    };
    // An overlay wider than the stile would otherwise push the fronts back out
    // over each other, which is the collision this whole thing exists to stop.
    expect(cornerFrameSetback(p.defaults)).toBe(0);
  });

  it('the corner carries stiles, not a slab of filler', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'frameless', cornerFrameWidth: 1.5 };
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const { parts } = generateCabinetParts(cab, p);
    const stile = parts.find((x) => x.name === 'Corner Frame Stile')!;
    expect(stile.qty).toBe(2);
    expect(stile.width).toBeCloseTo(1.5, 6);
    expect(stile.notes).toMatch(/mitred/i);
    expect(parts.some((x) => x.name === 'Corner Filler')).toBe(false);
  });

  it('the cabinet butting a corner carries the matching return stile', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'frameless', cornerFrameWidth: 1.5 };
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1, wallId, along: 0 }),
      makeCabinet('base', p, { width: 24, wallId, along: 36, doorCount: 2 }),
    ];
    applyWallPlacements(p);

    const neighbour = p.cabinets[1];
    const spec = specFor(neighbour, p.defaults);
    expect(cornerAdjacency(neighbour, spec, p)).toEqual({ left: true, right: false });

    const parts = generateCabinetParts(neighbour, p).parts;
    const ret = parts.find((x) => x.name === 'Corner Return Stile')!;
    expect(ret.qty).toBe(1);
    expect(ret.width).toBeCloseTo(1.5, 6);

    // And its fronts stop short of that stile by the setback, shared across
    // the pair of doors.
    const alone = generateCabinetParts(neighbour, { ...p, cabinets: [] }).parts;
    const doorOf = (rows: typeof parts) => rows.find((x) => x.category === 'door')!.width;
    expect(doorOf(alone) - doorOf(parts)).toBeCloseTo(cornerFrameSetback(spec) / 2, 3);
  });

  it('a cabinet nowhere near a corner carries no return stile', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'frameless' };
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { width: 24, wallId, along: 0, doorCount: 2 }),
      makeCabinet('base', p, { width: 24, wallId, along: 24, doorCount: 2 }),
    ];
    applyWallPlacements(p);
    expect(generateCabinetParts(p.cabinets[1], p).parts.some((x) => x.name === 'Corner Return Stile')).toBe(
      false,
    );
  });

  it('a face-frame corner needs none — its stiles already set the door in', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame', cornerFrameWidth: 1.5 };
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const spec = specFor(cab, p.defaults);
    expect(cornerFillerAllowance(cab, spec)).toBe(0);
  });

  it('a blind corner takes none — nothing meets it at an angle', () => {
    const p = makeProject();
    const cab = makeCabinet('base', p, { width: 48, corner: 'blind', blindWidth: 24 });
    expect(cornerFillerAllowance(cab, specFor(cab, p.defaults))).toBe(0);
  });

  it('setting the corner frame to zero gives the door the whole face back', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'frameless', cornerFrameWidth: 0 };
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const spec = specFor(cab, p.defaults);
    const door = computeFaceLayout(cab, spec, p.materials).openings.find((o) => o.kind === 'door')!;
    expect(door.frontWidth).toBeCloseTo(16.97 - 2 * spec.revealEdge, 1);
  });

  it('the drawing sets the corner stiles at the face, not proud of it', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'frameless', cornerFrameWidth: 1.5 };
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const boxes = buildCabinetGeometry(cab, p, { showDoors: true });
    const stiles = boxes.filter((b) => b.label === 'Corner frame stile');
    expect(stiles).toHaveLength(2);
    // No 'Corner filler' slab standing out in front of the box any more.
    expect(boxes.some((b) => b.label === 'Corner filler')).toBe(false);
  });

  it('the toe kick spans the full box so a run has no gaps at its joints', () => {
    const p = makeProject();
    const cab = makeCabinet('base', p, { width: 24, doorCount: 2 });
    const t = 0.71875;

    const drawn = buildCabinetGeometry(cab, p).find((b) => b.label === 'Toe kick')!;
    const cut = generateCabinetParts(cab, p).parts.find((x) => x.category === 'toeKick')!;

    // Cut to the interior width it left a gap of two side thicknesses at every
    // joint, which is what showed as slots along the bottom of the run.
    expect(drawn.size[0]).toBeCloseTo(24, 3);
    expect(drawn.size[0]).toBeGreaterThan(24 - 2 * t + 0.01);
    expect(cut.length).toBeCloseTo(24, 2);
  });

  it('a diagonal corner base gets a real toe recess', () => {
    const p = makeProject();
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const boxes = buildCabinetGeometry(cab, p);
    const kickH = p.defaults.toeKickHeight;

    // Nothing may stand at full depth down in the toe zone, or it fills the
    // space in front of the kick and the recess disappears.
    const inToeZone = boxes.filter(
      (b) => b.role === 'box' && b.pos[1] - b.size[1] / 2 < kickH - 0.01,
    );
    expect(inToeZone.length).toBeGreaterThan(0);
    expect(inToeZone.every((b) => b.label?.includes('toe leg'))).toBe(true);

    // And the kick face itself is still drawn.
    expect(boxes.some((b) => b.label === 'Toe kick')).toBe(true);
  });

  it('a diagonal corner upper has no toe notch to cut', () => {
    const p = makeProject();
    const cab = makeCabinet('wall', p, {
      width: 24,
      depth: 12,
      mountHeight: 54,
      corner: 'diagonal',
      doorCount: 1,
    });
    const boxes = buildCabinetGeometry(cab, p);
    expect(boxes.some((b) => b.label?.includes('toe leg'))).toBe(false);
  });

  it('a diagonal corner produces corner posts and a square deck blank', () => {
    const cab = makeCabinet('base', project, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const { parts } = generateCabinetParts(cab, project);
    expect(parts.some((p) => p.category === 'cornerPost')).toBe(true);
    const deck = parts.find((p) => p.category === 'bottom')!;
    expect(deck.length).toBeCloseTo(deck.width, 6);
  });

  it('a blind corner gets a filler panel to close the dead space', () => {
    const cab = makeCabinet('base', project, { width: 48, corner: 'blind', blindWidth: 24, doorCount: 1 });
    const { parts } = generateCabinetParts(cab, project);
    expect(parts.some((p) => p.category === 'filler')).toBe(true);
  });

  it('corner cabinets bill the hardware that makes them usable', () => {
    const p = makeProject();
    p.cabinets.push(makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 }));
    const est = computeEstimate(p);
    expect(est.hardwareCounts.some((h) => h.item.id === 'hw-lazy-susan')).toBe(true);

    const p2 = makeProject();
    p2.cabinets.push(makeCabinet('base', p2, { width: 48, corner: 'blind', blindWidth: 24, doorCount: 1 }));
    expect(computeEstimate(p2).hardwareCounts.some((h) => h.item.id === 'hw-blind-pullout')).toBe(true);
  });

  it('every corner preset builds without warnings', () => {
    for (const key of ['base-corner-diagonal', 'base-corner-blind', 'wall-corner-diagonal', 'wall-corner-blind']) {
      const preset = CABINET_PRESETS.find((x) => x.key === key)!;
      const proj = makeProject();
      const cab = preset.build(makeCabinet(preset.type, proj), proj.defaults);
      const { warnings } = generateCabinetParts(cab, proj);
      expect(warnings, `${key}: ${warnings.join(' | ')}`).toHaveLength(0);
    }
  });
});

describe('face frame drawer stacks fill the face exactly', () => {
  /**
   * The invariant a face frame has to hold: the rails and the openings between
   * them add up to the face zone. Miss it and the frame walks off the bottom
   * of the cabinet, which is what put drawer fronts out over the toe kick.
   */
  function stack(drawerCount: number, heights: number[]) {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame' };
    const cab = makeCabinet('base', p, {
      width: 24,
      height: 34.5,
      doorCount: 0,
      drawers: heights.slice(0, drawerCount).map((h, i) => ({ id: `d${i}`, frontHeight: h })),
    });
    const spec = specFor(cab, p.defaults);
    const layout = computeFaceLayout(cab, spec, p.materials);
    const rails = spec.frameRailWidth * (1 + Math.max(0, drawerCount - 1)) + spec.frameRailWidth;
    const openings = layout.openings.reduce((a, o) => a + o.openingHeight, 0);
    return { spec, layout, rails, openings, faceZone: cab.height - spec.toeKickHeight };
  }

  it('a 3 drawer base lands exactly on the bottom of the cabinet', () => {
    const s = stack(3, [6.875, 10.6875, 12.0625]);
    expect(s.rails + s.openings).toBeCloseTo(s.faceZone, 4);
  });

  it('a 4 drawer base does too — one more rail, one more front', () => {
    const s = stack(4, [6, 7.25, 8.125, 8.125]);
    expect(s.rails + s.openings).toBeCloseTo(s.faceZone, 4);
  });

  it('the fronts follow the re-fitted openings, not the frameless heights', () => {
    const s = stack(3, [6.875, 10.6875, 12.0625]);
    for (const op of s.layout.openings) {
      // Each front covers its own opening plus the overlay each side.
      expect(op.frontHeight).toBeCloseTo(op.openingHeight + 2 * s.spec.overlay, 4);
    }
  });

  it('keeps the proportions the drawer heights asked for', () => {
    const s = stack(3, [6.875, 10.6875, 12.0625]);
    const h = s.layout.openings.map((o) => o.openingHeight);
    // Graduated stack stays graduated — smallest at the top.
    expect(h[0]).toBeLessThan(h[1]);
    expect(h[1]).toBeLessThan(h[2]);
  });

  it('says so rather than silently resizing the job', () => {
    const s = stack(3, [6.875, 10.6875, 12.0625]);
    expect(s.layout.warnings.join(' ')).toMatch(/re-fitted to the face frame/i);
  });

  it('drawer boxes follow the re-fitted front, not the stored height', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame' };
    const cab = makeCabinet('base', p, {
      width: 24,
      height: 34.5,
      doorCount: 0,
      drawers: [6.875, 10.6875, 12.0625].map((h, i) => ({ id: `d${i}`, frontHeight: h })),
    });
    const spec = specFor(cab, p.defaults);
    const layout = computeFaceLayout(cab, spec, p.materials);
    const parts = generateCabinetParts(cab, p).parts;

    const sides = parts
      .filter((x) => x.category === 'drawerBoxSide')
      .map((x) => x.width)
      .sort((a, b) => a - b);
    const openings = layout.openings.map((o) => o.openingHeight).sort((a, b) => a - b);

    // A box built to the frameless height would be taller than the opening it
    // has to pass through — the drawer simply would not go in.
    sides.forEach((h, i) => expect(h).toBeLessThan(openings[i]));
  });

  it('a frameless stack is left alone', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'frameless' };
    const cab = makeCabinet('base', p, {
      width: 24,
      doorCount: 0,
      drawers: [6.875, 10.6875, 12.0625].map((h, i) => ({ id: `d${i}`, frontHeight: h })),
    });
    const layout = computeFaceLayout(cab, specFor(cab, p.defaults), p.materials);
    // Frameless fronts stack straight down the face, so they are as asked.
    expect(layout.openings.map((o) => o.frontHeight)).toEqual([6.875, 10.6875, 12.0625]);
  });
});

describe('corner geometry and clearance', () => {
  const project = makeProject();

  it('a diagonal corner occupies a square footprint in plan', () => {
    const cab = makeCabinet('base', project, { width: 36, depth: 24, corner: 'diagonal' });
    // Getting this wrong is what let corners silently overlap their neighbours.
    expect(planDepth(cab)).toBe(36);
    const f = footprint(cab);
    expect(f.z1 - f.z0).toBeCloseTo(36, 6);
  });

  it('a plain cabinet keeps its nominal depth', () => {
    expect(planDepth(makeCabinet('base', project, { width: 36, depth: 24 }))).toBe(24);
  });

  it('catches a corner overlapping the cabinet beside it', () => {
    const corner = makeCabinet('base', project, { name: 'Corner', width: 36, depth: 24, corner: 'diagonal', x: 0 });
    // 30 is past the nominal 24" depth but still inside the square footprint.
    const neighbour = makeCabinet('base', project, { name: 'Next', width: 24, depth: 24, x: 0, z: 30 });
    expect(findCollisions([corner, neighbour])).toHaveLength(1);
  });

  it('corner deck and shelves close the 45 degree face with no void', () => {
    const cab = makeCabinet('wall', project, { width: 24, depth: 12, corner: 'diagonal', shelfCount: 2 });
    const boxes = buildCabinetGeometry(cab, project);
    const panels = boxes.filter((b) => b.polygon);
    // Deck, top and two shelves all need a real outline, not a pair of boxes.
    expect(panels.length).toBeGreaterThanOrEqual(4);
    for (const p of panels) {
      expect(p.polygon).toHaveLength(5);
      // The diagonal edge must sit on x + z = constant, closing the face.
      const poly = p.polygon!;
      const sums = poly.map(([x, z]) => x + z);
      expect(Math.max(...sums) - Math.min(...sums)).toBeGreaterThan(0);
    }
  });

  it('a face-frame corner actually renders a frame on the 45 face', () => {
    const p = makeProject();
    p.defaults.construction = 'faceFrame';
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const boxes = buildCabinetGeometry(cab, p, { showDoors: true });

    // The corner branch used to return before any frame was built, so it
    // rendered frameless whatever the project said.
    const frame = boxes.filter((b) => b.role === 'frame');
    expect(frame.length).toBeGreaterThanOrEqual(4);
    // Every frame piece sits on the 45 degree face.
    for (const f of frame) expect(f.rotY).toBeCloseTo(Math.PI / 4, 6);
  });

  it('a frameless corner carries only its two clearance stiles', () => {
    const p = makeProject();
    p.defaults.construction = 'frameless';
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const boxes = buildCabinetGeometry(cab, p, { showDoors: true });
    const frame = boxes.filter((b) => b.role === 'frame');
    // No rails, no full frame — just the stile at each end of the 45 face.
    expect(frame).toHaveLength(2);
    expect(frame.every((b) => b.label === 'Corner frame stile')).toBe(true);
  });

  it('a plain frameless cabinet still has no frame at all', () => {
    const p = makeProject();
    p.defaults.construction = 'frameless';
    const cab = makeCabinet('base', p, { width: 24, doorCount: 2 });
    expect(buildCabinetGeometry(cab, p, { showDoors: true }).some((b) => b.role === 'frame')).toBe(false);
  });

  it('the corner door stands in front of the frame it hangs on', () => {
    const p = makeProject();
    p.defaults.construction = 'faceFrame';
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const boxes = buildCabinetGeometry(cab, p, { showDoors: true });
    const door = boxes.find((b) => b.role === 'door')!;
    const frame = boxes.filter((b) => b.role === 'frame');

    // Distance out along the 45 normal: the door has to be the furthest out.
    const outward = (b: (typeof boxes)[0]) => (b.pos[0] + b.pos[2]) / Math.SQRT2;
    expect(outward(door)).toBeGreaterThan(Math.max(...frame.map(outward)));
  });

  it('sizes the corner door against the frame opening', () => {
    const p = makeProject();
    p.defaults.construction = 'faceFrame';
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const layout = computeFaceLayout(cab, specFor(cab, p.defaults), p.materials);
    const door = layout.openings.find((o) => o.kind === 'door')!;
    const face = frontalWidth(cab);
    // Opening is the 45 face less two stiles; the door laps it by the overlay.
    expect(door.openingWidth).toBeCloseTo(face - 2 * p.defaults.frameStileWidth, 4);
    expect(door.frontWidth).toBeCloseTo(door.openingWidth + 2 * p.defaults.overlay, 4);
  });

  it('cuts corner frame rails to the 45 face, not the cabinet width', () => {
    const p = makeProject();
    p.defaults.construction = 'faceFrame';
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const rail = generateCabinetParts(cab, p).parts.find((x) => x.category === 'faceFrameRail')!;

    // A 36" corner has a 17" face. Cutting rails at 36" would be 19" of
    // hardwood wasted per rail and a frame that does not fit.
    expect(rail.length).toBeCloseTo(frontalWidth(cab) - 2 * p.defaults.frameStileWidth, 2);
    expect(rail.length).toBeLessThan(cab.width / 2);
  });

  it('blind corner rails span only the reachable face', () => {
    const p = makeProject();
    p.defaults.construction = 'faceFrame';
    const cab = makeCabinet('base', p, { width: 48, corner: 'blind', blindWidth: 24, doorCount: 1 });
    const rail = generateCabinetParts(cab, p).parts.find((x) => x.category === 'faceFrameRail')!;
    expect(rail.length).toBeCloseTo(24 - 2 * p.defaults.frameStileWidth, 2);
  });

  it('a plain cabinet still cuts rails to its full width', () => {
    const p = makeProject();
    p.defaults.construction = 'faceFrame';
    const cab = makeCabinet('base', p, { width: 30, doorCount: 2 });
    const rail = generateCabinetParts(cab, p).parts.find((x) => x.category === 'faceFrameRail')!;
    expect(rail.length).toBeCloseTo(30 - 2 * p.defaults.frameStileWidth, 4);
  });

  it('a frameless corner gets stiles so its door clears the neighbour', () => {
    const p = makeProject();
    p.defaults.construction = 'frameless';
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const { parts } = generateCabinetParts(cab, p);
    const stile = parts.find((x) => x.name === 'Corner Frame Stile');
    expect(stile).toBeDefined();
    expect(stile!.qty).toBe(2);
    expect(stile!.width).toBeCloseTo(p.defaults.cornerFrameWidth, 6);
  });

  it('warns when a frameless corner has no filler at all', () => {
    const p = makeProject();
    p.defaults.construction = 'frameless';
    p.defaults.cornerFillerWidth = 0;
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const { warnings } = generateCabinetParts(cab, p);
    expect(warnings.some((w) => /jam its door/i.test(w))).toBe(true);
  });

  it('a face frame corner needs no filler', () => {
    const p = makeProject();
    p.defaults.construction = 'faceFrame';
    const cab = makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', doorCount: 1 });
    const { parts } = generateCabinetParts(cab, p);
    expect(parts.some((x) => x.name === 'Corner Filler')).toBe(false);
  });

  it('warns when a diagonal corner is too narrow to leave a usable door', () => {
    const cab = makeCabinet('base', project, { width: 28, depth: 24, corner: 'diagonal', doorCount: 1 });
    const { warnings } = generateCabinetParts(cab, project);
    expect(warnings.some((w) => /Widen it/i.test(w))).toBe(true);
  });
});

describe('wall cabinet mounting', () => {
  it('hangs the first wall cabinet at the standard 54"', () => {
    expect(wallMountHeight(30, [])).toBe(54);
  });

  it('hangs a short bridge so its top matches the run', () => {
    const p = makeProject();
    const existing = [makeCabinet('wall', p, { height: 30, mountHeight: 54 })];
    // 18" bridge under an 84" run top must land at 66", not 54".
    expect(wallMountHeight(18, existing)).toBe(66);
  });

  it('falls back to the standard bottom when top-aligning would drop too low', () => {
    const p = makeProject();
    const existing = [makeCabinet('wall', p, { height: 30, mountHeight: 54 })];
    expect(wallMountHeight(42, existing)).toBe(54);
  });

  it('a stacked run reads as one line across the top', () => {
    const p = makeProject();
    const a = makeCabinet('wall', p, { height: 30, mountHeight: 54 });
    const bridgeMount = wallMountHeight(18, [a]);
    expect(bridgeMount + 18).toBe((a.mountHeight ?? 54) + a.height);
  });
});

describe('walls and multi-run layout', () => {
  it('faces cabinets into the room whichever way a wall was drawn', () => {
    const room = makeRoom('lShape', 168, 144);
    const centre = roomCentre(room);
    for (const wall of room.walls) {
      const f = wallFrame(wall, centre);
      const mx = (wall.x1 + wall.x2) / 2;
      const mz = (wall.z1 + wall.z2) / 2;
      // The front normal must point toward the middle of the room.
      expect((centre.x - mx) * f.nx + (centre.z - mz) * f.nz).toBeGreaterThan(0);
    }
  });

  it('faces correctly even when a wall is entered backwards', () => {
    const room = makeRoom('lShape', 168, 144);
    const w = room.walls[0];
    const flipped = { ...w, x1: w.x2, z1: w.z2, x2: w.x1, z2: w.z1 };
    const centre = roomCentre(room);
    const a = wallFrame(w, centre);
    const b = wallFrame(flipped, centre);
    // Same physical wall, so the same face direction either way.
    expect(b.nx).toBeCloseTo(a.nx, 6);
    expect(b.nz).toBeCloseTo(a.nz, 6);
  });

  it('places a cabinet along the wall it belongs to', () => {
    const room = makeRoom('uShape', 120, 120);
    const centre = roomCentre(room);
    const f = wallFrame(room.walls[1], centre);
    const p = placeOnWall(f, 24);
    expect(Math.hypot(p.x - f.originX, p.z - f.originZ)).toBeCloseTo(24, 6);
  });

  it('projects a dragged point back onto a wall', () => {
    const room = makeRoom('lShape', 168, 144);
    const f = wallFrame(room.walls[0], roomCentre(room));
    const p = placeOnWall(f, 36);
    const back = projectOntoWall(f, p.x, p.z);
    expect(back.along).toBeCloseTo(36, 6);
    expect(back.offset).toBeCloseTo(0, 6);
  });

  it('gives each wall its own independent run', () => {
    const project = makeProject();
    const [wallA, wallB] = project.room.walls;
    project.cabinets = [
      makeCabinet('base', project, { name: 'A1', width: 24, wallId: wallA.id, along: 0 }),
      makeCabinet('base', project, { name: 'A2', width: 24, wallId: wallA.id, along: 24 }),
      makeCabinet('base', project, { name: 'B1', width: 30, wallId: wallB.id, along: 0 }),
    ];
    applyWallPlacements(project);

    const a2 = project.cabinets[1];
    const b1 = project.cabinets[2];
    // The two runs head off in different directions, so they must not share
    // a position just because they share an `along` origin.
    expect(a2.rotation).not.toBeCloseTo(b1.rotation, 3);
    expect(findCollisions(project.cabinets)).toHaveLength(0);
  });

  it('a U-shaped kitchen fills three walls without overlaps', () => {
    const project = makeProject();
    project.room = makeRoom('uShape', 144, 120);
    project.cabinets = [];
    for (const wall of project.room.walls) {
      for (let i = 0; i < 3; i++) {
        project.cabinets.push(
          makeCabinet('base', project, {
            name: `${wall.id}-${i}`,
            width: 24,
            wallId: wall.id,
            along: i * 24,
          }),
        );
      }
    }
    applyWallPlacements(project);
    expect(project.cabinets).toHaveLength(9);
    // Distinct rotations prove the runs actually turned the corners.
    expect(new Set(project.cabinets.map((c) => Math.round(c.rotation))).size).toBe(3);
  });
});

describe('countertop placement', () => {
  /**
   * Mirrors what Scene3D does: the group sits at the cabinet origin with the
   * cabinet's rotation, and the slab is offset in the cabinet's own frame.
   * Adding the offset in world axes before rotating is what put counters
   * beside their cabinets on the side walls.
   */
  const counterCentre = (c: ReturnType<typeof makeCabinet>) =>
    toWorld(c, [c.width / 2, c.height, c.depth / 2]);

  it('centres the slab over the cabinet on every wall of a U', () => {
    const project = makeProject();
    project.room = makeRoom('uShape', 144, 120);
    project.cabinets = project.room.walls.map((w) =>
      makeCabinet('base', project, { width: 24, depth: 24, wallId: w.id, along: 12 }),
    );
    applyWallPlacements(project);

    for (const cab of project.cabinets) {
      const [cx, , cz] = counterCentre(cab);
      const f = footprint(cab);
      // The slab centre must land inside the cabinet's own footprint.
      expect(cx).toBeGreaterThanOrEqual(f.x0 - 0.01);
      expect(cx).toBeLessThanOrEqual(f.x1 + 0.01);
      expect(cz).toBeGreaterThanOrEqual(f.z0 - 0.01);
      expect(cz).toBeLessThanOrEqual(f.z1 + 0.01);
    }
  });

  it('a rotated cabinet does not reuse the unrotated centre', () => {
    const project = makeProject();
    const rotated = makeCabinet('base', project, { width: 24, depth: 24, x: 100, z: 50, rotation: 90 });
    const [cx, , cz] = counterCentre(rotated);
    const naive = { x: rotated.x + rotated.width / 2, z: rotated.z + rotated.depth / 2 };
    expect(Math.hypot(cx - naive.x, cz - naive.z)).toBeGreaterThan(1);
  });
});

/*
 * Every appliance test above builds a `singleWall` room, whose one wall runs
 * along world x at zero degrees. On that wall alone, treating an appliance as
 * the box (x..x+width, z..z+depth) happens to be right — so a whole class of
 * rotation bugs stayed invisible while the suite was green. These build on the
 * rotated walls of a U instead.
 */
describe('appliances are respected on rotated walls, not just the first one', () => {
  /** A U kitchen: walls 0 and 2 run along z, so both are rotated 90 degrees. */
  function uKitchen(runLength = 154) {
    const p = makeProject();
    p.room = makeRoom('uShape', 200, runLength);
    return p;
  }

  function addAppliance(p: Project, key: string, wallId: string, along: number) {
    const a = makeAppliance(APPLIANCE_PRESETS.find((x) => x.key === key)!);
    a.wallId = wallId;
    a.along = along;
    p.appliances = [...(p.appliances ?? []), a];
    return a;
  }

  it('an appliance footprint turns with the wall it stands on', () => {
    const p = uKitchen();
    const rotated = p.room.walls[0];
    const dw = addAppliance(p, 'dw-24', rotated.id, 48);
    applyWallPlacements(p);

    // On a wall running along z, 24" of width must show up as 24" of z, not x.
    const f = footprint(dw);
    expect(f.z1 - f.z0).toBeCloseTo(24, 3);
    expect(f.x1 - f.x0).toBeCloseTo(dw.depth, 3);
  });

  it('counts a dishwasher standing in the run on a rotated wall', () => {
    const p = uKitchen();
    const wall = p.room.walls[0];
    for (let i = 0; i < 4; i++) {
      p.cabinets.push(makeCabinet('base', p, { width: 24, wallId: wall.id, along: i * 24 }));
    }
    addAppliance(p, 'dw-24', wall.id, 96);
    applyWallPlacements(p);

    const s = runStatus(p, wall.id, false);
    expect(s.used).toBeCloseTo(96, 3);
    // The bug: spanAlongWall projected the appliance's unrotated box, decided
    // it was not against this wall, and dropped it — leaving 24" unaccounted.
    expect(s.applianceCount).toBe(1);
    expect(s.applianceUsed).toBeCloseTo(24, 3);
    expect(s.filledTo).toBeCloseTo(120, 3);
  });

  it('does not invent an overlap between a cabinet and the appliance butting it', () => {
    const p = uKitchen();
    const wall = p.room.walls[0];
    p.cabinets.push(makeCabinet('base', p, { width: 24, wallId: wall.id, along: 72 }));
    addAppliance(p, 'dw-24', wall.id, 96);
    applyWallPlacements(p);

    // They share a face at 96" along. A shared face is not an overlap.
    expect(findCollisions(p.cabinets, p.appliances)).toEqual([]);
  });

  it('a real overlap on a rotated wall is still caught', () => {
    const p = uKitchen();
    const wall = p.room.walls[0];
    p.cabinets.push(makeCabinet('base', p, { width: 24, wallId: wall.id, along: 72 }));
    addAppliance(p, 'dw-24', wall.id, 84);
    applyWallPlacements(p);

    expect(findCollisions(p.cabinets, p.appliances)).toHaveLength(1);
  });

  it('sees a microwave over a range on a rotated wall', () => {
    const p = uKitchen();
    const wall = p.room.walls[0];
    const range = addAppliance(p, 'range-30', wall.id, 40);
    const micro = addAppliance(p, 'micro-otr', wall.id, 40);
    applyWallPlacements(p);

    expect(overlapsInPlan(range, micro)).toBe(true);
    // And so the clearance check has something to measure.
    micro.mountHeight = range.mountHeight + range.height + 4;
    expect(layoutWarnings(p).length).toBeGreaterThan(0);
  });

  it("the user's wall: four bases, a dishwasher and a corner leave 1 inch", () => {
    const p = makeProject();
    // The 154" run is the second wall here, so the corner sits on the first.
    p.room = makeRoom('lShape', 144, 154);
    const [adjoining, wall] = p.room.walls;

    // A 33" diagonal corner on the adjoining wall reaches its full width back
    // along this one, taking 33" out of this run at the corner end.
    p.cabinets.push(
      makeCabinet('base', p, {
        width: 33,
        depth: 24,
        corner: 'diagonal',
        wallId: adjoining.id,
        along: 0,
      }),
    );
    applyWallPlacements(p);

    // Which end of this wall the shared corner falls on depends on which way
    // the wall faces, so start the run wherever the corner leaves off.
    let along = runStatus(p, wall.id, false).startsAt;
    for (let i = 0; i < 4; i++) {
      p.cabinets.push(makeCabinet('base', p, { width: 24, wallId: wall.id, along }));
      along += 24;
    }
    addAppliance(p, 'dw-24', wall.id, along);
    applyWallPlacements(p);

    const s = runStatus(p, wall.id, false);
    expect(s.wallLength).toBeCloseTo(154, 3);
    expect(s.usable).toBeCloseTo(121, 2);
    expect(s.used).toBeCloseTo(96, 3);
    expect(s.applianceUsed).toBeCloseTo(24, 3);
    // 154 less the 33 the corner reaches back, 96 of cabinet and 24 of
    // dishwasher. Not the 25" that came of ignoring the dishwasher entirely.
    expect(s.remaining).toBeCloseTo(1, 2);
  });
});

describe('crown length follows the run, not the world axes', () => {
  it('cabinets butting on a rotated wall do not each get a returned end', () => {
    const p = makeProject();
    p.room = makeRoom('uShape', 200, 154);
    const wall = p.room.walls[0];
    const a = makeCabinet('wall', p, { width: 30, wallId: wall.id, along: 0 });
    const b = makeCabinet('wall', p, { width: 30, wallId: wall.id, along: 30 });
    p.cabinets = [a, b];
    applyWallPlacements(p);

    // `a` is open on its left only; its right butts `b`. One return, not two.
    expect(crownRunLength(a, p.cabinets)).toBeCloseTo(frontalWidth(a) + a.depth, 3);
    expect(crownRunLength(b, p.cabinets)).toBeCloseTo(frontalWidth(b) + b.depth, 3);
  });
});

/** Part sizes are snapped to 1/32", so comparisons allow half a snap step. */
const nearCutTop = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1 / 64 + 1e-9);

describe('windows cut the wall and stay out of the run maths', () => {
  function wallWithWindow() {
    const p = makeProject();
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { width: 24, wallId, along: 0 }),
      makeCabinet('base', p, { width: 24, wallId, along: 24 }),
    ];
    p.windows = [makeWindow(wallId, { along: 12, width: 36, height: 48, sillHeight: 42 })];
    applyWallPlacements(p);
    return { p, wallId };
  }

  it('takes no length off the run it sits over', () => {
    const { p, wallId } = wallWithWindow();
    // `runStatus` does not even accept windows in its signature, which is the
    // structural half of this guarantee; this pins the behaviour as well.
    const stripped: Project = { ...p, windows: [] };
    const withWindow = runStatus(p, wallId, false);
    const without = runStatus(stripped, wallId, false);

    expect(withWindow.used).toBeCloseTo(without.used, 6);
    expect(withWindow.remaining).toBeCloseTo(without.remaining, 6);
    expect(withWindow.startsAt).toBeCloseTo(without.startsAt, 6);
    expect(withWindow.applianceCount).toBe(without.applianceCount);
  });

  it('never collides with a cabinet', () => {
    const { p } = wallWithWindow();
    // A window has no footprint at all, so there is nothing to collide with.
    expect(findCollisions(p.cabinets, p.appliances)).toEqual([]);
  });

  it('a re-flow leaves it exactly where it was put', () => {
    useProject.getState().newProject('Window reflow');
    const wallId = useProject.getState().project.room.walls[0].id;
    useProject.getState().setActiveWall(wallId);
    useProject.getState().addCabinet('base-2door');
    useProject.getState().addWindow();

    const before = useProject.getState().project.windows[0];
    const at = before.along;
    useProject.getState().updateCabinet(
      useProject.getState().project.cabinets[0].id,
      { width: 33 },
    );
    useProject.getState().autoArrange();

    expect(useProject.getState().project.windows[0].along).toBeCloseTo(at, 6);
  });

  it('contributes nothing to the cut list', () => {
    const { p } = wallWithWindow();
    const withWindow = generateProjectParts(p).parts.length;
    const without = generateProjectParts({ ...p, windows: [] }).parts.length;
    expect(withWindow).toBe(without);
  });

  it('punches a hole the size of the opening', () => {
    const wall = { height: 96 };
    const rects = wallOpeningRects(wall, 120, [
      makeWindow('w1', { along: 36, width: 36, height: 48, sillHeight: 42 }),
    ]);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x0: 36, x1: 72, y0: 42, y1: 90 });
  });

  it('clamps an opening that runs past the end rather than dropping it', () => {
    const rects = wallOpeningRects({ height: 96 }, 120, [
      makeWindow('w1', { along: 100, width: 60, height: 48, sillHeight: 42 }),
    ]);
    expect(rects[0].x0).toBe(100);
    expect(rects[0].x1).toBe(120);
  });

  it('skips an opening with no area, which would break the wall mesh', () => {
    expect(
      wallOpeningRects({ height: 96 }, 120, [
        makeWindow('w1', { along: 130, width: 36 }),
        makeWindow('w1', { along: 10, width: 36, sillHeight: 96, height: 48 }),
      ]),
    ).toEqual([]);
  });

  it('a hidden window closes the wall back up', () => {
    expect(
      wallOpeningRects({ height: 96 }, 120, [makeWindow('w1', { hidden: true })]),
    ).toEqual([]);
  });

  it('is dropped when its wall goes away', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 120, 120);
    p.windows = [makeWindow('a-wall-that-no-longer-exists')];
    expect(migrateProject(p).windows).toHaveLength(0);
  });
});

describe('crown leaves room for itself on the doors', () => {
  function upperWith(crownOn: boolean, construction: 'frameless' | 'faceFrame') {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction };
    p.crown = { ...p.crown, enabled: crownOn, overlap: 1 };
    const cab = makeCabinet('wall', p, { width: 30, height: 30, doorCount: 2 });
    const door = computeFaceLayout(
      cab,
      specFor(cab, p.defaults),
      p.materials,
      crownContext(cab, p),
    ).openings.find((o) => o.kind === 'door')!;
    return door.frontHeight;
  }

  it('frameless doors give up the crown overlap', () => {
    const plain = upperWith(false, 'frameless');
    const crowned = upperWith(true, 'frameless');
    // The moulding laps an inch down over the top of the box, so the door has
    // to stop an inch short or the crown lands on top of it.
    expect(plain - crowned).toBeCloseTo(1, 3);
  });

  it('face-frame doors give up the wider top rail', () => {
    const p = makeProject();
    const plain = upperWith(false, 'faceFrame');
    const crowned = upperWith(true, 'faceFrame');
    expect(plain - crowned).toBeCloseTo(p.defaults.crownTopRailWidth - p.defaults.frameRailWidth, 3);
  });

  it('a diagonal corner upper gives up the same height', () => {
    const doorHeight = (crownOn: boolean) => {
      const p = makeProject();
      p.crown = { ...p.crown, enabled: crownOn, overlap: 1 };
      const cab = makeCabinet('wall', p, {
        width: 24,
        depth: 12,
        height: 30,
        doorCount: 1,
        corner: 'diagonal',
      });
      return computeFaceLayout(cab, specFor(cab, p.defaults), p.materials, crownContext(cab, p))
        .openings.find((o) => o.kind === 'door')!.frontHeight;
    };
    expect(doorHeight(false) - doorHeight(true)).toBeCloseTo(1, 3);
  });

  it('a blind corner upper gives up the same height', () => {
    const doorHeight = (crownOn: boolean) => {
      const p = makeProject();
      p.crown = { ...p.crown, enabled: crownOn, overlap: 1 };
      const cab = makeCabinet('wall', p, {
        width: 36,
        height: 30,
        doorCount: 1,
        corner: 'blind',
        blindWidth: 12,
      });
      return computeFaceLayout(cab, specFor(cab, p.defaults), p.materials, crownContext(cab, p))
        .openings.find((o) => o.kind === 'door')!.frontHeight;
    };
    expect(doorHeight(false) - doorHeight(true)).toBeCloseTo(1, 3);
  });

  it('open shelving has no door to shorten but still takes crown', () => {
    const p = makeProject();
    p.crown = { ...p.crown, enabled: true, overlap: 1 };
    const shelf = makeCabinet('wall', p, { width: 30, height: 30, doorCount: 0, shelfCount: 2 });
    const layout = computeFaceLayout(shelf, specFor(shelf, p.defaults), p.materials, crownContext(shelf, p));
    expect(layout.openings.filter((o) => o.kind === 'door')).toHaveLength(0);
    // It still gets a crown run across its top, same as its neighbours.
    expect(crownContext(shelf, p).crowned).toBe(true);
    expect(crownRuns({ ...p, cabinets: [shelf] })).toHaveLength(1);
  });

  it('every upper in a run drops its doors by the same amount', () => {
    const p = makeProject();
    p.crown = { ...p.crown, enabled: true, overlap: 1 };
    const kinds = [
      makeCabinet('wall', p, { width: 30, height: 30, doorCount: 2 }),
      makeCabinet('wall', p, { width: 18, height: 30, doorCount: 1 }),
      makeCabinet('wall', p, { width: 24, depth: 12, height: 30, doorCount: 1, corner: 'diagonal' }),
      makeCabinet('tall', p, { width: 30, height: 84, doorCount: 2 }),
    ];
    for (const cab of kinds) {
      const spec = specFor(cab, p.defaults);
      const on = computeFaceLayout(cab, spec, p.materials, crownContext(cab, p)).openings.find(
        (o) => o.kind === 'door',
      )!.frontHeight;
      const off = computeFaceLayout(cab, spec, p.materials).openings.find(
        (o) => o.kind === 'door',
      )!.frontHeight;
      expect(off - on).toBeCloseTo(1, 3);
    }
  });

  it('a crowned corner draws the wide top rail the cut list cuts', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame' };
    p.crown = { ...p.crown, enabled: true, overlap: 1 };
    const cab = makeCabinet('wall', p, {
      width: 24,
      depth: 12,
      height: 30,
      mountHeight: 54,
      doorCount: 1,
      corner: 'diagonal',
    });

    const topRail = buildCabinetGeometry(cab, p).find((b) => b.label === 'Top rail')!;
    const bottomRail = buildCabinetGeometry(cab, p).find((b) => b.label === 'Bottom rail')!;
    // The corner draws its own frame on the 45 face; it was drawing a standard
    // rail there while the parts generator cut the wide crowned one.
    expect(topRail.size[1]).toBeCloseTo(p.defaults.crownTopRailWidth, 4);
    expect(bottomRail.size[1]).toBeCloseTo(p.defaults.frameRailWidth, 4);
  });

  it('the corner frame is set into the box, not applied to the front of it', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame' };
    const W = 24;
    const D = 12;
    const cab = makeCabinet('wall', p, {
      width: W,
      depth: D,
      height: 30,
      mountHeight: 54,
      doorCount: 1,
      corner: 'diagonal',
    });
    const boxes = buildCabinetGeometry(cab, p, { showDoors: true });

    /*
     * The 45 face runs through (W, D) and (D, W), so x + z = W + D on it.
     * Distance out from the face is therefore (x + z - (W + D)) / sqrt(2),
     * negative for anything sitting inside the box.
     */
    const outFromFace = (b: { pos: [number, number, number]; size: [number, number, number] }) =>
      (b.pos[0] + b.pos[2] - (W + D)) / Math.SQRT2;

    const ft = p.defaults.frameThickness;
    for (const label of ['Corner stile', 'Top rail', 'Bottom rail']) {
      const piece = boxes.find((b) => b.label === label)!;
      // Centre half a thickness behind the face means it spans [-ft, 0]:
      // flush at the front, buried in the box behind. It used to sit at
      // +ft/2, standing proud of the whole cabinet.
      expect(outFromFace(piece), label).toBeCloseTo(-ft / 2, 3);
    }

    // And the overlay door still lands on the outside of that frame.
    const door = boxes.find((b) => b.role === 'door')!;
    expect(outFromFace(door)).toBeGreaterThan(0);
  });

  it('an uncrowned corner keeps a standard top rail', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame' };
    p.crown = { ...p.crown, enabled: false };
    const cab = makeCabinet('wall', p, {
      width: 24,
      depth: 12,
      height: 30,
      mountHeight: 54,
      doorCount: 1,
      corner: 'diagonal',
    });
    const topRail = buildCabinetGeometry(cab, p).find((b) => b.label === 'Top rail')!;
    expect(topRail.size[1]).toBeCloseTo(p.defaults.frameRailWidth, 4);
  });

  it('the drawn corner rail matches the cut one', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame' };
    p.crown = { ...p.crown, enabled: true, overlap: 1 };
    const cab = makeCabinet('wall', p, {
      width: 24,
      depth: 12,
      height: 30,
      mountHeight: 54,
      doorCount: 1,
      corner: 'diagonal',
    });

    const drawn = buildCabinetGeometry(cab, p).find((b) => b.label === 'Top rail')!.size[1];
    const cut = generateCabinetParts(cab, p).parts.find((x) =>
      x.name.includes('Top Rail'),
    )!.width;
    expect(drawn).toBeCloseTo(cut, 3);
  });

  it('a cabinet opted out of crown keeps its full door', () => {
    const p = makeProject();
    p.crown = { ...p.crown, enabled: true, overlap: 1 };
    const on = makeCabinet('wall', p, { width: 30, height: 30, doorCount: 2 });
    const off = { ...on, crown: false };
    const heightOf = (c: typeof on) =>
      computeFaceLayout(c, specFor(c, p.defaults), p.materials, crownContext(c, p)).openings.find(
        (o) => o.kind === 'door',
      )!.frontHeight;
    expect(heightOf(off)).toBeGreaterThan(heightOf(on));
  });

  it('base cabinets are untouched by crown', () => {
    const p = makeProject();
    p.crown = { ...p.crown, enabled: true, overlap: 1 };
    const base = makeCabinet('base', p, { width: 30, doorCount: 2 });
    expect(crownContext(base, p).crowned).toBe(false);
  });
});

describe('finished backs and applied end panels', () => {
  const project = makeProject();

  it('an unfinished back adds no panel parts', () => {
    const cab = makeCabinet('base', project, { width: 30 });
    const { parts } = generateCabinetParts(cab, project);
    expect(parts.filter((p) => p.category === 'finishedPanel')).toHaveLength(0);
  });

  it('a shaker back cuts two stiles, two rails and a field', () => {
    const cab = makeCabinet('base', project, { width: 30, backPanel: 'shaker' });
    const spec = specFor(cab, project.defaults);
    const { parts } = generateCabinetParts(cab, project);
    const panel = parts.filter((p) => p.category === 'finishedPanel');

    const stiles = panel.find((p) => p.name.includes('Stile'))!;
    const rails = panel.find((p) => p.name.includes('Rail'))!;
    const field = panel.find((p) => p.name.includes('Field'))!;
    expect(stiles.qty).toBe(2);
    expect(rails.qty).toBe(2);
    expect(field.qty).toBe(1);

    // Stiles run the full panel height, which starts at the top of the kick.
    nearCutTop(stiles.length, cab.height - spec.toeKickHeight);
    expect(stiles.width).toBeCloseTo(spec.frameStileWidth, 3);
    // Rails span between the stiles plus a tongue at each end.
    nearCutTop(rails.length, 30 - 2 * spec.frameStileWidth + 2 * (3 / 8));
  });

  it('a slab back is a single sheet', () => {
    const cab = makeCabinet('base', project, { width: 30, backPanel: 'slab' });
    const { parts } = generateCabinetParts(cab, project);
    expect(parts.filter((p) => p.category === 'finishedPanel')).toHaveLength(1);
  });

  it('a slab finished end stays part-free — the side itself is the finish', () => {
    const cab = makeCabinet('base', project, { finishedLeft: true, endPanelStyle: 'slab' });
    const { parts } = generateCabinetParts(cab, project);
    expect(parts.filter((p) => p.category === 'finishedPanel')).toHaveLength(0);
  });

  it('two applied ends cut twice the pieces of one', () => {
    const one = generateCabinetParts(
      makeCabinet('base', project, { finishedLeft: true, endPanelStyle: 'shaker' }),
      project,
    ).parts.filter((p) => p.category === 'finishedPanel');
    const two = generateCabinetParts(
      makeCabinet('base', project, {
        finishedLeft: true,
        finishedRight: true,
        endPanelStyle: 'shaker',
      }),
      project,
    ).parts.filter((p) => p.category === 'finishedPanel');

    const total = (rows: typeof one) => rows.reduce((a, p) => a + p.qty, 0);
    expect(total(two)).toBe(total(one) * 2);
  });

  it('an applied end is cut to the cabinet depth, not its width', () => {
    const cab = makeCabinet('base', project, {
      width: 36,
      depth: 24,
      finishedLeft: true,
      endPanelStyle: 'shaker',
    });
    const spec = specFor(cab, project.defaults);
    const { parts } = generateCabinetParts(cab, project);
    const rail = parts.find((p) => p.category === 'finishedPanel' && p.name.includes('Rail'))!;
    nearCutTop(rail.length, 24 - 2 * spec.frameStileWidth + 2 * (3 / 8));
  });

  it('the back panel shows up in the drawing too', () => {
    const plain = buildCabinetGeometry(makeCabinet('base', project, { width: 30 }), project);
    const panelled = buildCabinetGeometry(
      makeCabinet('base', project, { width: 30, backPanel: 'shaker' }),
      project,
    );
    expect(panelled.length).toBeGreaterThan(plain.length);
    expect(panelled.some((b) => b.label?.startsWith('Back panel'))).toBe(true);
  });
});

describe('apron sinks have no front stretcher', () => {
  const project = makeProject();

  it('cuts one stretcher, not two', () => {
    const plain = makeCabinet('base', project, { width: 36 });
    const apron = makeCabinet('base', project, {
      width: 36,
      sink: {
        style: 'farmhouse',
        width: 33,
        frontToBack: 20,
        bowlDepth: 9,
        apronHeight: 10,
        faucet: true,
      },
    });
    const stretcherQty = (c: typeof plain) =>
      generateCabinetParts(c, project)
        .parts.filter((p) => p.category === 'stretcher')
        .reduce((a, p) => a + p.qty, 0);

    expect(stretcherQty(plain)).toBe(2);
    // The apron closes the front of the cabinet, so nothing spans it.
    expect(stretcherQty(apron)).toBe(1);
  });

  it('draws no front stretcher', () => {
    const apron = makeCabinet('base', project, {
      width: 36,
      sink: {
        style: 'farmhouse',
        width: 33,
        frontToBack: 20,
        bowlDepth: 9,
        apronHeight: 10,
        faucet: true,
      },
    });
    const boxes = buildCabinetGeometry(apron, project);
    expect(boxes.some((b) => b.label === 'Front stretcher')).toBe(false);
    expect(boxes.some((b) => b.label === 'Rear stretcher')).toBe(true);
  });
});

describe('bar tops', () => {
  const project = makeProject();

  it('the slab carries every overhang', () => {
    const bar = makeBarTop(project, {
      length: 72,
      thickness: 4.5,
      overhangFront: 12,
      overhangBack: 1.5,
      overhangLeft: 1.5,
      overhangRight: 3,
    });
    const slab = barTopSlabSize(bar);
    expect(slab.length).toBeCloseTo(72 + 1.5 + 3, 4);
    expect(slab.depth).toBeCloseTo(4.5 + 12 + 1.5, 4);
  });

  it('flags a bar that would not clear the counter behind it', () => {
    const bar = makeBarTop(project, { wallHeight: 36 });
    expect(generateBarTopParts(bar, project).warnings.join(' ')).toMatch(/no taller than the counter/i);
  });

  it('flags knee room too tight to seat anyone', () => {
    const bar = makeBarTop(project, { overhangFront: 6 });
    expect(generateBarTopParts(bar, project).warnings.join(' ')).toMatch(/knee room/i);
  });

  it('a shaker bar wall cuts a frame and a substrate', () => {
    const bar = makeBarTop(project, { panelStyle: 'shaker', length: 72, wallHeight: 42 });
    const { parts } = generateBarTopParts(bar, project);
    expect(parts.some((p) => p.category === 'barTop')).toBe(true);
    expect(parts.filter((p) => p.category === 'finishedPanel').length).toBe(3);
  });

  it('the slab sits on top of the wall and reaches out to the seating side', () => {
    const bar = makeBarTop(project, { wallHeight: 42, topThickness: 1.5, overhangFront: 12 });
    const boxes = buildBarTopGeometry(bar, project, '#222');
    const slab = boxes.find((b) => b.label === 'Bar top')!;
    // Bottom of the slab lands on the top of the wall.
    expect(slab.pos[1] - slab.size[1] / 2).toBeCloseTo(42, 3);
    // And it reaches past the wall into negative z, where the stools go.
    expect(slab.pos[2] - slab.size[2] / 2).toBeLessThan(-12);
  });

  it('a painted wall is built by others — no parts at all', () => {
    const p = makeProject();
    p.barTops = [makeBarTop(p, { panelStyle: 'none' })];
    const built = generateProjectParts(p);
    expect(built.parts.filter((x) => x.cabinetName === p.barTops[0].name)).toHaveLength(0);
  });

  it('a painted wall costs nothing, a clad one does', () => {
    const bare = makeProject();
    const none = computeEstimate(bare).clientTotal;

    const plastered = makeProject();
    plastered.barTops = [makeBarTop(plastered, { panelStyle: 'none', length: 72 })];

    const clad = makeProject();
    clad.barTops = [makeBarTop(clad, { panelStyle: 'shaker', length: 72 })];

    // Somebody else frames and plasters it, so it carries neither parts nor
    // hours. Choosing wood means we build it, and that has to show up.
    expect(computeEstimate(plastered).clientTotal).toBeCloseTo(none, 6);
    expect(computeEstimate(clad).clientTotal).toBeGreaterThan(none);
  });

  it('a clad bar wall carries build hours, not just material', () => {
    const p = makeProject();
    p.labor = { ...p.labor, hoursPerBarWallFoot: 1 };
    p.barTops = [makeBarTop(p, { panelStyle: 'shaker', length: 120 })];
    const withRate = computeEstimate(p).laborHours.build;

    const q = makeProject();
    q.labor = { ...q.labor, hoursPerBarWallFoot: 0 };
    q.barTops = [makeBarTop(q, { panelStyle: 'shaker', length: 120 })];
    // 120" is 10 feet, so an hour a foot is ten hours.
    expect(withRate - computeEstimate(q).laborHours.build).toBeCloseTo(10, 3);
  });

  it('the drawing shows a painted wall with no panel on it', () => {
    const p = makeProject();
    const bar = makeBarTop(p, { panelStyle: 'none' });
    const boxes = buildBarTopGeometry(bar, p, '#000');
    expect(boxes.some((b) => b.label === 'Bar wall')).toBe(true);
    expect(boxes.some((b) => b.label?.startsWith('Bar panel'))).toBe(false);
  });

  it('a wall built by others takes the room wall colour', () => {
    const p = makeProject();
    p.view = { ...p.view, wallColor: '#bbbbbb', doorColor: '#aaaaaa' };
    const body = (bar: BarTop) =>
      buildBarTopGeometry(bar, p, '#000').find((b) => b.label === 'Bar wall')!.color;

    // No panel means plasterwork, whichever way `finish` was left set.
    expect(body(makeBarTop(p, { panelStyle: 'none', finish: 'cabinet' }))).toBe('#bbbbbb');
    expect(body(makeBarTop(p, { panelStyle: 'none', finish: 'wall' }))).toBe('#bbbbbb');
    // A clad one still follows the doors.
    expect(body(makeBarTop(p, { panelStyle: 'shaker', finish: 'cabinet' }))).toBe('#aaaaaa');
  });

  it('hiding a bar wall is visual only — it still cuts and still prices', () => {
    const p = makeProject();
    p.barTops = [makeBarTop(p, { hidden: true })];
    const built = generateProjectParts(p);
    expect(built.parts.some((x) => x.category === 'barTop')).toBe(true);
  });

  it('excluding a bar wall does take it out of the parts', () => {
    const p = makeProject();
    p.barTops = [makeBarTop(p, { excluded: true })];
    const built = generateProjectParts(p);
    expect(built.parts.some((x) => x.category === 'barTop')).toBe(false);
  });

  it('rides along with the wall it is assigned to', () => {
    const p = makeProject();
    p.room = makeRoom('uShape', 200, 154);
    const wall = p.room.walls[0];
    p.barTops = [makeBarTop(p, { wallId: wall.id, along: 24 })];
    applyWallPlacements(p);
    // A rotated wall has to turn the bar with it, same as everything else.
    expect(p.barTops[0].rotation % 360).not.toBe(0);
  });
});

describe('appliances can be pinned in a run', () => {
  it('a pinned appliance holds its spot while the cabinets pack around it', () => {
    useProject.getState().newProject('Pin test');
    const p0 = useProject.getState().project;
    const wallId = p0.room.walls[0].id;
    useProject.getState().setActiveWall(wallId);

    useProject.getState().addCabinet('base-2door');
    useProject.getState().addAppliance('range-30');

    const app = useProject.getState().project.appliances[0];
    useProject.getState().updateAppliance(app.id, { along: 60, pinned: true });
    useProject.getState().autoArrange();

    const after = useProject.getState().project.appliances[0];
    expect(after.along).toBeCloseTo(60, 3);
  });

  it('an unpinned appliance packs into the run', () => {
    useProject.getState().newProject('Pack test');
    const p0 = useProject.getState().project;
    const wallId = p0.room.walls[0].id;
    useProject.getState().setActiveWall(wallId);

    useProject.getState().addCabinet('base-2door');
    useProject.getState().addAppliance('range-30');

    const app = useProject.getState().project.appliances[0];
    useProject.getState().updateAppliance(app.id, { along: 60, pinned: false });
    useProject.getState().autoArrange();

    const after = useProject.getState().project.appliances[0];
    expect(after.along).toBeLessThan(60);
  });
});

describe('door pulls follow the hinge side', () => {
  const project = makeProject();

  it('a single door hinged right is pulled on the left', () => {
    const cab = makeCabinet('base', project, { width: 18, doorCount: 1, hingeSide: 'right' });
    expect(doorPullSide(cab, cab.width / 2)).toBe('left');
  });

  it('a single door hinged left is pulled on the right', () => {
    const cab = makeCabinet('base', project, { width: 18, doorCount: 1, hingeSide: 'left' });
    expect(doorPullSide(cab, cab.width / 2)).toBe('right');
  });

  it('flipping the hinge side moves the pull to the other stile', () => {
    const right = makeCabinet('wall', project, { width: 18, doorCount: 1, hingeSide: 'right' });
    const left = { ...right, hingeSide: 'left' as const };
    expect(doorPullSide(right, right.width / 2)).not.toBe(doorPullSide(left, left.width / 2));
  });

  it('an unset hinge side reads as hinged right', () => {
    const cab = makeCabinet('base', project, { width: 18, doorCount: 1 });
    delete (cab as { hingeSide?: unknown }).hingeSide;
    expect(doorPullSide(cab, cab.width / 2)).toBe('left');
  });

  it('a pair still opens from the middle whatever the hinge side says', () => {
    const cab = makeCabinet('base', project, { width: 30, doorCount: 2, hingeSide: 'left' });
    // Left leaf takes its pull on its right edge, right leaf on its left.
    expect(doorPullSide(cab, cab.width * 0.25)).toBe('right');
    expect(doorPullSide(cab, cab.width * 0.75)).toBe('left');
  });
});

describe('run status and gap filling', () => {
  function wallOf(widths: number[], wallLength = 120) {
    const p = makeProject();
    p.room = makeRoom('singleWall', wallLength, 120);
    const wallId = p.room.walls[0].id;
    let along = 0;
    for (const w of widths) {
      p.cabinets.push(makeCabinet('base', p, { width: w, wallId, along }));
      along += w;
    }
    applyWallPlacements(p);
    return { p, wallId };
  }

  it('reports what is left on a wall', () => {
    const { p, wallId } = wallOf([24, 24, 24]);
    const s = runStatus(p, wallId, false);
    expect(s.used).toBe(72);
    expect(s.remaining).toBeCloseTo(48, 6);
    expect(s.full).toBe(false);
  });

  it('knows when a run is finished', () => {
    const { p, wallId } = wallOf([24, 24, 24], 72);
    expect(runStatus(p, wallId, false).full).toBe(true);
  });

  it('a corner cabinet on the adjoining wall eats into this run', () => {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    const [wallA, wallB] = p.room.walls;
    p.cabinets.push(
      makeCabinet('base', p, { width: 36, depth: 24, corner: 'diagonal', wallId: wallA.id, along: 0 }),
    );
    applyWallPlacements(p);

    // The corner runs its full 36" back along the second wall too, so that
    // wall loses 36" of usable length — at whichever end the corner sits.
    const s = runStatus(p, wallB.id, false);
    expect(s.usable).toBeCloseTo(s.wallLength - 36, 4);
    expect(s.startsAt > 0 || s.endsAt < s.wallLength).toBe(true);
  });

  it('a tall pantry on the adjoining wall takes run length too', () => {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    const [wallA, wallB] = p.room.walls;
    // A pantry is 24" deep, so it reaches 24" along the returning wall.
    p.cabinets.push(makeCabinet('tall', p, { width: 24, depth: 24, wallId: wallA.id, along: 0 }));
    applyWallPlacements(p);
    const s = runStatus(p, wallB.id, false);
    expect(s.usable).toBeLessThan(s.wallLength);
    expect(s.blockedBy.length).toBeGreaterThan(0);
  });

  it('a fridge in the corner blocks the adjoining run as well', () => {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    const [, wallB] = p.room.walls;
    const fridge = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'fridge-36')!, 0, 0);
    p.appliances = [fridge];
    const s = runStatus(p, wallB.id, false);
    expect(s.usable).toBeLessThan(s.wallLength);
  });

  it('an appliance standing in the run counts against the space', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { width: 24, wallId, along: 0 }),
      makeCabinet('base', p, { width: 24, wallId, along: 54 }),
    ];
    applyWallPlacements(p);
    // A 30" range parked between the two runs of cabinets.
    p.appliances = [makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 24, 0)];

    const s = runStatus(p, wallId, false);
    expect(s.used).toBeCloseTo(48, 4);
    expect(s.applianceUsed).toBeCloseTo(30, 4);
    // 120 wall less 48 of cabinet and 30 of range.
    expect(s.remaining).toBeCloseTo(42, 4);
  });

  it('an appliance under a cabinet is not counted twice', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 144, 120);
    const wallId = p.room.walls[0].id;
    // A 30" bridge with a 30" microwave hung beneath it: one 30" stretch of
    // wall, not two. Counting both put the run 30" over for no reason.
    p.cabinets = [
      makeCabinet('wall', p, { width: 30, wallId, along: 0, height: 12, mountHeight: 83 }),
    ];
    applyWallPlacements(p);
    const micro = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'micro-otr')!, 0, 0);
    micro.mountHeight = 66;
    p.appliances = [micro];

    const s = runStatus(p, wallId, true);
    expect(s.used).toBeCloseTo(30, 4);
    expect(s.applianceUsed).toBeCloseTo(0, 4);
    expect(s.remaining).toBeCloseTo(114, 4);
  });

  it('still counts the part of an appliance sticking out past a cabinet', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 144, 120);
    const wallId = p.room.walls[0].id;
    // A 24" cabinet over a 30" microwave leaves 6" of it uncovered.
    p.cabinets = [
      makeCabinet('wall', p, { width: 24, wallId, along: 0, height: 12, mountHeight: 83 }),
    ];
    applyWallPlacements(p);
    const micro = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'micro-otr')!, 0, 0);
    micro.mountHeight = 66;
    p.appliances = [micro];

    expect(runStatus(p, wallId, true).applianceUsed).toBeCloseTo(6, 3);
  });

  it('an over-range microwave does not eat into the base run', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [makeCabinet('base', p, { width: 24, wallId, along: 0 })];
    applyWallPlacements(p);
    const micro = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'micro-otr')!, 24, 0);
    p.appliances = [micro];
    // It hangs at 66", well clear of the base band.
    expect(runStatus(p, wallId, false).applianceUsed).toBe(0);
  });

  it('a wall cabinet does not block the base run beneath it', () => {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    const [wallA, wallB] = p.room.walls;
    p.cabinets.push(makeCabinet('wall', p, { width: 24, depth: 12, wallId: wallA.id, along: 0, mountHeight: 54 }));
    applyWallPlacements(p);
    expect(runStatus(p, wallB.id, false).usable).toBeCloseTo(runStatus(p, wallB.id, false).wallLength, 4);
  });

  it('packs cabinets and an appliance as one sequence', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 140, 120);
    const wallId = p.room.walls[0].id;
    const range = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 24, 0);
    // An appliance in a run belongs to that run, like a cabinet does.
    range.wallId = wallId;
    range.along = 24;
    p.appliances = [range];
    p.cabinets = [
      makeCabinet('base', p, { name: 'A', width: 24, wallId, along: 0 }),
      makeCabinet('base', p, { name: 'B', width: 24, wallId, along: 60 }),
    ];
    useProject.setState({ project: p });
    useProject.getState().autoArrange();

    const after = useProject.getState().project;
    expect(after.cabinets[0].along).toBeCloseTo(0, 4);
    expect(after.appliances[0].along).toBeCloseTo(24, 4);
    expect(after.cabinets[1].along).toBeCloseTo(54, 4);
    expect(findCollisions(after.cabinets, after.appliances)).toHaveLength(0);
  });

  it('widening a cabinet pushes the appliance along instead of jumping past it', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 168, 120);
    const wallId = p.room.walls[0].id;
    const range = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 24, 0);
    range.wallId = wallId;
    range.along = 24;
    p.appliances = [range];
    p.cabinets = [
      makeCabinet('base', p, { name: 'A', width: 24, wallId, along: 0 }),
      makeCabinet('base', p, { name: 'B', width: 24, wallId, along: 54 }),
    ];
    applyWallPlacements(p);
    useProject.setState({ project: p });

    // Add 2" to the first cabinet — everything after it shifts by 2".
    useProject.getState().updateCabinet(p.cabinets[0].id, { width: 26 });

    const after = useProject.getState().project;
    expect(after.cabinets[0].along).toBeCloseTo(0, 4);
    expect(after.appliances[0].along).toBeCloseTo(26, 4);
    expect(after.cabinets[1].along).toBeCloseTo(56, 4);
    expect(findCollisions(after.cabinets, after.appliances)).toHaveLength(0);
  });

  it('attaches a loose appliance to its wall when the project is opened', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 168, 120);
    const range = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 24, 0);
    p.appliances = [range];
    const migrated = migrateProject(p);
    expect(migrated.appliances[0].wallId).toBe(p.room.walls[0].id);
    expect(migrated.appliances[0].along).toBeCloseTo(24, 3);
  });

  it('measures the leftover from the end of the run, appliances included', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 168, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { width: 24, wallId, along: 0 }),
      makeCabinet('base', p, { width: 24, wallId, along: 54 }),
    ];
    applyWallPlacements(p);
    const range = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 24, 0);
    range.wallId = wallId;
    range.along = 24;
    p.appliances = [range];

    const s = runStatus(p, wallId, false);
    // 24 + 30 + 24 = 78 of wall used, so the run stops there.
    expect(s.filledTo).toBeCloseTo(78, 4);
    // Deriving the gap from cabinet widths alone gave 168 - 48 = 120.
    expect(s.remaining).toBeCloseTo(90, 4);
  });

  it('stops the run at a fridge standing at the end', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 168, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [makeCabinet('base', p, { width: 24, wallId, along: 0 })];
    applyWallPlacements(p);
    const fridge = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'fridge-36')!, 24, 0);
    fridge.wallId = wallId;
    fridge.along = 24;
    p.appliances = [fridge];

    const s = runStatus(p, wallId, false);
    expect(s.filledTo).toBeCloseTo(60, 4);
    expect(s.remaining).toBeCloseTo(108, 4);
  });

  it('reports no leftover once the run reaches the end of the wall', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 78, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { width: 24, wallId, along: 0 }),
      makeCabinet('base', p, { width: 24, wallId, along: 54 }),
    ];
    applyWallPlacements(p);
    const range = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 24, 0);
    range.wallId = wallId;
    range.along = 24;
    p.appliances = [range];

    expect(runStatus(p, wallId, false).full).toBe(true);
  });

  it('a plain cabinet in the corner blocks the return by its depth', () => {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    const [wallA, wallB] = p.room.walls;
    // Not a corner unit, but a 24"-deep box in the corner still stands in
    // the first 24" of the wall returning off it.
    p.cabinets.push(makeCabinet('base', p, { width: 36, depth: 24, wallId: wallA.id, along: 0 }));
    applyWallPlacements(p);
    const s = runStatus(p, wallB.id, false);
    expect(s.usable).toBeCloseTo(s.wallLength - 24, 4);
  });

  it('leaves the adjoining wall alone when the corner is clear', () => {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    const [wallA, wallB] = p.room.walls;
    // Set well away from the corner, so nothing reaches the other wall.
    p.cabinets.push(makeCabinet('base', p, { width: 36, depth: 24, wallId: wallA.id, along: 60 }));
    applyWallPlacements(p);
    const s = runStatus(p, wallB.id, false);
    expect(s.usable).toBeCloseTo(s.wallLength, 4);
  });

  it('a filler closes the gap exactly', () => {
    const { p, wallId } = wallOf([24, 24, 24]);
    useProject.setState({ project: p });
    useProject.getState().fillRunWithFiller(wallId, false);
    const after = useProject.getState().project;
    const filler = after.cabinets.find((c) => c.type === 'filler')!;
    expect(filler.width).toBeCloseTo(48, 4);
    expect(runStatus(after, wallId, false).full).toBe(true);
  });

  it('sharing the leftover lands the run exactly on the wall', () => {
    // 100" wall over three cabinets divides awkwardly, which is the case
    // where rounding each one separately leaves the run short.
    const { p, wallId } = wallOf([24, 24, 24], 100);
    useProject.setState({ project: p });
    useProject.getState().distributeRun(wallId, false);
    const after = useProject.getState().project;
    const total = after.cabinets.reduce((a, c) => a + c.width, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(runStatus(after, wallId, false).full).toBe(true);
  });

  it('stretching the last cabinet also closes the run', () => {
    const { p, wallId } = wallOf([24, 24, 24], 100);
    useProject.setState({ project: p });
    useProject.getState().stretchLastInRun(wallId, false);
    const after = useProject.getState().project;
    expect(after.cabinets[0].width).toBe(24);
    expect(after.cabinets[2].width).toBeCloseTo(52, 4);
    expect(runStatus(after, wallId, false).full).toBe(true);
  });

  it('a filler is one panel, not a carcass', () => {
    const p = makeProject();
    const filler = makeCabinet('filler', p, { width: 3, height: 34.5 });
    const { parts } = generateCabinetParts(filler, p);
    expect(parts).toHaveLength(1);
    expect(parts[0].category).toBe('filler');
    expect(parts[0].width).toBeCloseTo(3, 6);
    expect(parts.some((x) => x.category === 'side')).toBe(false);
  });

  it('warns about a filler wide enough to look like a mistake', () => {
    const p = makeProject();
    const { warnings } = generateCabinetParts(makeCabinet('filler', p, { width: 12 }), p);
    expect(warnings.some((w) => /read as a mistake/i.test(w))).toBe(true);
  });

  it('does nothing when the run already fits', () => {
    const { p, wallId } = wallOf([24, 24, 24], 72);
    useProject.setState({ project: p });
    useProject.getState().fillRunWithFiller(wallId, false);
    expect(useProject.getState().project.cabinets.some((c) => c.type === 'filler')).toBe(false);
  });
});

describe('selection drives what happens next', () => {
  function twoWalls() {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    const [a, b] = p.room.walls;
    p.cabinets = [
      makeCabinet('base', p, { name: 'A1', width: 24, wallId: a.id, along: 0 }),
      makeCabinet('wall', p, { name: 'Bridge', width: 30, height: 18, wallId: b.id, along: 0, mountHeight: 66 }),
    ];
    applyWallPlacements(p);
    useProject.setState({ project: p, selectedCabinetId: null, selectedApplianceId: null, activeWallId: a.id });
    return { p, wallA: a.id, wallB: b.id };
  }

  it('selecting a cabinet switches the active wall to its own', () => {
    const { wallA, wallB } = twoWalls();
    expect(useProject.getState().activeWallId).toBe(wallA);
    const bridge = useProject.getState().project.cabinets.find((c) => c.name === 'Bridge')!;
    useProject.getState().select(bridge.id);
    expect(useProject.getState().activeWallId).toBe(wallB);
  });

  it('clearing the selection leaves the active wall alone', () => {
    const { wallA } = twoWalls();
    useProject.getState().select(null);
    expect(useProject.getState().activeWallId).toBe(wallA);
  });

  it('an appliance lines up with the selected cabinet, not the base run', () => {
    twoWalls();
    const bridge = useProject.getState().project.cabinets.find((c) => c.name === 'Bridge')!;
    useProject.getState().select(bridge.id);
    useProject.getState().addAppliance('micro-otr');

    const app = useProject.getState().project.appliances[0];
    // 30" bridge, 30" microwave — same bay, hung off its underside.
    expect(app.x).toBeCloseTo(bridge.x, 4);
    expect(app.mountHeight + app.height).toBeCloseTo(bridge.mountHeight!, 4);
  });

  it('a floor-standing unit drops to the floor under a selected wall cabinet', () => {
    twoWalls();
    const bridge = useProject.getState().project.cabinets.find((c) => c.name === 'Bridge')!;
    useProject.getState().select(bridge.id);
    useProject.getState().addAppliance('range-30');

    const app = useProject.getState().project.appliances[0];
    expect(app.mountHeight).toBe(0);
    expect(app.x).toBeCloseTo(bridge.x, 4);
  });

  it('a range goes beside a selected base cabinet, not inside it', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 168, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { name: 'A', width: 24, wallId, along: 0 }),
      makeCabinet('base', p, { name: 'B', width: 24, wallId, along: 24 }),
    ];
    applyWallPlacements(p);
    useProject.setState({ project: p, selectedCabinetId: p.cabinets[1].id });
    useProject.getState().addAppliance('range-30');

    const after = useProject.getState().project;
    const range = after.appliances[0];
    const b = after.cabinets[1];
    // Burying it in the cabinet meant only the overhang counted in the run.
    expect(range.x).toBeCloseTo(b.x + b.width, 4);
    expect(findCollisions(after.cabinets, after.appliances)).toHaveLength(0);

    // And the whole 30" now registers against the wall.
    expect(runStatus(after, wallId, false).applianceUsed).toBeCloseTo(30, 3);
  });

  it('centres a narrow unit in a wider bay', () => {
    const p = makeProject();
    const wallId = p.room.walls[0].id;
    p.cabinets = [makeCabinet('wall', p, { name: 'Wide', width: 36, wallId, along: 0, mountHeight: 66 })];
    applyWallPlacements(p);
    useProject.setState({ project: p, selectedCabinetId: p.cabinets[0].id });
    useProject.getState().addAppliance('micro-otr');
    // A 30" unit in a 36" bay sits 3" in from each side.
    expect(useProject.getState().project.appliances[0].along).toBeCloseTo(3, 4);
  });

  it('falls back to the end of the active run with nothing selected', () => {
    const p = makeProject();
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { width: 24, wallId, along: 0 }),
      makeCabinet('base', p, { width: 24, wallId, along: 24 }),
    ];
    applyWallPlacements(p);
    useProject.setState({ project: p, selectedCabinetId: null, activeWallId: wallId });
    useProject.getState().addAppliance('range-30');

    const after = useProject.getState().project;
    expect(after.appliances[0].wallId).toBe(wallId);
    expect(after.appliances[0].along).toBeCloseTo(48, 4);
    // And it must not land on top of anything.
    expect(findCollisions(after.cabinets, after.appliances)).toHaveLength(0);
  });

  it('an appliance always joins a run, whatever is selected', () => {
    const p = makeProject();
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { name: 'A', width: 24, wallId, along: 0 }),
      makeCabinet('base', p, { name: 'B', width: 24, wallId, along: 24 }),
      makeCabinet('wall', p, { name: 'Upper', width: 24, wallId, along: 0, mountHeight: 54 }),
    ];
    applyWallPlacements(p);

    // Selecting an upper used to leave a floor unit unassigned, so it never
    // packed and simply sat on whatever cabinet happened to be there.
    useProject.setState({ project: p, selectedCabinetId: p.cabinets[2].id, activeWallId: wallId });
    useProject.getState().addAppliance('dw-24');

    const after = useProject.getState().project;
    expect(after.appliances[0].wallId).toBe(wallId);
    expect(findCollisions(after.cabinets, after.appliances)).toHaveLength(0);
  });
});

describe('bridge cabinets', () => {
  it('resizing a wall cabinet holds its installed height and grows upward', () => {
    const p = makeProject();
    p.cabinets = [makeCabinet('wall', p, { width: 30, height: 30, mountHeight: 54 })];
    useProject.setState({ project: p });

    useProject.getState().updateCabinet(p.cabinets[0].id, { height: 42 });
    const after = useProject.getState().project.cabinets[0];
    // Height above the floor is what gets set on site, so it stays put.
    expect(after.mountHeight).toBe(54);
    expect(after.mountHeight! + after.height).toBeCloseTo(96, 4);
  });

  it('shrinking a wall cabinet also holds the installed height', () => {
    const p = makeProject();
    p.cabinets = [makeCabinet('wall', p, { width: 30, height: 30, mountHeight: 54 })];
    useProject.setState({ project: p });
    useProject.getState().updateCabinet(p.cabinets[0].id, { height: 18 });
    expect(useProject.getState().project.cabinets[0].mountHeight).toBe(54);
  });

  it('the mount height is still directly settable', () => {
    const p = makeProject();
    p.cabinets = [makeCabinet('wall', p, { width: 30, height: 30, mountHeight: 54 })];
    useProject.setState({ project: p });
    useProject.getState().updateCabinet(p.cabinets[0].id, { mountHeight: 66 });
    expect(useProject.getState().project.cabinets[0].mountHeight).toBe(66);
  });

  it('works out where a bridge has to hang for a microwave', () => {
    // 36" range + 20" clearance for a listed unit + 17" microwave.
    expect(bridgeBottomForMicrowave(36)).toBe(73);
    expect(bridgeBottomForMicrowave(36, 17, 24)).toBe(77);
  });

  it('the bridge preset is 30" wide and hung for a microwave', () => {
    const p = makeProject();
    const preset = CABINET_PRESETS.find((x) => x.key === 'wall-microwave')!;
    const cab = preset.build(makeCabinet('wall', p), p.defaults);
    expect(cab.width).toBe(30);
    expect(cab.mountHeight).toBe(73);
  });

  it('adding the bridge keeps its deliberate height rather than aligning it', () => {
    const p = makeProject();
    p.cabinets = [makeCabinet('wall', p, { width: 24, height: 30, mountHeight: 54 })];
    useProject.setState({ project: p, activeWallId: p.room.walls[0].id });
    useProject.getState().addCabinet('wall-microwave');

    const bridge = useProject.getState().project.cabinets.find((c) => c.width === 30)!;
    // Aligning it to the existing 84" run would drop it and ruin the
    // clearance the preset exists to provide.
    expect(bridge.mountHeight).toBe(73);
  });

  it('says what the run has to reach when a bridge is too low over a range', () => {
    const p = makeProject();
    p.appliances = [makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 0, 0)];
    // 60" underside over a 36" range is only 24" — short of the 30" a bare
    // cabinet needs, let alone a microwave.
    p.cabinets = [makeCabinet('wall', p, { name: 'Bridge', width: 30, height: 18, x: 0, z: 0, mountHeight: 60 })];
    const warnings = layoutWarnings(p);
    expect(warnings.some((w) => /underside needs to reach 73/.test(w))).toBe(true);
    expect(warnings.some((w) => /top of the run at 91/.test(w))).toBe(true);
  });

  it('accepts a bare cabinet at the full 30" clearance', () => {
    const p = makeProject();
    p.appliances = [makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 0, 0)];
    // Legal without a microwave, so warning here would just be noise.
    p.cabinets = [makeCabinet('wall', p, { width: 30, height: 18, x: 0, z: 0, mountHeight: 66 })];
    expect(layoutWarnings(p)).toHaveLength(0);
  });

  it('stays quiet once the bridge is hung for a microwave', () => {
    const p = makeProject();
    p.appliances = [makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 0, 0)];
    p.cabinets = [makeCabinet('wall', p, { width: 30, height: 12, x: 0, z: 0, mountHeight: 83 })];
    expect(layoutWarnings(p)).toHaveLength(0);
  });
});

describe('stacking a cabinet over an appliance', () => {
  function fridgeOnWall(wallIndex: number) {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    const wall = p.room.walls[wallIndex];
    const fridge = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'fridge-36')!, 0, 0);
    fridge.wallId = wall.id;
    fridge.along = 48;
    p.appliances = [fridge];
    applyWallPlacements(p);
    useProject.setState({ project: p, selectedApplianceId: fridge.id });
    return { p, wall, fridge };
  }

  it('lands on the same wall as the appliance', () => {
    const { wall, fridge } = fridgeOnWall(1);
    useProject.getState().stackCabinetAbove(fridge.id);

    const cab = useProject.getState().project.cabinets.find((c) => c.name.startsWith('Cabinet over'))!;
    // Leaving the wall unset dropped it into the free-standing run, which
    // then packed it at the origin — it looked like it had changed walls.
    expect(cab.wallId).toBe(wall.id);
    expect(cab.along).toBeCloseTo(48, 4);
  });

  it('sits directly over the appliance in world space', () => {
    const { fridge } = fridgeOnWall(1);
    useProject.getState().stackCabinetAbove(fridge.id);

    const after = useProject.getState().project;
    const cab = after.cabinets.find((c) => c.name.startsWith('Cabinet over'))!;
    const f = after.appliances[0];
    expect(cab.x).toBeCloseTo(f.x, 3);
    expect(cab.z).toBeCloseTo(f.z, 3);
    expect(cab.rotation).toBeCloseTo(f.rotation, 3);
    expect(cab.mountHeight).toBeCloseTo(f.mountHeight + f.height, 3);
  });

  it('stays put when the run is re-flowed', () => {
    const { fridge } = fridgeOnWall(1);
    useProject.getState().stackCabinetAbove(fridge.id);
    useProject.getState().autoArrange();

    const after = useProject.getState().project;
    const cab = after.cabinets.find((c) => c.name.startsWith('Cabinet over'))!;
    expect(cab.along).toBeCloseTo(after.appliances[0].along ?? 0, 3);
  });

  it('works the same on the first wall', () => {
    const { wall, fridge } = fridgeOnWall(0);
    useProject.getState().stackCabinetAbove(fridge.id);
    const cab = useProject.getState().project.cabinets.find((c) => c.name.startsWith('Cabinet over'))!;
    expect(cab.wallId).toBe(wall.id);
  });
});

describe('appliance clearances', () => {
  function overRange(microBottom: number) {
    const p = makeProject();
    const range = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 0, 0);
    const micro = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'micro-otr')!, 0, 0);
    micro.mountHeight = microBottom;
    p.appliances = [range, micro];
    return p;
  }

  it('accepts a listed microwave at the usual 20" over a range', () => {
    // 36" range top, microwave at 56" — what manufacturers actually call for.
    expect(layoutWarnings(overRange(56))).toHaveLength(0);
  });

  it('flags a microwave hung too close to the burners', () => {
    // 36" range top, microwave at 50" leaves 14" — under any spec.
    const warnings = layoutWarnings(overRange(50));
    expect(warnings.some((w) => /Listed over-range units want about 20/.test(w))).toBe(true);
  });

  it('flags a bare cabinet straight over a range', () => {
    const p = makeProject();
    p.appliances = [makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 0, 0)];
    p.cabinets = [makeCabinet('wall', p, { name: 'Over range', width: 30, x: 0, z: 0, mountHeight: 54 })];
    expect(layoutWarnings(p).some((w) => /Allow 30/.test(w))).toBe(true);
  });

  it('a hood beneath the cabinet clears the warning', () => {
    const p = makeProject();
    const range = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 0, 0);
    const hood = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'hood-30')!, 0, 0);
    hood.mountHeight = 66;
    p.appliances = [range, hood];
    p.cabinets = [makeCabinet('wall', p, { width: 30, x: 0, z: 0, mountHeight: 90 })];
    expect(layoutWarnings(p).some((w) => /Allow 30/.test(w))).toBe(false);
  });

  it('ignores appliances that are nowhere near each other', () => {
    const p = makeProject();
    const range = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 0, 0);
    const micro = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'micro-otr')!, 120, 0);
    micro.mountHeight = 40;
    p.appliances = [range, micro];
    expect(layoutWarnings(p)).toHaveLength(0);
  });
});

describe('sinks belong to the cabinet', () => {
  const sinkCab = (style: 'undermount' | 'farmhouse', over: Partial<Cabinet> = {}) => {
    const p = makeProject();
    const cab = makeCabinet('base', p, {
      width: 36,
      doorCount: 2,
      sink: { style, width: 30, frontToBack: 19, bowlDepth: 10, apronHeight: 10, faucet: true },
      ...over,
    });
    return { p, cab };
  };

  it('takes no run length, unlike a floor-standing appliance', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, {
        width: 36,
        wallId,
        along: 0,
        sink: { style: 'undermount', width: 30, frontToBack: 18, bowlDepth: 9, apronHeight: 10, faucet: true },
      }),
    ];
    applyWallPlacements(p);
    const s = runStatus(p, wallId, false);
    // The sink is inside the cabinet, so only the cabinet's 36" counts.
    expect(s.used).toBeCloseTo(36, 4);
    expect(s.applianceUsed).toBe(0);
    expect(s.remaining).toBeCloseTo(84, 4);
  });

  it('a farmhouse apron shortens the doors below it', () => {
    const plain = sinkCab('undermount');
    const farm = sinkCab('farmhouse');
    const doorOf = (x: { p: Project; cab: Cabinet }) =>
      computeFaceLayout(x.cab, specFor(x.cab, x.p.defaults), x.p.materials).openings.find(
        (o) => o.kind === 'door',
      )!.frontHeight;
    expect(doorOf(farm)).toBeCloseTo(doorOf(plain) - 10, 4);
  });

  it('builds a ledger to carry the bowl, not a panel across the front', () => {
    const { p, cab } = sinkCab('farmhouse');
    const parts = generateCabinetParts(cab, p).parts;
    // The sink's own apron is the exposed face, so no full-width wood panel.
    expect(parts.some((x) => x.name === 'Sink Apron')).toBe(false);
    expect(parts.find((x) => x.name === 'Sink Support Ledger')?.qty).toBe(2);
  });

  it('fills the face beside the bowl when the cabinet is wider', () => {
    const { p, cab } = sinkCab('farmhouse');
    const filler = generateCabinetParts(cab, p).parts.find((x) => x.name === 'Apron Side Filler')!;
    expect(filler).toBeDefined();
    expect(filler.qty).toBe(2);
    // 36" cabinet, two 23/32" sides, 30" bowl — a shade over 2" each side.
    expect(filler.width).toBeGreaterThan(1.5);
    expect(filler.width).toBeLessThan(3);
  });

  it('an undermount adds no apron parts', () => {
    const { p, cab } = sinkCab('undermount');
    const parts = generateCabinetParts(cab, p).parts;
    expect(parts.some((x) => x.name === 'Apron Side Filler')).toBe(false);
    expect(parts.some((x) => x.name === 'Sink Support Ledger')).toBe(false);
  });

  it('doors sit below the apron, not at the cabinet top', () => {
    const { p, cab } = sinkCab('farmhouse');
    const boxes = buildCabinetGeometry(cab, p, { showDoors: true });
    const door = boxes.find((b) => b.role === 'door')!;
    const doorTop = door.pos[1] + door.size[1] / 2;
    const doorBottom = door.pos[1] - door.size[1] / 2;

    // Top of the door clears the apron...
    expect(doorTop).toBeLessThanOrEqual(cab.height - cab.sink!.apronHeight + 0.01);
    // ...and the bottom still reaches the toe kick, leaving no void.
    expect(doorBottom).toBeLessThan(p.defaults.toeKickHeight + 0.5);
  });

  it('warns when the bowl is wider than the cabinet', () => {
    const { p, cab } = sinkCab('undermount', { width: 24 });
    const { warnings } = generateCabinetParts(cab, p);
    expect(warnings.some((w) => /wider than/i.test(w))).toBe(true);
  });

  it('cuts a hole in the counter and builds a basin', () => {
    const { cab } = sinkCab('undermount');
    const g = buildSinkGeometry(cab, cab.height + 1.5);
    expect(g.cutout).not.toBeNull();
    expect(g.boxes.length).toBeGreaterThan(3);
    expect(g.faucet).not.toBeNull();
  });

  it('the apron meets the doors with no gap between them', () => {
    const { p, cab } = sinkCab('farmhouse');
    const boxes = buildCabinetGeometry(cab, p, { showDoors: true });
    const door = boxes.find((b) => b.role === 'door')!;
    const doorTop = door.pos[1] + door.size[1] / 2;

    const sink = buildSinkGeometry(cab, cab.height + 1.5);
    // The bowl's front face is the exposed apron; its underside has to land
    // on the same line the doors stop at, or there is a strip of nothing.
    const front = sink.boxes.reduce((lowest, b) =>
      b.pos[2] > lowest.pos[2] ? b : lowest,
    );
    const apronBottom = front.pos[1] - front.size[1] / 2;

    expect(apronBottom).toBeCloseTo(cab.height - cab.sink!.apronHeight, 3);
    expect(Math.abs(apronBottom - doorTop)).toBeLessThan(0.2);
  });

  it('drops the false front when a sink base becomes a farmhouse', () => {
    const p = makeProject();
    // Exactly what the sink base preset gives you.
    p.cabinets = [
      makeCabinet('base', p, {
        width: 36,
        doorCount: 2,
        drawers: [{ id: 'ff', frontHeight: 6, falseFront: true }],
        sink: { style: 'undermount', width: 30, frontToBack: 18, bowlDepth: 9, apronHeight: 10, faucet: true },
      }),
    ];
    useProject.setState({ project: p });

    useProject.getState().updateCabinet(p.cabinets[0].id, {
      sink: { style: 'farmhouse', width: 30, frontToBack: 19, bowlDepth: 10, apronHeight: 10, faucet: true },
    });

    const after = useProject.getState().project.cabinets[0];
    // The apron takes that part of the face, so the dummy drawer has to go.
    expect(after.drawers).toHaveLength(0);
    expect(after.doorCount).toBe(2);
  });

  it('an older project with both loses the false front on open', () => {
    const p = makeProject();
    p.cabinets = [
      makeCabinet('base', p, {
        width: 36,
        doorCount: 2,
        drawers: [{ id: 'ff', frontHeight: 6, falseFront: true }],
        sink: { style: 'farmhouse', width: 30, frontToBack: 19, bowlDepth: 10, apronHeight: 10, faucet: true },
      }),
    ];
    expect(migrateProject(p).cabinets[0].drawers).toHaveLength(0);
  });

  it('leaves a real drawer alone on a non-farmhouse sink', () => {
    const p = makeProject();
    p.cabinets = [
      makeCabinet('base', p, {
        width: 36,
        doorCount: 2,
        drawers: [{ id: 'ff', frontHeight: 6, falseFront: true }],
        sink: { style: 'undermount', width: 30, frontToBack: 18, bowlDepth: 9, apronHeight: 10, faucet: true },
      }),
    ];
    expect(migrateProject(p).cabinets[0].drawers).toHaveLength(1);
  });

  it('keeps two doors under a farmhouse sink', () => {
    const { p, cab } = sinkCab('farmhouse');
    const doors = generateCabinetParts(cab, p).parts.filter((x) => x.category === 'door');
    expect(doors).toHaveLength(1);
    expect(doors[0].qty).toBe(2);
  });

  it('a farmhouse bowl reaches the cabinet face', () => {
    const { cab } = sinkCab('farmhouse');
    const g = buildSinkGeometry(cab, cab.height + 1.5);
    expect(g.cutout!.z1).toBeCloseTo(cab.depth, 4);
    expect(g.apron).not.toBeNull();
  });

  it('no sink means no basin and no cutout', () => {
    const p = makeProject();
    const cab = makeCabinet('base', p, { width: 36 });
    const g = buildSinkGeometry(cab, cab.height + 1.5);
    expect(g.cutout).toBeNull();
    expect(g.boxes).toHaveLength(0);
  });

  it('an old project with a sink appliance moves it into the cabinet', () => {
    const p = makeProject();
    p.cabinets = [makeCabinet('base', p, { width: 36, x: 0, z: 0 })];
    p.appliances = [
      {
        id: 's1',
        name: 'Farmhouse Sink 33"',
        kind: 'sink',
        width: 33,
        height: 10,
        depth: 21,
        x: 0,
        z: 0,
        rotation: 0,
        mountHeight: 25,
      },
    ];
    const migrated = migrateProject(p);
    expect(migrated.appliances.some((a) => a.kind === 'sink')).toBe(false);
    expect(migrated.cabinets[0].sink?.style).toBe('farmhouse');
  });
});

describe('toe kick finish', () => {
  const kickOf = (p: Project) => {
    const cab = makeCabinet('base', p, { width: 24 });
    return generateCabinetParts(cab, p).parts.find((x) => x.category === 'toeKick')!;
  };

  it('cuts from the carcass sheet by default', () => {
    const p = makeProject();
    p.defaults.toeKickFinish = 'box';
    expect(kickOf(p).materialId).toBe(p.defaultBoxMaterialId);
  });

  it('cuts from the door material when it has to match the fronts', () => {
    const p = makeProject();
    p.defaults.toeKickFinish = 'face';
    const kick = kickOf(p);
    expect(kick.materialId).toBe(p.defaultFaceMaterialId);
    expect(kick.notes).toMatch(/Matches the door material/);
  });

  it('a painted kick still comes off the carcass sheet', () => {
    const p = makeProject();
    p.defaults.toeKickFinish = 'painted';
    const kick = kickOf(p);
    expect(kick.materialId).toBe(p.defaultBoxMaterialId);
    expect(kick.notes).toMatch(/Painted out/);
  });

  it('matching the doors changes what the job costs', () => {
    const withBox = makeProject();
    withBox.defaults.toeKickFinish = 'box';
    const withFace = makeProject();
    withFace.defaults.toeKickFinish = 'face';
    for (const p of [withBox, withFace]) {
      for (let i = 0; i < 6; i++) p.cabinets.push(makeCabinet('base', p, { width: 24, x: i * 24 }));
    }
    // Solid maple fronts cost more per foot than prefinished ply.
    expect(computeEstimate(withFace).totalCost).toBeGreaterThan(computeEstimate(withBox).totalCost);
  });

  it('renders the kick in whatever it is actually made of', () => {
    const p = makeProject();
    p.defaults.toeKickFinish = 'painted';
    p.defaults.toeKickPaintColor = '#123456';
    const cab = makeCabinet('base', p, { width: 24 });
    const kick = buildCabinetGeometry(cab, p).find((b) => b.role === 'kick')!;
    expect(kick.color).toBe('#123456');
  });
});

describe('wall slab placement', () => {
  /**
   * Mirrors what the Walls mesh does: the slab is pushed back along the
   * wall's own outward normal so its inner face lands on the wall line.
   * Offsetting in world Z instead — the bug — slid the side walls sideways
   * and opened a gap at every corner.
   */
  const innerFace = (w: ReturnType<typeof makeRoom>['walls'][0], centre: { x: number; z: number }) => {
    const f = wallFrame(w, centre);
    const half = w.thickness / 2;
    const cx = (w.x1 + w.x2) / 2 - f.nx * half;
    const cz = (w.z1 + w.z2) / 2 - f.nz * half;
    // Step back toward the room by half the thickness to reach the inner face.
    return { x: cx + f.nx * half, z: cz + f.nz * half };
  };

  it('lands every wall face on its own line, whatever the orientation', () => {
    const room = makeRoom('uShape', 144, 120);
    const centre = roomCentre(room);
    for (const w of room.walls) {
      const face = innerFace(w, centre);
      const mid = { x: (w.x1 + w.x2) / 2, z: (w.z1 + w.z2) / 2 };
      expect(Math.hypot(face.x - mid.x, face.z - mid.z)).toBeCloseTo(0, 6);
    }
  });

  it('sets a cabinet back against the wall it is placed on', () => {
    const project = makeProject();
    project.room = makeRoom('uShape', 144, 120);
    project.cabinets = project.room.walls.map((w) =>
      makeCabinet('base', project, { width: 24, depth: 24, wallId: w.id, along: 6 }),
    );
    applyWallPlacements(project);

    const centre = roomCentre(project.room);
    for (const cab of project.cabinets) {
      const wall = project.room.walls.find((w) => w.id === cab.wallId)!;
      const f = wallFrame(wall, centre);
      // The cabinet origin is its back-left corner, so its offset from the
      // wall line along the inward normal must be zero.
      const { offset } = projectOntoWall(f, cab.x, cab.z);
      expect(offset).toBeCloseTo(0, 6);
    }
  });
});

describe('collision detection', () => {
  const project = makeProject();

  it('ignores a wall cabinet hanging over a base run', () => {
    const base = makeCabinet('base', project, { width: 24, x: 0, mountHeight: 0 });
    const wall = makeCabinet('wall', project, { width: 24, x: 0, mountHeight: 54 });
    expect(findCollisions([base, wall])).toHaveLength(0);
  });

  it('catches an appliance buried in a cabinet', () => {
    const base = makeCabinet('base', project, { name: 'Base', width: 24, x: 0 });
    const range = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 12, 0);
    expect(findCollisions([base], [range])).toHaveLength(1);
  });

  it('lets an appliance sit beside a cabinet', () => {
    const base = makeCabinet('base', project, { width: 24, x: 0 });
    const range = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'range-30')!, 24, 0);
    expect(findCollisions([base], [range])).toHaveLength(0);
  });

  it('lets a cabinet stack directly on top of an appliance', () => {
    const micro = makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'micro-otr')!, 0, 0);
    const above = makeCabinet('wall', project, {
      width: micro.width,
      height: 84 - (micro.mountHeight + micro.height),
      x: 0,
      mountHeight: micro.mountHeight + micro.height,
    });
    expect(findCollisions([above], [micro])).toHaveLength(0);
  });
});

describe('crown and trim', () => {
  function withWallRun() {
    const p = makeProject();
    p.crown = { ...p.crown, enabled: true, millInShop: false, costPerLinearFoot: 6 };
    for (let i = 0; i < 3; i++) {
      p.cabinets.push(makeCabinet('wall', p, { name: `W${i}`, width: 24, x: i * 24, doorCount: 2 }));
    }
    return p;
  }

  it('adds no crown until it is switched on', () => {
    const p = withWallRun();
    p.crown.enabled = false;
    const { parts } = generateProjectParts(p);
    expect(parts.some((x) => x.category === 'crown')).toBe(false);
  });

  it('runs crown across wall cabinets when enabled', () => {
    const { parts } = generateProjectParts(withWallRun());
    expect(parts.filter((x) => x.category === 'crown')).toHaveLength(3);
  });

  it('returns crown around exposed ends but not buried ones', () => {
    const p = withWallRun();
    const cabs = p.cabinets;
    // The middle cabinet is buried on both ends, so it gets only its front.
    const middle = crownRunLength(cabs[1], cabs);
    const end = crownRunLength(cabs[0], cabs);
    expect(middle).toBeCloseTo(24, 6);
    expect(end).toBeCloseTo(24 + cabs[0].depth, 6);
  });

  it('prices bought-in crown by the foot without consuming sheets', () => {
    const est = computeEstimate(withWallRun());
    expect(est.trimLines.length).toBeGreaterThan(0);
    expect(est.trimLines[0].amount).toBeGreaterThan(0);
    // Bought-in trim must never appear as a nested sheet or board foot.
    expect(est.takeoff.sheetResults.some((r) => r.materialId === BOUGHT_IN)).toBe(false);
    expect(est.takeoff.lumberPlans.some((r) => r.materialId === BOUGHT_IN)).toBe(false);
  });

  it('milled crown consumes board feet instead', () => {
    const p = withWallRun();
    p.crown.millInShop = true;
    p.crown.materialId = 'lbr-hardmaple-44';
    const est = computeEstimate(p);
    expect(est.trimLines).toHaveLength(0);
    expect(est.takeoff.lumberPlans.some((l) => l.materialId === 'lbr-hardmaple-44')).toBe(true);
  });

  it('crown raises the client total', () => {
    const without = withWallRun();
    without.crown.enabled = false;
    const base = computeEstimate(without).clientTotal;
    expect(computeEstimate(withWallRun()).clientTotal).toBeGreaterThan(base);
  });
});

describe('oven cabinets', () => {
  const ovenCab = (over: Partial<Cabinet> = {}) => {
    const p = makeProject();
    const cab = makeCabinet('tall', p, {
      width: 30,
      height: 84,
      doorCount: 2,
      drawers: [{ id: 'd1', frontHeight: 12 }, { id: 'd2', frontHeight: 12 }],
      oven: { count: 1, width: 28.5, openingHeight: 28.5, bottomHeight: 30, showAppliance: true },
      ...over,
    });
    return { p, cab };
  };

  it('puts drawers below the opening and doors above it', () => {
    const { p, cab } = ovenCab();
    const layout = computeFaceLayout(cab, specFor(cab, p.defaults), p.materials);
    const drawers = layout.openings.filter((o) => o.kind === 'drawer');
    const door = layout.openings.find((o) => o.kind === 'door')!;

    // Opening runs 30" to 58.5"; nothing may cross it.
    for (const d of drawers) expect(d.topAt!).toBeLessThanOrEqual(30);
    expect(door.topAt! - door.frontHeight).toBeGreaterThanOrEqual(58.5 - 0.01);
  });

  it('sizes the door above from whatever the opening leaves', () => {
    const { p, cab } = ovenCab();
    const spec = specFor(cab, p.defaults);
    const door = computeFaceLayout(cab, spec, p.materials).openings.find((o) => o.kind === 'door')!;
    // 84 - (30 + 28.5) = 25.5, less a reveal top and bottom.
    expect(door.frontHeight).toBeCloseTo(25.5 - 2 * spec.revealEdge, 4);
  });

  it('moving the opening resizes the fronts on both sides', () => {
    const { p, cab } = ovenCab();
    const spec = specFor(cab, p.defaults);
    const before = computeFaceLayout(cab, spec, p.materials).openings.find((o) => o.kind === 'door')!.frontHeight;

    const raised = { ...cab, oven: { ...cab.oven!, bottomHeight: 36 } };
    const after = computeFaceLayout(raised, spec, p.materials);
    const door = after.openings.find((o) => o.kind === 'door')!;
    const drawer = after.openings.filter((o) => o.kind === 'drawer')[0];

    // Raising the oven shortens the door and lengthens the drawers.
    expect(door.frontHeight).toBeCloseTo(before - 6, 3);
    expect(drawer.frontHeight).toBeGreaterThan(12);
  });

  it('a double stack leaves a shorter door above', () => {
    const { p, cab } = ovenCab({
      drawers: [{ id: 'd1', frontHeight: 18 }],
      oven: { count: 2, width: 28.5, openingHeight: 50, bottomHeight: 24, showAppliance: true },
    });
    const door = computeFaceLayout(cab, specFor(cab, p.defaults), p.materials).openings.find(
      (o) => o.kind === 'door',
    )!;
    // 84 - (24 + 50) = 10.
    expect(door.frontHeight).toBeCloseTo(10 - 2 * p.defaults.revealEdge, 3);
  });

  it('builds a deck, bearers and a header to carry the oven', () => {
    const { p, cab } = ovenCab();
    const parts = generateCabinetParts(cab, p).parts;
    expect(parts.some((x) => x.name === 'Oven Deck')).toBe(true);
    expect(parts.find((x) => x.name === 'Oven Bearer')?.qty).toBe(2);
    expect(parts.some((x) => x.name === 'Oven Header')).toBe(true);
  });

  it('shows the pocket, and the appliance when asked', () => {
    const { p, cab } = ovenCab({ oven: { count: 1, width: 28.5, openingHeight: 28.5, bottomHeight: 30, showAppliance: false } });
    const empty = buildCabinetGeometry(cab, p);
    expect(empty.some((b) => b.label === 'Oven deck')).toBe(true);
    expect(empty.some((b) => b.label === 'Wall oven')).toBe(false);

    const { p: p2, cab: withOven } = ovenCab();
    const filled = buildCabinetGeometry(withOven, p2);
    expect(filled.filter((b) => b.label === 'Wall oven')).toHaveLength(1);
  });

  it('draws two appliance bodies for a double stack', () => {
    const { p, cab } = ovenCab({
      oven: { count: 2, width: 28.5, openingHeight: 50, bottomHeight: 24, showAppliance: true },
    });
    expect(buildCabinetGeometry(cab, p).filter((b) => b.label === 'Wall oven')).toHaveLength(2);
  });

  it('warns when the opening runs past the top of the cabinet', () => {
    const { p, cab } = ovenCab({
      oven: { count: 2, width: 28.5, openingHeight: 60, bottomHeight: 40, showAppliance: true },
    });
    expect(generateCabinetParts(cab, p).warnings.some((w) => /past the top/.test(w))).toBe(true);
  });

  it('warns when the opening is wider than the cabinet', () => {
    const { p, cab } = ovenCab({ width: 24 });
    expect(generateCabinetParts(cab, p).warnings.some((w) => /will not fit between the sides/.test(w))).toBe(true);
  });

  it('both oven presets build cleanly', () => {
    for (const key of ['tall-oven', 'tall-oven-double']) {
      const preset = CABINET_PRESETS.find((x) => x.key === key)!;
      const proj = makeProject();
      const cab = preset.build(makeCabinet(preset.type, proj), proj.defaults);
      const { warnings } = generateCabinetParts(cab, proj);
      expect(warnings, `${key}: ${warnings.join(' | ')}`).toHaveLength(0);
    }
  });
});

describe('hiding walls', () => {
  function lRoom() {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    const [a, b] = p.room.walls;
    p.cabinets = [
      makeCabinet('base', p, { name: 'Corner', width: 36, depth: 24, corner: 'diagonal', wallId: a.id, along: 0 }),
      makeCabinet('base', p, { name: 'OnA', width: 24, wallId: a.id, along: 36 }),
      makeCabinet('base', p, { name: 'OnB', width: 24, wallId: b.id, along: 60 }),
    ];
    applyWallPlacements(p);
    return { p, a, b };
  }

  const byName = (p: Project, n: string) => p.cabinets.find((c) => c.name === n)!;

  it('a corner cabinet stands on both walls', () => {
    const { p, a, b } = lRoom();
    const walls = wallsTouchedBy(byName(p, 'Corner'), p.room);
    expect(walls).toContain(a.id);
    expect(walls).toContain(b.id);
  });

  it('hiding a wall hides what stands on it', () => {
    const { p, a } = lRoom();
    a.hidden = true;
    expect(isVisibleWithWalls(byName(p, 'OnA'), p.room)).toBe(false);
    expect(isVisibleWithWalls(byName(p, 'OnB'), p.room)).toBe(true);
  });

  it('a plain cabinet at the corner still hides with its own wall', () => {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    const [a] = p.room.walls;
    // Sits right in the corner, so its end grazes the returning wall — but
    // it is not standing on it, and must not survive its own wall hiding.
    p.cabinets = [makeCabinet('base', p, { name: 'Corner-ish', width: 24, depth: 24, wallId: a.id, along: 0 })];
    applyWallPlacements(p);

    expect(wallsTouchedBy(p.cabinets[0], p.room)).toEqual([a.id]);
    a.hidden = true;
    expect(isVisibleWithWalls(p.cabinets[0], p.room)).toBe(false);
  });

  it('a corner cabinet survives until both its walls are hidden', () => {
    const { p, a, b } = lRoom();
    const corner = byName(p, 'Corner');

    a.hidden = true;
    expect(isVisibleWithWalls(corner, p.room)).toBe(true);

    b.hidden = true;
    expect(isVisibleWithWalls(corner, p.room)).toBe(false);
  });

  it('hiding the other wall first works the same way', () => {
    const { p, a, b } = lRoom();
    const corner = byName(p, 'Corner');
    b.hidden = true;
    expect(isVisibleWithWalls(corner, p.room)).toBe(true);
    a.hidden = true;
    expect(isVisibleWithWalls(corner, p.room)).toBe(false);
  });

  it('an appliance follows the wall it stands against', () => {
    const { p, a } = lRoom();
    const range = makeAppliance(APPLIANCE_PRESETS.find((x) => x.key === 'range-30')!, 60, 0);
    range.wallId = a.id;
    range.along = 60;
    applyWallPlacements(p);
    expect(isVisibleWithWalls(range, p.room)).toBe(true);
    a.hidden = true;
    expect(isVisibleWithWalls(range, p.room)).toBe(false);
  });

  it('a free-standing island is never hidden by a wall', () => {
    const { p } = lRoom();
    for (const w of p.room.walls) w.hidden = true;
    const island = makeCabinet('base', p, { width: 36, x: 70, z: 70 });
    expect(isVisibleWithWalls(island, p.room)).toBe(true);
  });

  it('hiding walls changes nothing in the estimate', () => {
    const { p, a, b } = lRoom();
    const before = computeEstimate(p).clientTotal;
    a.hidden = true;
    b.hidden = true;
    // Visibility is presentation only — `excluded` is what removes cost.
    expect(computeEstimate(p).clientTotal).toBeCloseTo(before, 6);
  });
});

describe('face frame overhang — tolerance comes out of the box, not the frame', () => {
  /**
   * A cabinet in the middle of a run, which is the buried-both-sides case.
   * A cabinet standing on its own is exposed at both ends and correctly takes
   * no overhang at all, so testing one in isolation would prove nothing.
   */
  function framed(overhang: number, cab: Partial<Cabinet> = {}) {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame', frameOverhang: overhang };
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    const c = makeCabinet('base', p, { width: 24, doorCount: 2, wallId, along: 24, ...cab });
    p.cabinets = [
      makeCabinet('base', p, { width: 24, doorCount: 2, wallId, along: 0 }),
      c,
      makeCabinet('base', p, { width: 24, doorCount: 2, wallId, along: 24 + (cab.width ?? 24) }),
    ];
    applyWallPlacements(p);
    return { p, cab: c, spec: specFor(c, p.defaults) };
  }

  it('defaults to 1/4" a side, so a run has half an inch of give', () => {
    expect(makeProject().defaults.frameOverhang).toBe(0.25);
  });

  it('the frame stays the nominal width and the box shrinks behind it', () => {
    const { cab, spec, p } = framed(0.25);
    // This is the whole point: a 24" cabinet still measures 24" on the wall.
    expect(frontalWidth(cab)).toBeCloseTo(24, 6);
    expect(boxWidth(cab, spec, p)).toBeCloseTo(23.5, 6);
  });

  it('the run measurement does not move', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame', frameOverhang: 0.25 };
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [0, 24, 48].map((along) =>
      makeCabinet('base', p, { width: 24, wallId, along, doorCount: 2 }),
    );
    applyWallPlacements(p);
    // Three 24" cabinets still fill 72" of wall, whatever the boxes measure.
    expect(runStatus(p, wallId, false).used).toBeCloseTo(72, 6);
  });

  it('rails and doors are unchanged — they come off the frame', () => {
    const railOf = (x: ReturnType<typeof framed>) =>
      generateCabinetParts(x.cab, x.p).parts.find((r) => r.category === 'faceFrameRail')!.length;
    const doorOf = (x: ReturnType<typeof framed>) =>
      computeFaceLayout(x.cab, x.spec, x.p.materials).openings.find((o) => o.kind === 'door')!
        .frontWidth;
    expect(railOf(framed(0.25))).toBeCloseTo(railOf(framed(0)), 6);
    expect(doorOf(framed(0.25))).toBeCloseTo(doorOf(framed(0)), 6);
  });

  it('the carcass parts are cut narrower', () => {
    const deckOf = (x: ReturnType<typeof framed>) =>
      generateCabinetParts(x.cab, x.p).parts.find((r) => r.category === 'bottom')!.length;
    expect(deckOf(framed(0)) - deckOf(framed(0.25))).toBeCloseTo(0.5, 3);
  });

  it('a finished end takes no overhang on that side', () => {
    const { cab, spec, p } = framed(0.25, { finishedLeft: true });
    const oh = frameOverhangs(cab, spec, p);
    expect(oh.left).toBe(0);
    expect(oh.right).toBeCloseTo(0.25, 6);
    expect(boxWidth(cab, spec, p)).toBeCloseTo(23.75, 6);
  });

  it('a corner cabinet is built exact — it is pinned by two walls', () => {
    const { cab, spec, p } = framed(0.25, { corner: 'diagonal', width: 33 });
    expect(frameOverhangs(cab, spec, p)).toEqual({ left: 0, right: 0 });
    expect(boxWidth(cab, spec, p)).toBeCloseTo(33, 6);
  });

  it('the ends of a run take no overhang on their open side', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame', frameOverhang: 0.25 };
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [0, 24, 48].map((along) =>
      makeCabinet('base', p, { width: 24, wallId, along, doorCount: 2 }),
    );
    applyWallPlacements(p);
    const spec = specFor(p.cabinets[0], p.defaults);

    const [first, middle, last] = p.cabinets;
    expect(frameOverhangs(first, spec, p)).toEqual({ left: 0, right: 0.25 });
    expect(frameOverhangs(middle, spec, p)).toEqual({ left: 0.25, right: 0.25 });
    expect(frameOverhangs(last, spec, p)).toEqual({ left: 0.25, right: 0 });
  });

  it('a shallower neighbour leaves the side on show, so no overhang', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'faceFrame', frameOverhang: 0.25 };
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { width: 24, depth: 24, wallId, along: 0, doorCount: 2 }),
      makeCabinet('base', p, { width: 24, depth: 15, wallId, along: 24, doorCount: 2 }),
    ];
    applyWallPlacements(p);
    const spec = specFor(p.cabinets[0], p.defaults);
    // The deep one's right side stands proud of its shallow neighbour.
    expect(frameOverhangs(p.cabinets[0], spec, p).right).toBe(0);
    // The shallow one is fully covered on its left, so it keeps the overhang.
    expect(frameOverhangs(p.cabinets[1], spec, p).left).toBeCloseTo(0.25, 6);
  });

  it('frameless ignores it entirely — there is no frame to stand proud', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, construction: 'frameless', frameOverhang: 0.25 };
    const cab = makeCabinet('base', p, { width: 24, doorCount: 2 });
    expect(boxWidth(cab, specFor(cab, p.defaults), p)).toBeCloseTo(24, 6);
  });

  it('the drawing sets the box in but leaves the frame full width', () => {
    const { cab, p } = framed(0.5);
    const boxes = buildCabinetGeometry(cab, p);
    const edge = (role: string) =>
      Math.min(...boxes.filter((b) => b.role === role).map((b) => b.pos[0] - b.size[0] / 2));
    expect(edge('frame')).toBeCloseTo(0, 3);
    expect(edge('box')).toBeCloseTo(0.5, 3);
  });

  it('a cabinet can override the project setting', () => {
    const { cab, spec, p } = framed(0.25, { frameOverhang: 0 });
    expect(boxWidth(cab, spec, p)).toBeCloseTo(24, 6);
  });
});

describe('carcass joinery and groove setout', () => {
  function boxed(joinery: 'butt' | 'dado', cab: Partial<Cabinet> = {}) {
    const p = makeProject();
    p.defaults = { ...p.defaults, carcassJoinery: joinery, carcassDadoDepth: 0.25 };
    const c = makeCabinet('base', p, { width: 24, height: 34.5, shelfCount: 1, ...cab });
    return { p, cab: c, spec: specFor(c, p.defaults) };
  }
  const partNamed = (x: ReturnType<typeof boxed>, category: string) =>
    generateCabinetParts(x.cab, x.p).parts.find((r) => r.category === category)!;

  it('defaults to butt jointed, which is what it always cut', () => {
    expect(makeProject().defaults.carcassJoinery).toBe('butt');
  });

  it('a dado lengthens the deck by the groove depth at each end', () => {
    const butt = partNamed(boxed('butt'), 'bottom').length;
    const dado = partNamed(boxed('dado'), 'bottom').length;
    // Cutting these to the interior width is how a box finishes 1/2" narrow.
    expect(dado - butt).toBeCloseTo(0.5, 3);
  });

  it('a fixed shelf is housed but an adjustable one is not', () => {
    const fixed = partNamed(boxed('dado', { adjustableShelves: false }), 'shelf').length;
    const adjustable = partNamed(boxed('dado', { adjustableShelves: true }), 'shelf').length;
    expect(fixed).toBeGreaterThan(adjustable);
  });

  it('a butt-jointed box has no setout to cut', () => {
    const x = boxed('butt');
    expect(grooveSetout(x.cab, x.spec, x.p.materials)).toEqual([]);
  });

  it('setout is measured from the bottom edge of the side', () => {
    const x = boxed('dado', { shelfCount: 1, adjustableShelves: false });
    const grooves = grooveSetout(x.cab, x.spec, x.p.materials);
    const deck = grooves.find((g) => g.label === 'Deck')!;
    // The deck lands on top of the toe notch, so its groove starts at the kick.
    expect(deck.fromBottom).toBeCloseTo(x.spec.toeKickHeight, 6);
    expect(grooves.some((g) => g.label === 'Shelf 1')).toBe(true);
  });

  it('a stretcher top is screwed on, so it gets no groove', () => {
    const x = boxed('dado', { shelfCount: 0 });
    x.spec.baseTopStyle = 'stretchers';
    expect(grooveSetout(x.cab, x.spec, x.p.materials).some((g) => g.label === 'Top')).toBe(false);
  });

  it('adjustable shelves ride on pins, so they add no grooves', () => {
    const x = boxed('dado', { shelfCount: 3, adjustableShelves: true });
    const grooves = grooveSetout(x.cab, x.spec, x.p.materials);
    expect(grooves.filter((g) => g.label.startsWith('Shelf'))).toHaveLength(0);
  });

  it('the setout lands on the side part, where it gets cut', () => {
    const side = partNamed(boxed('dado', { adjustableShelves: false }), 'side');
    expect(side.notes).toMatch(/Dados .* from bottom edge: Deck/);
  });

  it('groove depths are settings, not baked in', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, drawerBottomGroove: 0.5 };
    const cab = makeCabinet('base', p, {
      width: 24,
      doorCount: 0,
      drawers: [{ id: 'd1', frontHeight: 8 }],
    });
    const deep = generateCabinetParts(cab, p).parts.find((r) => r.category === 'drawerBottom')!;

    const shallow = makeProject();
    const cab2 = makeCabinet('base', shallow, {
      width: 24,
      doorCount: 0,
      drawers: [{ id: 'd1', frontHeight: 8 }],
    });
    const base = generateCabinetParts(cab2, shallow).parts.find((r) => r.category === 'drawerBottom')!;
    expect(deep.length - base.length).toBeCloseTo(0.5, 3);
  });

  it('the panel groove and float are settings too', () => {
    const p = makeProject();
    p.defaults = { ...p.defaults, panelGroove: 0.5, panelFloat: 0 };
    const wide = panelPieces('shaker', 30, 30, p.defaults);
    const std = panelPieces('shaker', 30, 30, makeProject().defaults);
    const rail = (rows: typeof wide) => rows.find((r) => r.name === 'Panel Rail')!.length;
    // 1/8" deeper groove at each end is a 1/4" longer rail.
    expect(rail(wide) - rail(std)).toBeCloseTo(0.25, 4);
  });
});

describe('drawer bottoms are a material choice', () => {
  function bottomOf(p: Project, cab: Cabinet) {
    return generateCabinetParts(cab, p).parts.find((x) => x.category === 'drawerBottom')!;
  }

  const withDrawer = (p: Project, extra: Partial<Cabinet> = {}) =>
    makeCabinet('base', p, {
      width: 24,
      doorCount: 0,
      drawers: [{ id: 'd1', frontHeight: 8 }],
      ...extra,
    });

  it('defaults to 1/4" Baltic Birch, which is what it always built', () => {
    const p = makeProject();
    expect(p.defaultDrawerBottomMaterialId).toBe('bb-14');
    expect(bottomOf(p, withDrawer(p)).materialId).toBe('bb-14');
  });

  it('follows the project default', () => {
    const p = makeProject();
    p.defaultDrawerBottomMaterialId = 'bb-12';
    // A cabinet built before the change still carries the old id, so read the
    // default through a freshly made one.
    expect(bottomOf(p, withDrawer(p)).materialId).toBe('bb-12');
  });

  it('a per-cabinet override wins', () => {
    const p = makeProject();
    const cab = withDrawer(p, { drawerBottomMaterialId: 'bb-12' });
    expect(bottomOf(p, cab).materialId).toBe('bb-12');
  });

  it('a thicker bottom does not change the panel size', () => {
    const p = makeProject();
    const quarter = bottomOf(p, withDrawer(p, { drawerBottomMaterialId: 'bb-14' }));
    const half = bottomOf(p, withDrawer(p, { drawerBottomMaterialId: 'bb-12' }));
    // The groove depth sizes the panel, not its thickness.
    expect(half.length).toBeCloseTo(quarter.length, 6);
    expect(half.width).toBeCloseTo(quarter.width, 6);
    expect(half.thickness).toBeGreaterThan(quarter.thickness);
  });

  it('the cut note states the thickness it is actually cut in', () => {
    const p = makeProject();
    // Nominal, not the 15/32" actual — that is how a shop reads a cut list.
    expect(bottomOf(p, withDrawer(p, { drawerBottomMaterialId: 'bb-12' })).notes).toMatch(/^1\/2" panel/);
    expect(bottomOf(p, withDrawer(p, { drawerBottomMaterialId: 'bb-14' })).notes).toMatch(/^1\/4" panel/);
  });

  it('an older project keeps building 1/4" bottoms', () => {
    const p = makeProject();
    delete (p as { defaultDrawerBottomMaterialId?: string }).defaultDrawerBottomMaterialId;
    expect(migrateProject(p).defaultDrawerBottomMaterialId).toBe('bb-14');
  });
});

describe('cabinet appearance overrides', () => {
  function colorsOf(p: Project, cab: Cabinet) {
    const boxes = buildCabinetGeometry(cab, p, { showDoors: true });
    return {
      door: boxes.find((b) => b.role === 'door')?.color,
      box: boxes.find((b) => b.role === 'box')?.color,
    };
  }

  it('unset, the drawing follows the material species', () => {
    const p = makeProject();
    const cab = makeCabinet('base', p, { width: 24, doorCount: 2 });
    const before = colorsOf(p, cab);
    expect(before.door).toBeTruthy();
    expect(before.door).not.toBe('#123456');
  });

  it('a door override paints the fronts', () => {
    const p = makeProject();
    const cab = makeCabinet('base', p, { width: 24, doorCount: 2 });
    p.view = { ...p.view, doorColor: '#123456' };
    expect(colorsOf(p, cab).door).toBe('#123456');
  });

  it('a carcass override paints the box but not the fronts', () => {
    const p = makeProject();
    const cab = makeCabinet('base', p, { width: 24, doorCount: 2 });
    p.view = { ...p.view, boxColor: '#654321' };
    const c = colorsOf(p, cab);
    expect(c.box).toBe('#654321');
    expect(c.door).not.toBe('#654321');
  });

  it('crown follows the door override so the run does not two-tone', () => {
    const p = makeProject();
    p.crown = { ...p.crown, enabled: true };
    p.cabinets = [makeCabinet('wall', p, { width: 24, depth: 12, mountHeight: 54, x: 0 })];
    p.view = { ...p.view, doorColor: '#abcdef' };
    expect(crownRuns(p)[0].color).toBe('#abcdef');
  });

  it('a bar wall follows the doors, the room walls, or its own colour', () => {
    const p = makeProject();
    p.view = { ...p.view, doorColor: '#aaaaaa', wallColor: '#bbbbbb' };
    const body = (finish: BarTop['finish'], finishColor?: string) =>
      buildBarTopGeometry(makeBarTop(p, { finish, finishColor }), p, '#000').find(
        (b) => b.label === 'Bar wall',
      )!.color;

    expect(body('cabinet')).toBe('#aaaaaa');
    expect(body('wall')).toBe('#bbbbbb');
    expect(body('custom', '#cccccc')).toBe('#cccccc');
    // Unset behaves as cabinetry, which is what a panelled bar wall is.
    expect(body(undefined)).toBe('#aaaaaa');
  });

  it('changes nothing in the cut list or the estimate', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 120, 120);
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('base', p, { width: 30, wallId, along: 0, doorCount: 2 }),
      makeCabinet('wall', p, { width: 30, depth: 12, mountHeight: 54, wallId, along: 0 }),
    ];
    applyWallPlacements(p);

    const partsBefore = generateProjectParts(p).parts.length;
    const priceBefore = computeEstimate(p).clientTotal;

    p.view = {
      ...p.view,
      doorColor: '#2f4058',
      boxColor: '#e8e5df',
      pullStyle: 'knob',
      pullColor: '#1f2124',
      pullMetalness: 0.2,
    };

    // Appearance is a render setting, not a specification change. Hardware is
    // billed from each cabinet's own pullId, not from how it is drawn.
    expect(generateProjectParts(p).parts.length).toBe(partsBefore);
    expect(computeEstimate(p).clientTotal).toBeCloseTo(priceBefore, 6);
  });
});

describe('crown runs', () => {
  function crowned(cabs: Partial<Cabinet>[]) {
    const p = makeProject();
    p.crown = { ...p.crown, enabled: true, height: 3.5, projection: 2.5, overlap: 1 };
    p.cabinets = cabs.map((c) => makeCabinet('wall', p, { width: 24, depth: 12, mountHeight: 54, ...c }));
    return p;
  }

  /**
   * The sweep takes the moulding's outward direction from the path direction,
   * so the path has to run the way the cabinets face. Every segment's normal
   * must point out of the cabinet fronts, not back into the wall.
   */
  function normalsPointOut(run: ReturnType<typeof crownRuns>[number], expect_: [number, number]) {
    for (let i = 0; i < run.points.length - 1; i++) {
      const dx = run.points[i + 1][0] - run.points[i][0];
      const dz = run.points[i + 1][1] - run.points[i][1];
      const l = Math.hypot(dx, dz) || 1;
      const n: [number, number] = [-dz / l, dx / l];
      // A return runs perpendicular to the face, so only score the faces.
      if (Math.abs(n[0] * expect_[0] + n[1] * expect_[1]) < 0.5) continue;
      if (n[0] * expect_[0] + n[1] * expect_[1] < 0) return false;
    }
    return true;
  }

  it('runs the path the way the cabinets face, even when a corner seeds it', () => {
    /*
     * A diagonal corner's 45 face runs from wall A toward wall B, which is the
     * opposite direction to the uppers beside it. Chaining from the corner
     * therefore reversed every one of them, flipping their outward normals so
     * the profile swept back into the wall and disappeared. The corner is
     * first in the list here because that is what makes it the seed.
     */
    const p = makeProject();
    p.room = makeRoom('lShape', 120, 120);
    p.crown = { ...p.crown, enabled: true, height: 3.5, projection: 2.5, overlap: 1 };
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('wall', p, {
        width: 24,
        depth: 12,
        mountHeight: 54,
        wallId,
        along: 0,
        corner: 'diagonal',
      }),
      ...[24, 48, 72].map((along) =>
        makeCabinet('wall', p, { width: 24, depth: 12, mountHeight: 54, wallId, along }),
      ),
    ];
    applyWallPlacements(p);

    const runs = crownRuns(p);
    const wallRun = runs.find((r) => r.points.length > 2)!;
    expect(normalsPointOut(wallRun, [0, 1])).toBe(true);
  });

  it('dies into a deeper neighbour instead of returning to the wall', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 120, 120);
    p.crown = { ...p.crown, enabled: true, overlap: 1 };
    const wallId = p.room.walls[0].id;
    // A 12" upper whose run ends against an 84" tall pantry 24" deep. Both
    // tops land at 84", so the crown meets the pantry's face.
    p.cabinets = [
      makeCabinet('wall', p, { width: 30, depth: 12, height: 30, mountHeight: 54, wallId, along: 0 }),
      makeCabinet('tall', p, { width: 24, depth: 24, height: 84, mountHeight: 0, wallId, along: 30, crown: false }),
    ];
    applyWallPlacements(p);

    const run = crownRuns(p)[0];
    const ends = [run.points[0], run.points[run.points.length - 1]];
    // The open end still returns to the wall; the pantry end does not.
    const atFace = ends.filter((pt) => Math.abs(pt[1] - 12) < 0.01);
    const atWall = ends.filter((pt) => Math.abs(pt[1]) < 0.01);
    expect(atFace).toHaveLength(1);
    expect(atWall).toHaveLength(1);
  });

  it('returns only the difference beside a shallower neighbour', () => {
    const p = makeProject();
    p.room = makeRoom('singleWall', 120, 120);
    p.crown = { ...p.crown, enabled: true, overlap: 1 };
    const wallId = p.room.walls[0].id;
    p.cabinets = [
      makeCabinet('wall', p, { width: 30, depth: 12, height: 30, mountHeight: 54, wallId, along: 0 }),
      // A 5" deep open shelf reaching the same height, so 7" of return is left.
      makeCabinet('wall', p, { width: 24, depth: 5, height: 30, mountHeight: 54, wallId, along: 30, crown: false }),
    ];
    applyWallPlacements(p);

    const run = crownRuns(p)[0];
    const ends = [run.points[0], run.points[run.points.length - 1]];
    expect(ends.some((pt) => Math.abs(pt[1] - 5) < 0.01)).toBe(true);
  });

  it('chains a row of cabinets into one continuous run', () => {
    const p = crowned([{ x: 0 }, { x: 24 }, { x: 48 }]);
    const runs = crownRuns(p);
    // One path, not three boxes butted against each other.
    expect(runs).toHaveLength(1);
    // Three faces plus a return at each end.
    expect(runs[0].points.length).toBeGreaterThanOrEqual(4);
  });

  it('returns to the wall at each open end', () => {
    const p = crowned([{ x: 0 }]);
    const run = crownRuns(p)[0];
    const first = run.points[0];
    const last = run.points[run.points.length - 1];
    // Both ends come back to the wall line, which is the outside mitre.
    expect(first[1]).toBeCloseTo(0, 3);
    expect(last[1]).toBeCloseTo(0, 3);
  });

  it('turns a corner as a single path rather than two', () => {
    const p = makeProject();
    p.room = makeRoom('lShape', 168, 144);
    p.crown = { ...p.crown, enabled: true };
    const [wallA] = p.room.walls;
    p.cabinets = [
      makeCabinet('wall', p, { width: 24, depth: 12, corner: 'diagonal', wallId: wallA.id, along: 0, mountHeight: 54 }),
      makeCabinet('wall', p, { width: 24, depth: 12, wallId: wallA.id, along: 24, mountHeight: 54 }),
    ];
    applyWallPlacements(p);
    const runs = crownRuns(p);
    // The corner's 45 face has to join the neighbouring run, not sit apart.
    expect(runs).toHaveLength(1);
  });

  it('keeps runs at different heights separate', () => {
    const p = crowned([{ x: 0, mountHeight: 54 }, { x: 24, mountHeight: 66 }]);
    // Two heights cannot be one length of moulding.
    expect(crownRuns(p)).toHaveLength(2);
  });

  it('sits the run down on the cabinet by the overlap', () => {
    const p = crowned([{ x: 0, mountHeight: 54, height: 30 }]);
    // 54 + 30 = 84 top, lapped 1" down.
    expect(crownRuns(p)[0].y).toBeCloseTo(83, 4);
  });

  it('produces nothing when crown is switched off', () => {
    const p = crowned([{ x: 0 }]);
    p.crown.enabled = false;
    expect(crownRuns(p)).toHaveLength(0);
  });

  it('skips a cabinet that has opted out', () => {
    const p = crowned([{ x: 0, crown: false }, { x: 24 }]);
    const runs = crownRuns(p);
    expect(runs).toHaveLength(1);
    // Only the second cabinet contributes a face.
    expect(runs[0].points.length).toBeLessThanOrEqual(4);
  });

  it('leaves base cabinets out of it', () => {
    const p = makeProject();
    p.crown = { ...p.crown, enabled: true };
    p.cabinets = [makeCabinet('base', p, { width: 24, x: 0 })];
    expect(crownRuns(p)).toHaveLength(0);
  });
});

describe('appliances', () => {
  it('panel-ready units add panels to the cut list, plain ones do not', () => {
    const p = makeProject();
    p.appliances.push(makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'dw-24')!, 0, 0));
    expect(generateProjectParts(p).parts.some((x) => x.category === 'appliancePanel')).toBe(false);

    const p2 = makeProject();
    p2.appliances.push(makeAppliance(APPLIANCE_PRESETS.find((a) => a.key === 'dw-24-panel')!, 0, 0));
    expect(generateProjectParts(p2).parts.some((x) => x.category === 'appliancePanel')).toBe(true);
  });

  it('a French-door fridge takes two panels, each half the width', () => {
    const p = makeProject();
    const preset = APPLIANCE_PRESETS.find((a) => a.key === 'fridge-36-panel')!;
    p.appliances.push(makeAppliance(preset, 0, 0));
    const panel = generateProjectParts(p).parts.find((x) => x.category === 'appliancePanel')!;
    expect(panel.qty).toBe(2);
    expect(panel.width).toBeCloseTo(18, 1);
  });
});

describe('project migration', () => {
  it('opens a project saved before appliances and crown existed', () => {
    const old = makeProject('Old Job') as unknown as Record<string, unknown>;
    delete old.appliances;
    delete old.crown;
    delete old.lightRail;
    delete old.extras;

    const migrated = migrateProject(old as unknown as Project);
    expect(migrated.appliances).toEqual([]);
    expect(migrated.crown.enabled).toBe(false);
    expect(migrated.lightRail).toBeDefined();
    expect(() => computeEstimate(migrated)).not.toThrow();
  });

  it('keeps prices the user edited while adding new catalogue entries', () => {
    const old = makeProject('Old Job');
    const ply = old.materials.find((m) => m.id === 'ply-birch-34')!;
    (ply as { costPerSheet: number }).costPerSheet = 999;
    old.hardware = old.hardware.filter((h) => h.id !== 'hw-lazy-susan');

    const migrated = migrateProject(old);
    const keptPrice = migrated.materials.find((m) => m.id === 'ply-birch-34') as { costPerSheet: number };
    expect(keptPrice.costPerSheet).toBe(999);
    expect(migrated.hardware.some((h) => h.id === 'hw-lazy-susan')).toBe(true);
  });

  it('opens a trimmed export that carries no material catalogue', () => {
    // The demo file ships without materials, hardware or finishes so it stays
    // small; migration must rebuild them or the import is worthless.
    const slim = {
      name: 'Trimmed',
      cabinets: [
        {
          id: 'c1',
          name: 'Base',
          type: 'base',
          width: 24,
          height: 34.5,
          depth: 24,
          x: 0,
          z: 0,
          rotation: 0,
          doorCount: 2,
          drawers: [],
          shelfCount: 1,
          adjustableShelves: true,
          finishedLeft: false,
          finishedRight: false,
          boxMaterialId: 'ply-prefin-maple-34',
          faceMaterialId: 'lbr-hardmaple-44',
          backMaterialId: 'ply-prefin-maple-12',
          drawerBoxMaterialId: 'bb-12',
          edgebandId: 'eb-maple-pg',
        },
      ],
    } as unknown as Project;

    const migrated = migrateProject(slim);
    expect(migrated.materials.length).toBeGreaterThan(10);
    expect(migrated.hardware.length).toBeGreaterThan(5);
    expect(migrated.finishes.length).toBeGreaterThan(2);
    const est = computeEstimate(migrated);
    expect(est.clientTotal).toBeGreaterThan(0);
  });

  it('accepts a project that carries only a cabinet list', () => {
    // The strict version of this check silently threw away the demo file and
    // opened a blank project instead, which looked exactly like data loss.
    expect(looksLikeProject({ cabinets: [] })).toBe(true);
    expect(looksLikeProject({ name: 'no cabinets' })).toBe(false);
    expect(looksLikeProject(null)).toBe(false);
    expect(looksLikeProject('a string')).toBe(false);
  });

  it('backfills labour rates added after the file was saved', () => {
    const old = makeProject('Old Job');
    delete (old.labor as unknown as Record<string, unknown>).hoursPerCornerCabinet;
    const migrated = migrateProject(old);
    expect(typeof migrated.labor.hoursPerCornerCabinet).toBe('number');
  });
});

describe('nesting', () => {
  const material: SheetMaterial = {
    id: 'test-ply',
    kind: 'sheet',
    name: 'Test Ply',
    species: 'Birch',
    thickness: 0.75,
    sheetWidth: 48,
    sheetLength: 96,
    costPerSheet: 90,
    hasGrain: true,
    finishGrade: 'stain',
  };

  const part = (length: number, width: number, qty: number, grain: 'length' | 'none' = 'length') => ({
    id: `t${length}x${width}`,
    cabinetId: 'c1',
    cabinetName: 'Test',
    name: 'Panel',
    category: 'side' as const,
    materialId: 'test-ply',
    length,
    width,
    thickness: 0.75,
    qty,
    grain,
    banded: { front: false, back: false, left: false, right: false },
  });

  it('places every part that fits', () => {
    const res = nestSheetMaterial([part(34.5, 24, 8)], material, 0.125, 0.25);
    expect(res.unplaced).toHaveLength(0);
    const placed = res.sheets.reduce((a, s) => a + s.placements.length, 0);
    expect(placed).toBe(8);
  });

  it('never overlaps two parts on a sheet', () => {
    const res = nestSheetMaterial(
      [part(34.5, 23.25, 6), part(30, 11.25, 8), part(22.5, 23, 5), part(14, 9, 11)],
      material,
      0.125,
      0.25,
    );
    for (const sheet of res.sheets) {
      for (let i = 0; i < sheet.placements.length; i++) {
        for (let j = i + 1; j < sheet.placements.length; j++) {
          const a = sheet.placements[i];
          const b = sheet.placements[j];
          const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false);
        }
      }
    }
  });

  it('keeps every part inside the usable area', () => {
    const res = nestSheetMaterial([part(34.5, 23.25, 9), part(20, 15, 7)], material, 0.125, 0.25);
    for (const sheet of res.sheets) {
      for (const p of sheet.placements) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x + p.w).toBeLessThanOrEqual(sheet.usableLength + 1e-6);
        expect(p.y + p.h).toBeLessThanOrEqual(sheet.usableWidth + 1e-6);
      }
    }
  });

  it('does not rotate grain-locked parts', () => {
    const res = nestSheetMaterial([part(40, 20, 4, 'length')], material, 0.125, 0.25);
    for (const sheet of res.sheets) {
      for (const p of sheet.placements) expect(p.rotated).toBe(false);
    }
  });

  it('allows rotation when grain does not matter', () => {
    // 90" long, 10" wide: only fits across the sheet width if rotated.
    const res = nestSheetMaterial([part(10, 46, 3, 'none')], material, 0.125, 0.25);
    expect(res.unplaced).toHaveLength(0);
  });

  it('reports parts that cannot fit rather than dropping them', () => {
    const res = nestSheetMaterial([part(120, 20, 1)], material, 0.125, 0.25);
    expect(res.unplaced).toHaveLength(1);
    expect(res.sheets.reduce((a, s) => a + s.placements.length, 0)).toBe(0);
  });

  it('reports a part that only fails because of grain', () => {
    // 60" is longer than the 47.5" usable width, so a grain-locked part in
    // that orientation would fit only if rotation were allowed.
    const res = nestSheetMaterial([part(20, 60, 1, 'length')], material, 0.125, 0.25);
    expect(res.unplaced).toHaveLength(1);
    expect(res.unplaced[0].reason).toMatch(/grain/i);
  });

  it('yields a sensible sheet count for a real kitchen run', () => {
    const project = makeProject();
    for (let i = 0; i < 6; i++) {
      project.cabinets.push(makeCabinet('base', project, { width: 24, doorCount: 2, x: i * 24 }));
    }
    const est = computeEstimate(project);
    const total = est.takeoff.sheetResults.reduce((a, r) => a + r.sheets.length, 0);
    // Six 24" base cabinets is a handful of sheets, not one and not thirty.
    expect(total).toBeGreaterThan(2);
    expect(total).toBeLessThan(20);
  });
});

describe('estimate', () => {
  function kitchen() {
    const project = makeProject('Test Kitchen');
    for (let i = 0; i < 4; i++) {
      project.cabinets.push(
        makeCabinet('base', project, { width: 24, doorCount: 2, drawers: [{ id: `d${i}`, frontHeight: 6 }], x: i * 24 }),
      );
    }
    for (let i = 0; i < 3; i++) {
      project.cabinets.push(makeCabinet('wall', project, { width: 24, doorCount: 2, shelfCount: 2, x: i * 24 }));
    }
    return project;
  }

  it('prices a kitchen above cost and inside sane bounds', () => {
    const est = computeEstimate(kitchen());
    expect(est.totalCost).toBeGreaterThan(0);
    expect(est.clientTotal).toBeGreaterThan(est.totalCost);
    const lf = linearFeet(kitchen().cabinets);
    const perLf = est.clientTotal / (lf.base + lf.wall + lf.tall);
    // Custom cabinetry runs a few hundred to well over a thousand per lineal foot.
    expect(perLf).toBeGreaterThan(150);
    expect(perLf).toBeLessThan(3000);
  });

  it('hits the target margin on the sell price', () => {
    const project = kitchen();
    project.pricing.targetMarginPct = 0.35;
    project.pricing.salesTaxPct = 0;
    project.pricing.deliveryFlat = 0;
    const est = computeEstimate(project);
    // Margin is on price, not markup on cost.
    expect((est.cabinetryPrice - est.totalCost) / est.cabinetryPrice).toBeCloseTo(0.35, 4);
  });

  it('raising material price raises the client total', () => {
    const a = kitchen();
    const before = computeEstimate(a).clientTotal;
    const b = kitchen();
    for (const m of b.materials) if (isSheet(m)) m.costPerSheet *= 2;
    expect(computeEstimate(b).clientTotal).toBeGreaterThan(before);
  });

  it('counts hinges by door height', () => {
    expect(hingesForDoor(30)).toBe(2);
    expect(hingesForDoor(50)).toBe(3);
    expect(hingesForDoor(70)).toBe(4);
    expect(hingesForDoor(90)).toBe(5);
  });

  it('counts one pair of slides per drawer', () => {
    const project = makeProject();
    project.cabinets.push(
      makeCabinet('base', project, {
        doorCount: 0,
        drawers: [
          { id: 'a', frontHeight: 6 },
          { id: 'b', frontHeight: 12 },
          { id: 'c', frontHeight: 15 },
        ],
      }),
    );
    const est = computeEstimate(project);
    const slides = est.hardwareCounts.find((h) => h.item.category === 'drawerSlide');
    expect(slides?.qty).toBe(3);
  });

  it('excluded cabinets drop out of the price', () => {
    const project = kitchen();
    const full = computeEstimate(project).clientTotal;
    project.cabinets[0].excluded = true;
    expect(computeEstimate(project).clientTotal).toBeLessThan(full);
  });

  it('prefinished box material skips interior finishing area', () => {
    const prefinished = kitchen();
    prefinished.defaultBoxMaterialId = 'ply-prefin-maple-34';
    for (const c of prefinished.cabinets) c.boxMaterialId = 'ply-prefin-maple-34';

    const raw = kitchen();
    raw.defaultBoxMaterialId = 'ply-birch-34';
    for (const c of raw.cabinets) c.boxMaterialId = 'ply-birch-34';

    expect(computeEstimate(prefinished).finishSqFt).toBeLessThan(computeEstimate(raw).finishSqFt);
  });

  it('an empty project prices at zero without throwing', () => {
    const est = computeEstimate(makeProject());
    expect(est.clientTotal).toBe(0);
    expect(est.warnings).toHaveLength(0);
  });
});

describe('geometry', () => {
  const project = makeProject();

  it('keeps every solid inside the cabinet envelope', () => {
    const cab = makeCabinet('base', project, { width: 24, height: 34.5, depth: 24, doorCount: 2 });
    const boxes = buildCabinetGeometry(cab, project);
    for (const b of boxes) {
      const x0 = b.pos[0] - b.size[0] / 2;
      const x1 = b.pos[0] + b.size[0] / 2;
      expect(x0).toBeGreaterThanOrEqual(-0.01);
      expect(x1).toBeLessThanOrEqual(cab.width + 0.01);
      // Fronts stand proud of the box by their thickness.
      expect(b.pos[2] + b.size[2] / 2).toBeLessThanOrEqual(cab.depth + 1.01);
    }
  });

  it('drops the door solids when doors are hidden', () => {
    const cab = makeCabinet('base', project, { doorCount: 2 });
    const withDoors = buildCabinetGeometry(cab, project, { showDoors: true });
    const without = buildCabinetGeometry(cab, project, { showDoors: false });
    expect(withDoors.some((b) => b.role === 'door')).toBe(true);
    expect(without.some((b) => b.role === 'door')).toBe(false);
  });

  it('detects overlapping cabinets in the same run', () => {
    const a = makeCabinet('base', project, { width: 24, x: 0 });
    const b = makeCabinet('base', project, { width: 24, x: 12 });
    expect(findCollisions([a, b])).toHaveLength(1);
  });

  it('does not flag a wall cabinet sitting over a base cabinet', () => {
    const base = makeCabinet('base', project, { width: 24, x: 0 });
    const wall = makeCabinet('wall', project, { width: 24, x: 0 });
    expect(findCollisions([base, wall])).toHaveLength(0);
  });

  it('leaves a gap between cabinets placed end to end', () => {
    const a = makeCabinet('base', project, { width: 24, x: 0 });
    const b = makeCabinet('base', project, { width: 24, x: 24 });
    expect(findCollisions([a, b])).toHaveLength(0);
  });
});
