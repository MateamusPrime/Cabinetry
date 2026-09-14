import type { LumberMaterial, Material, Part, SheetMaterial } from './types';
import { boardFeet } from './units';

/**
 * Sheet-goods nesting.
 *
 * Uses guillotine bin packing rather than a free-form (MaxRects) layout,
 * because every cut on a table saw or panel saw runs edge to edge. A layout
 * that cannot be cut with straight-through passes is useless in the shop.
 */

export interface Placement {
  partId: string;
  name: string;
  cabinetName: string;
  x: number;
  y: number;
  /** As placed on the sheet. */
  w: number;
  h: number;
  rotated: boolean;
  grainLocked: boolean;
}

export interface NestedSheet {
  index: number;
  materialId: string;
  sheetWidth: number;
  sheetLength: number;
  usableWidth: number;
  usableLength: number;
  trim: number;
  placements: Placement[];
  usedArea: number;
  /** Fraction of the full sheet covered by parts. */
  yield: number;
}

export interface NestResult {
  materialId: string;
  materialName: string;
  sheets: NestedSheet[];
  unplaced: { partId: string; name: string; cabinetName: string; w: number; h: number; reason: string }[];
  totalParts: number;
  totalPartArea: number;
  averageYield: number;
}

export interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Piece {
  partId: string;
  name: string;
  cabinetName: string;
  /** Grain-parallel dimension. */
  length: number;
  width: number;
  canRotate: boolean;
}

/** Expand cut-list quantities into individual pieces. */
function explode(parts: Part[], material: SheetMaterial): Piece[] {
  const pieces: Piece[] = [];
  for (const p of parts) {
    const canRotate = !material.hasGrain || p.grain === 'none';
    for (let i = 0; i < p.qty; i++) {
      pieces.push({
        partId: `${p.id}#${i}`,
        name: p.name,
        cabinetName: p.cabinetName,
        length: p.length,
        width: p.width,
        canRotate,
      });
    }
  }
  return pieces;
}

/**
 * Split a free rectangle after placing a part in its lower-left corner.
 * Splitting along the shorter leftover axis keeps the larger remnant intact.
 */
function splitFree(rect: FreeRect, usedW: number, usedH: number): FreeRect[] {
  const rightW = rect.w - usedW;
  const topH = rect.h - usedH;
  const out: FreeRect[] = [];

  // Horizontal split leaves a full-width strip on top; vertical leaves a
  // full-height strip to the right. Pick whichever preserves more area.
  const horizontalArea = rect.w * topH;
  const verticalArea = rightW * rect.h;

  if (horizontalArea >= verticalArea) {
    if (rightW > 0) out.push({ x: rect.x + usedW, y: rect.y, w: rightW, h: usedH });
    if (topH > 0) out.push({ x: rect.x, y: rect.y + usedH, w: rect.w, h: topH });
  } else {
    if (rightW > 0) out.push({ x: rect.x + usedW, y: rect.y, w: rightW, h: rect.h });
    if (topH > 0) out.push({ x: rect.x, y: rect.y + usedH, w: usedW, h: topH });
  }
  return out.filter((r) => r.w > 0.01 && r.h > 0.01);
}

/** Tolerance for treating two edges as being in the same place. */
const EPS = 1e-6;

/** The same rectangle, to the tolerance the containment test works at. */
function sameRect(a: FreeRect, b: FreeRect): boolean {
  return (
    Math.abs(a.x - b.x) <= EPS &&
    Math.abs(a.y - b.y) <= EPS &&
    Math.abs(a.w - b.w) <= EPS &&
    Math.abs(a.h - b.h) <= EPS
  );
}

/**
 * Drop free rectangles fully contained inside another.
 *
 * Sameness is measured at the same tolerance as containment, and it has to be.
 * Comparing exactly while containing loosely means a pair that differs by less
 * than EPS reads as "each one inside the other, yet not identical" — so every
 * copy is dropped and the free space disappears from the sheet, costing yield
 * or an extra sheet with nothing to show for it.
 */
export function prune(rects: FreeRect[]): FreeRect[] {
  const keep: FreeRect[] = [];
  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    let contained = false;
    for (let j = 0; j < rects.length; j++) {
      if (i === j) continue;
      const b = rects[j];
      if (a.x >= b.x - EPS && a.y >= b.y - EPS && a.x + a.w <= b.x + b.w + EPS && a.y + a.h <= b.y + b.h + EPS) {
        if (sameRect(a, b)) {
          // One of the pair survives: whichever comes first in the list.
          if (j < i) {
            contained = true;
            break;
          }
        } else {
          contained = true;
          break;
        }
      }
    }
    if (!contained) keep.push(a);
  }
  return keep;
}

export function nestSheetMaterial(
  parts: Part[],
  material: SheetMaterial,
  kerf: number,
  trim: number,
): NestResult {
  const pieces = explode(parts, material);
  const usableW = material.sheetWidth - 2 * trim;
  const usableL = material.sheetLength - 2 * trim;

  const unplaced: NestResult['unplaced'] = [];
  const fits = (l: number, w: number) => l <= usableL + 1e-6 && w <= usableW + 1e-6;

  const workable: Piece[] = [];
  for (const p of pieces) {
    const direct = fits(p.length, p.width);
    const rotated = p.canRotate && fits(p.width, p.length);
    if (!direct && !rotated) {
      unplaced.push({
        partId: p.partId,
        name: p.name,
        cabinetName: p.cabinetName,
        w: p.width,
        h: p.length,
        reason: p.canRotate
          ? `Larger than a usable ${usableL}" x ${usableW}" sheet area`
          : `Does not fit with grain running along the ${material.sheetLength}" sheet length`,
      });
      continue;
    }
    workable.push(p);
  }

  // Big pieces first — they are the hardest to place and set the layout.
  workable.sort((a, b) => {
    const am = Math.max(a.length, a.width);
    const bm = Math.max(b.length, b.width);
    if (Math.abs(am - bm) > 1e-6) return bm - am;
    return b.length * b.width - a.length * a.width;
  });

  const sheets: NestedSheet[] = [];
  const freeBySheet: FreeRect[][] = [];

  const newSheet = (): number => {
    sheets.push({
      index: sheets.length,
      materialId: material.id,
      sheetWidth: material.sheetWidth,
      sheetLength: material.sheetLength,
      usableWidth: usableW,
      usableLength: usableL,
      trim,
      placements: [],
      usedArea: 0,
      yield: 0,
    });
    // Sheet axes: x runs along the sheet length (grain), y across the width.
    freeBySheet.push([{ x: 0, y: 0, w: usableL, h: usableW }]);
    return sheets.length - 1;
  };

  for (const piece of workable) {
    // Candidate orientations. x-extent is along the grain.
    const orientations: { w: number; h: number; rotated: boolean }[] = [];
    if (fits(piece.length, piece.width)) orientations.push({ w: piece.length, h: piece.width, rotated: false });
    if (piece.canRotate && fits(piece.width, piece.length))
      orientations.push({ w: piece.width, h: piece.length, rotated: true });

    let best: { sheet: number; rect: number; o: (typeof orientations)[0]; score: number } | null = null;

    for (let s = 0; s < sheets.length; s++) {
      const free = freeBySheet[s];
      for (let r = 0; r < free.length; r++) {
        const fr = free[r];
        for (const o of orientations) {
          const needW = o.w + kerf;
          const needH = o.h + kerf;
          // Allow the piece to butt the far edge without demanding kerf there.
          const okW = o.w <= fr.w + 1e-6 && (needW <= fr.w + 1e-6 || Math.abs(o.w - fr.w) < 1e-6);
          const okH = o.h <= fr.h + 1e-6 && (needH <= fr.h + 1e-6 || Math.abs(o.h - fr.h) < 1e-6);
          if (!okW || !okH) continue;
          // Best short side fit: minimise the smaller leftover dimension.
          const leftW = fr.w - o.w;
          const leftH = fr.h - o.h;
          const score = Math.min(leftW, leftH) * 1000 + Math.max(leftW, leftH);
          if (!best || score < best.score) best = { sheet: s, rect: r, o, score };
        }
      }
      if (best) break; // Fill earlier sheets before opening a new one.
    }

    if (!best) {
      const s = newSheet();
      const fr = freeBySheet[s][0];
      const o = orientations.find((c) => c.w <= fr.w + 1e-6 && c.h <= fr.h + 1e-6);
      if (!o) {
        unplaced.push({
          partId: piece.partId,
          name: piece.name,
          cabinetName: piece.cabinetName,
          w: piece.width,
          h: piece.length,
          reason: 'Could not be placed on an empty sheet',
        });
        continue;
      }
      best = { sheet: s, rect: 0, o, score: 0 };
    }

    const sheet = sheets[best.sheet];
    const free = freeBySheet[best.sheet];
    const fr = free[best.rect];

    sheet.placements.push({
      partId: piece.partId,
      name: piece.name,
      cabinetName: piece.cabinetName,
      x: fr.x,
      y: fr.y,
      w: best.o.w,
      h: best.o.h,
      rotated: best.o.rotated,
      grainLocked: !piece.canRotate,
    });
    sheet.usedArea += best.o.w * best.o.h;

    const usedW = Math.min(fr.w, best.o.w + kerf);
    const usedH = Math.min(fr.h, best.o.h + kerf);
    free.splice(best.rect, 1, ...splitFree(fr, usedW, usedH));
    freeBySheet[best.sheet] = prune(free);
  }

  const fullArea = material.sheetWidth * material.sheetLength;
  for (const s of sheets) s.yield = s.usedArea / fullArea;

  const totalPartArea = sheets.reduce((a, s) => a + s.usedArea, 0);
  return {
    materialId: material.id,
    materialName: material.name,
    sheets,
    unplaced,
    totalParts: pieces.length,
    totalPartArea,
    averageYield: sheets.length ? totalPartArea / (sheets.length * fullArea) : 0,
  };
}

// ---------------------------------------------------------------------------
// Solid lumber
// ---------------------------------------------------------------------------

export interface LumberPlan {
  materialId: string;
  materialName: string;
  /** Net board feet in the finished parts. */
  netBoardFeet: number;
  /** Net plus waste — what you actually buy. */
  grossBoardFeet: number;
  wasteFactor: number;
  pieces: number;
  /** Rough-cut rip list, longest first. */
  rows: { name: string; cabinetName: string; length: number; width: number; qty: number; boardFeet: number }[];
}

export function planLumber(parts: Part[], material: LumberMaterial, wasteFactor: number): LumberPlan {
  const rows = parts
    .map((p) => ({
      name: p.name,
      cabinetName: p.cabinetName,
      length: p.length,
      width: p.width,
      qty: p.qty,
      boardFeet: boardFeet(material.nominalThickness, p.width, p.length, p.qty),
    }))
    .sort((a, b) => b.length - a.length);

  const net = rows.reduce((a, r) => a + r.boardFeet, 0);
  return {
    materialId: material.id,
    materialName: material.name,
    netBoardFeet: net,
    grossBoardFeet: net * (1 + wasteFactor),
    wasteFactor,
    pieces: rows.reduce((a, r) => a + r.qty, 0),
    rows,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface MaterialTakeoff {
  sheetResults: NestResult[];
  lumberPlans: LumberPlan[];
  /** Linear feet of edgebanding, keyed by edgeband material id. */
  edgebandFeet: Map<string, number>;
}

/**
 * Group parts by material and run the right planner for each.
 * `edgebandByPart` maps a part id to the edgeband material chosen for it.
 */
export function buildTakeoff(
  parts: Part[],
  materials: Material[],
  kerf: number,
  trim: number,
  lumberWaste: number,
  edgebandForPart: (part: Part) => string | undefined,
): MaterialTakeoff {
  const byMaterial = new Map<string, Part[]>();
  for (const p of parts) {
    const list = byMaterial.get(p.materialId);
    if (list) list.push(p);
    else byMaterial.set(p.materialId, [p]);
  }

  const sheetResults: NestResult[] = [];
  const lumberPlans: LumberPlan[] = [];

  for (const [materialId, group] of byMaterial) {
    const mat = materials.find((m) => m.id === materialId);
    if (!mat) continue;
    if (mat.kind === 'sheet') sheetResults.push(nestSheetMaterial(group, mat, kerf, trim));
    else if (mat.kind === 'lumber') lumberPlans.push(planLumber(group, mat, lumberWaste));
  }

  const edgebandFeet = new Map<string, number>();
  for (const p of parts) {
    const ebId = edgebandForPart(p);
    if (!ebId) continue;
    const edges =
      (p.banded.front ? p.width : 0) +
      (p.banded.back ? p.width : 0) +
      (p.banded.left ? p.length : 0) +
      (p.banded.right ? p.length : 0);
    if (edges <= 0) continue;
    const feet = (edges * p.qty) / 12;
    edgebandFeet.set(ebId, (edgebandFeet.get(ebId) ?? 0) + feet);
  }

  sheetResults.sort((a, b) => b.sheets.length - a.sheets.length);
  lumberPlans.sort((a, b) => b.grossBoardFeet - a.grossBoardFeet);

  return { sheetResults, lumberPlans, edgebandFeet };
}
