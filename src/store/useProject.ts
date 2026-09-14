import { create } from 'zustand';
import type {
  Appliance,
  ApplianceKind,
  BarTop,
  Cabinet,
  ConstructionSpec,
  CrownSpec,
  DrawerSpec,
  ExtraLineItem,
  JobSummary,
  LaborRates,
  LightRailSpec,
  Material,
  PricingSettings,
  Project,
  ViewSettings,
  Wall,
  WindowOpening,
} from '../domain/types';
import {
  APPLIANCE_PRESETS,
  CABINET_PRESETS,
  DEFAULT_WALL_TOP,
  fitDrawerHeights,
  makeAppliance,
  makeBarTop,
  makeCabinet,
  makeProject,
  makeRoom,
  makeWindow,
  uid,
  VIEW_PRESETS,
  wallMountHeight,
  type RoomShape,
} from '../domain/defaults';
import { computeEstimate } from '../domain/estimate';
import {
  applyWallPlacements,
  overlapsInPlan,
  projectOntoWall,
  roomCentre,
  runStatus,
  wallFrame,
} from '../domain/geometry';

/** Cabinet widths land on a sixteenth — finer than that is not cuttable. */
const snap16 = (n: number) => Math.round(n * 16) / 16;

/** Appliances that mount to the underside of a cabinet rather than the floor. */
const HANGS_UNDER_CABINET = new Set<ApplianceKind>(['microwave', 'hood']);

const STORAGE_KEY = 'cabinetry.project.v1';
const LIST_KEY = 'cabinetry.projects.v1';

/**
 * Bring a project saved by an older build up to the current shape.
 *
 * Projects are real work — a job saved last month must still open after the
 * app gains features. Anything missing is filled from current defaults rather
 * than throwing the file away.
 */
export function migrateProject(input: Project): Project {
  const fresh = makeProject(input.name || 'Project');
  const p: Project = {
    ...input,
    appliances: input.appliances ?? [],
    barTops: input.barTops ?? [],
    // Drop any opening whose wall has since been deleted, or it would be
    // unreachable in the editor and invisible in the drawing.
    windows: (input.windows ?? []).filter((win) =>
      (input.room?.walls ?? []).some((w) => w.id === win.wallId),
    ),
    extras: input.extras ?? [],
    crown: { ...fresh.crown, ...(input.crown ?? {}) },
    lightRail: { ...fresh.lightRail, ...(input.lightRail ?? {}) },
    view: { ...fresh.view, ...(input.view ?? {}) },
    // Spreading fresh first backfills any spec field a saved project predates,
    // so a new setting arrives at its default rather than undefined.
    defaults: { ...fresh.defaults, ...(input.defaults ?? {}) },
    labor: { ...fresh.labor, ...(input.labor ?? {}) },
    pricing: { ...fresh.pricing, ...(input.pricing ?? {}) },
    room: input.room?.walls ? input.room : fresh.room,
    finishes: input.finishes?.length ? input.finishes : fresh.finishes,
    // Drawer bottoms used to be fixed at 1/4" Baltic Birch in the generator,
    // so an older project has no stored choice. Keep what it was building.
    defaultDrawerBottomMaterialId: input.defaultDrawerBottomMaterialId ?? 'bb-14',
  };

  // Hardware and materials gained entries (corner gear, for instance). Add any
  // the saved file predates without disturbing prices the user has edited.
  const haveHw = new Set(p.hardware?.map((h) => h.id) ?? []);
  p.hardware = [...(p.hardware ?? []), ...fresh.hardware.filter((h) => !haveHw.has(h.id))];
  const haveMat = new Set(p.materials?.map((m) => m.id) ?? []);
  p.materials = [...(p.materials ?? []), ...fresh.materials.filter((m) => !haveMat.has(m.id))];

  p.cabinets = (p.cabinets ?? []).map((c) => ({
    ...c,
    corner: c.corner ?? 'none',
    // A farmhouse apron and a false front want the same piece of face, so an
    // older project that has both loses the false front.
    drawers: (c.drawers ?? []).filter((d) => !(c.sink?.style === 'farmhouse' && d.falseFront)),
    hingeSide: c.hingeSide ?? 'right',
  }));

  /*
   * Sinks used to be appliances standing on the floor, which fought the run
   * packing and the gap maths. Move any into the cabinet they sit over so
   * they behave like the fixture they are.
   */
  const sinkAppliances = (p.appliances ?? []).filter((a) => a.kind === 'sink');
  if (sinkAppliances.length) {
    for (const s of sinkAppliances) {
      const host = p.cabinets.find(
        (c) => c.type !== 'wall' && !c.excluded && overlapsInPlan(c, s),
      );
      if (!host || host.sink) continue;
      const farmhouse = /farm|apron/i.test(s.name);
      host.sink = {
        style: farmhouse ? 'farmhouse' : 'undermount',
        width: Math.min(s.width, host.width - 2),
        frontToBack: Math.max(12, s.depth),
        bowlDepth: Math.max(6, s.height),
        apronHeight: 10,
        faucet: true,
      };
    }
    p.appliances = p.appliances.filter((a) => a.kind !== 'sink');
  }

  /*
   * Appliances used to sit at fixed coordinates, which meant a cabinet
   * resized before one would leapfrog it instead of pushing it along. Attach
   * any that stand against a wall to that wall's run.
   */
  if (p.room?.walls?.length && p.appliances?.length) {
    const centre = roomCentre(p.room);
    for (const a of p.appliances) {
      if (a.wallId) continue;
      let best: { wallId: string; along: number; dist: number } | null = null;
      for (const w of p.room.walls) {
        const frame = wallFrame(w, centre);
        const { along, offset } = projectOntoWall(frame, a.x, a.z);
        if (along < -a.width || along > frame.length) continue;
        if (!best || Math.abs(offset) < best.dist) {
          best = { wallId: w.id, along, dist: Math.abs(offset) };
        }
      }
      if (best && best.dist < Math.max(a.depth, 18)) {
        a.wallId = best.wallId;
        a.along = Math.max(0, best.along);
      }
    }
  }

  // Projects saved before runs were wall-aware laid everything along one axis.
  // Attach those to the first wall at their existing offset so the layout is
  // unchanged on screen but now behaves like a proper run.
  const firstWall = p.room.walls[0];
  if (firstWall) {
    for (const c of p.cabinets) {
      if (c.wallId === undefined && c.rotation === 0 && Math.abs(c.z) < 0.01) {
        c.wallId = firstWall.id;
        c.along = c.x;
      }
    }
  }
  applyWallPlacements(p);

  return p;
}

/**
 * True when a blob looks like a project worth migrating. Only the cabinet
 * list is required — settings, prices and catalogues are all backfilled, so
 * demanding them here would silently discard a perfectly good file.
 */
export function looksLikeProject(v: unknown): v is Project {
  return !!v && typeof v === 'object' && Array.isArray((v as Project).cabinets);
}

function loadProject(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (looksLikeProject(parsed)) return migrateProject(parsed);
    }
  } catch {
    // Corrupt storage should never block the app from opening.
  }
  return makeProject('Kitchen Remodel');
}

function persist(p: Project) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Quota or private-mode failures are non-fatal; the session still works.
  }
}

export type ViewMode = 'design' | 'cutlist' | 'nesting' | 'estimate' | 'settings';

interface ProjectState {
  project: Project;
  selectedCabinetId: string | null;
  selectedApplianceId: string | null;
  selectedBarTopId: string | null;
  selectedWindowId: string | null;
  /** Wall new cabinets are added to. */
  activeWallId: string | null;
  view: ViewMode;
  showDimensions: boolean;
  showDoors: boolean;

  setView: (v: ViewMode) => void;
  select: (id: string | null) => void;
  selectAppliance: (id: string | null) => void;
  setActiveWall: (id: string) => void;
  toggleDimensions: () => void;
  toggleDoors: () => void;

  update: (fn: (p: Project) => void) => void;
  setProject: (p: Project) => void;
  newProject: (name?: string) => void;

  addCabinet: (presetKey: string) => void;
  duplicateCabinet: (id: string) => void;
  removeCabinet: (id: string) => void;
  /** Move a cabinet within the list, then re-flow its run left to right. */
  reorderCabinet: (id: string, toIndex: number) => void;
  alignWallTops: () => void;

  /** Close the gap at the end of a run by adding a scribe filler. */
  fillRunWithFiller: (wallId: string, upper: boolean) => void;
  /** Share the leftover equally across every cabinet in the run. */
  distributeRun: (wallId: string, upper: boolean) => void;
  /** Widen only the last cabinet to take up the leftover. */
  stretchLastInRun: (wallId: string, upper: boolean) => void;
  updateCabinet: (id: string, patch: Partial<Cabinet>) => void;
  autoArrange: () => void;

  addDrawer: (cabinetId: string, frontHeight?: number) => void;
  updateDrawer: (cabinetId: string, drawerId: string, patch: Partial<DrawerSpec>) => void;
  removeDrawer: (cabinetId: string, drawerId: string) => void;
  /** Divide the remaining face height evenly across the drawer stack. */
  balanceDrawers: (cabinetId: string) => void;

  updateView: (patch: Partial<ViewSettings>) => void;
  applyViewPreset: (key: string) => void;
  updateCrown: (patch: Partial<CrownSpec>) => void;
  updateLightRail: (patch: Partial<LightRailSpec>) => void;
  /** Move a cabinet or appliance in plan, snapping to the grid. */
  moveItem: (kind: 'cabinet' | 'appliance', id: string, x: number, z: number) => void;
  updateDefaults: (patch: Partial<ConstructionSpec>) => void;
  updateLabor: (patch: Partial<LaborRates>) => void;
  updatePricing: (patch: Partial<PricingSettings>) => void;
  updateMaterial: (id: string, patch: Partial<Material>) => void;
  updateHardwareCost: (id: string, cost: number) => void;

  addExtra: () => void;
  updateExtra: (id: string, patch: Partial<ExtraLineItem>) => void;
  removeExtra: (id: string) => void;

  /** Hide or show a wall in the 3D view. Presentation only. */
  toggleWallHidden: (id: string) => void;
  /** Hide a bar wall in 3D so you can see the run behind it. Visual only. */
  toggleBarTopHidden: (id: string) => void;
  showAllWalls: () => void;
  addWall: () => void;
  updateWall: (id: string, patch: Partial<Wall>) => void;
  removeWall: (id: string) => void;

  addAppliance: (presetKey: string) => void;
  updateAppliance: (id: string, patch: Partial<Appliance>) => void;
  removeAppliance: (id: string) => void;

  /** Raised bar: a pony wall with a slab on it, standing behind a base run. */
  addBarTop: () => void;
  updateBarTop: (id: string, patch: Partial<BarTop>) => void;
  removeBarTop: (id: string) => void;
  selectBarTop: (id: string | null) => void;

  /** Openings cut through a wall. Never part of a run. */
  addWindow: () => void;
  updateWindow: (id: string, patch: Partial<WindowOpening>) => void;
  removeWindow: (id: string) => void;
  selectWindow: (id: string | null) => void;
  /** Drop a wall cabinet directly on top of an appliance. */
  stackCabinetAbove: (applianceId: string) => void;

  applyRoomShape: (shape: RoomShape, width?: number, depth?: number) => void;

  /**
   * Save the open project into the job library, creating or overwriting.
   * Returns null on success, or a message explaining why nothing was saved.
   */
  saveJob: () => string | null;
  listJobs: () => JobSummary[];
  openJob: (id: string) => string | null;
  deleteJob: (id: string) => string | null;
  newJob: (name: string, client: string) => string | null;
  duplicateJob: (id: string) => string | null;

  exportJson: () => string;
  importJson: (json: string) => string | null;
}

export const useProject = create<ProjectState>((set, get) => {
  const commit = (fn: (p: Project) => void) => {
    set((state) => {
      const next: Project = JSON.parse(JSON.stringify(state.project));
      fn(next);
      next.updatedAt = new Date().toISOString();
      persist(next);
      return { project: next };
    });
  };

  return {
    project: loadProject(),
    selectedCabinetId: null,
    selectedApplianceId: null,
    selectedBarTopId: null,
    selectedWindowId: null,
    activeWallId: null,
    view: 'design',
    showDimensions: true,
    showDoors: true,

    setView: (v) => set({ view: v }),
    // Selecting one clears the other — the editor panel shows a single item.
    // Picking a cabinet also makes its wall the active one, so the next unit
    // you add lands on the wall you are actually looking at.
    select: (id) => {
      const cab = id ? get().project.cabinets.find((c) => c.id === id) : null;
      set({
        selectedCabinetId: id,
        selectedApplianceId: null,
        selectedBarTopId: null,
        selectedWindowId: null,
        ...(cab?.wallId ? { activeWallId: cab.wallId } : {}),
      });
    },
    selectAppliance: (id) =>
      set({
        selectedApplianceId: id,
        selectedCabinetId: null,
        selectedBarTopId: null,
        selectedWindowId: null,
      }),
    setActiveWall: (id) => set({ activeWallId: id }),
    toggleDimensions: () => set((s) => ({ showDimensions: !s.showDimensions })),
    toggleDoors: () => set((s) => ({ showDoors: !s.showDoors })),

    update: commit,
    setProject: (p) => {
      persist(p);
      set({ project: p, selectedCabinetId: null });
    },
    newProject: (name = 'New Project') => {
      const p = makeProject(name);
      persist(p);
      set({ project: p, selectedCabinetId: null, view: 'design' });
    },

    addCabinet: (presetKey) => {
      const preset = CABINET_PRESETS.find((p) => p.key === presetKey);
      if (!preset) return;
      let newId = '';
      commit((p) => {
        const base = makeCabinet(preset.type, p);
        const cab = preset.build(base, p.defaults);
        // A preset that hangs itself deliberately — the microwave bridge —
        // must not be re-aligned to the run afterwards.
        const presetSetHeight = cab.mountHeight !== base.mountHeight;
        cab.name = `${preset.label.split('—')[0].trim()} ${p.cabinets.filter((c) => c.type === preset.type).length + 1}`;
        // Drop the new cabinet at the end of its own run. Wall cabinets hang
        // above the base run, so they start their own line rather than
        // continuing past the end of the floor cabinets.
        // Add to whichever wall is active, at the end of that wall's run.
        const wallId = get().activeWallId ?? p.room.walls[0]?.id;
        const isUpper = preset.type === 'wall';
        cab.wallId = wallId;

        // Land after everything already in the run — appliances included, or
        // a new cabinet lands on top of the range you just placed.
        const start = wallId ? runStatus(p, wallId, isUpper).startsAt : 0;
        const runEnd = [
          ...p.cabinets
            .filter((c) => c.wallId === wallId && (c.type === 'wall') === isUpper && !c.excluded)
            .map((c) => (c.along ?? 0) + c.width),
          ...(p.appliances ?? [])
            .filter((a) => a.wallId === wallId && a.mountHeight >= 48 === isUpper)
            .map((a) => (a.along ?? 0) + a.width),
        ].reduce((a, b) => Math.max(a, b), start);
        cab.along = runEnd;

        // Hang wall cabinets so the run reads as one line across the top. A
        // short bridge cabinet lands high, level with its neighbours.
        if (cab.type === 'wall' && !presetSetHeight) {
          cab.mountHeight = wallMountHeight(cab.height, p.cabinets);
        }
        newId = cab.id;
        p.cabinets.push(cab);
        applyWallPlacements(p);
      });
      // The editor lives in the design view's right panel, so select the new
      // cabinet and make sure that view is the one on screen.
      set({ selectedCabinetId: newId, selectedApplianceId: null, view: 'design' });
    },

    duplicateCabinet: (id) => {
      let newId = '';
      commit((p) => {
        const src = p.cabinets.find((c) => c.id === id);
        if (!src) return;
        const copy: Cabinet = JSON.parse(JSON.stringify(src));
        copy.id = uid();
        copy.drawers = copy.drawers.map((d) => ({ ...d, id: uid() }));
        copy.name = `${src.name} (copy)`;
        copy.x = src.x + src.width;
        newId = copy.id;
        p.cabinets.push(copy);
      });
      if (newId) set({ selectedCabinetId: newId });
    },

    removeCabinet: (id) => {
      commit((p) => {
        p.cabinets = p.cabinets.filter((c) => c.id !== id);
      });
      if (get().selectedCabinetId === id) set({ selectedCabinetId: null });
    },

    updateCabinet: (id, patch) =>
      commit((p) => {
        const c = p.cabinets.find((x) => x.id === id);
        if (!c) return;
        const widthChanged = patch.width !== undefined && patch.width !== c.width;
        const wallChanged = patch.wallId !== undefined && patch.wallId !== c.wallId;
        // Height above the floor is the number that gets set on site — you
        // strike a level line and hang everything off it — so it stays put
        // when a cabinet is resized and the box grows upward from it.
        Object.assign(c, patch);

        // An apron owns the top of the face, which is exactly where a sink
        // base's false front sits. Switching to farmhouse drops it, or you
        // end up with a dummy drawer squeezed under the apron.
        if (c.sink?.style === 'farmhouse' && c.drawers.some((d) => d.falseFront)) {
          c.drawers = c.drawers.filter((d) => !d.falseFront);
        }

        // Resizing a cabinet has to move everything after it, or the run
        // silently overlaps. Same when a cabinet moves to a different wall.
        if (widthChanged || wallChanged) reflowRuns(p);
        else if (c.wallId) applyWallPlacements(p);
      }),

    autoArrange: () =>
      commit((p) => {
        reflowRuns(p);
      }),

    reorderCabinet: (id, toIndex) =>
      commit((p) => {
        const from = p.cabinets.findIndex((c) => c.id === id);
        if (from < 0) return;
        const clamped = Math.max(0, Math.min(p.cabinets.length - 1, toIndex));
        if (from === clamped) return;
        const [moved] = p.cabinets.splice(from, 1);
        p.cabinets.splice(clamped, 0, moved);

        // Distance along the wall is what orders a run, so nudge the moved
        // cabinet between its new neighbours before packing. Relying on array
        // order alone would ignore any appliance sitting in the run.
        const sameRun = p.cabinets.filter(
          (c) => c.wallId === moved.wallId && (c.type === 'wall') === (moved.type === 'wall') && !c.excluded,
        );
        const at = sameRun.indexOf(moved);
        const prev = sameRun[at - 1];
        const next = sameRun[at + 1];
        if (prev) moved.along = (prev.along ?? 0) + prev.width + 0.01;
        else if (next) moved.along = Math.max(0, (next.along ?? 0) - moved.width - 0.01);

        reflowRuns(p);
      }),

    fillRunWithFiller: (wallId, upper) =>
      commit((p) => {
        const status = runStatus(p, wallId, upper);
        if (status.remaining < 1 / 16) return;
        const run = p.cabinets.filter(
          (c) => c.wallId === wallId && !c.excluded && (c.type === 'wall') === upper,
        );
        const sample = run[run.length - 1];
        const filler = makeCabinet('filler', p, {
          name: `Filler ${snap16(status.remaining)}"`,
          width: snap16(status.remaining),
          height: sample?.height ?? (upper ? 30 : 34.5),
          depth: sample?.depth ?? (upper ? 12 : 24),
          mountHeight: sample?.mountHeight ?? (upper ? 54 : 0),
          wallId,
          doorCount: 0,
          shelfCount: 0,
          adjustableShelves: false,
        });
        // Sit it immediately after the last unit in this run.
        const lastIndex = p.cabinets.lastIndexOf(sample);
        if (lastIndex >= 0) p.cabinets.splice(lastIndex + 1, 0, filler);
        else p.cabinets.push(filler);
        reflowRuns(p);
      }),

    distributeRun: (wallId, upper) =>
      commit((p) => {
        const status = runStatus(p, wallId, upper);
        const run = p.cabinets.filter(
          (c) => c.wallId === wallId && !c.excluded && (c.type === 'wall') === upper && c.type !== 'filler',
        );
        if (run.length === 0 || status.remaining < 1 / 16) return;

        // Share the leftover out, giving the last unit the rounding remainder
        // so the run lands exactly on the wall rather than a sixteenth short.
        const each = snap16(status.remaining / run.length);
        let handed = 0;
        run.forEach((c, i) => {
          const add = i === run.length - 1 ? status.remaining - handed : each;
          c.width = snap16(c.width + add);
          handed += add;
        });
        reflowRuns(p);
      }),

    stretchLastInRun: (wallId, upper) =>
      commit((p) => {
        const status = runStatus(p, wallId, upper);
        const run = p.cabinets.filter(
          (c) => c.wallId === wallId && !c.excluded && (c.type === 'wall') === upper && c.type !== 'filler',
        );
        const last = run[run.length - 1];
        if (!last || status.remaining < 1 / 16) return;
        last.width = snap16(last.width + status.remaining);
        reflowRuns(p);
      }),

    alignWallTops: () =>
      commit((p) => {
        const run = p.cabinets.filter((c) => c.type === 'wall' && !c.excluded);
        if (run.length === 0) return;
        const top = Math.max(...run.map((c) => (c.mountHeight ?? 54) + c.height));
        for (const c of run) c.mountHeight = Math.max(0, top - c.height);
      }),

    addDrawer: (cabinetId, frontHeight = 6) =>
      commit((p) => {
        const c = p.cabinets.find((x) => x.id === cabinetId);
        if (c) c.drawers.push({ id: uid(), frontHeight });
      }),

    updateDrawer: (cabinetId, drawerId, patch) =>
      commit((p) => {
        const c = p.cabinets.find((x) => x.id === cabinetId);
        const d = c?.drawers.find((x) => x.id === drawerId);
        if (d) Object.assign(d, patch);
      }),

    removeDrawer: (cabinetId, drawerId) =>
      commit((p) => {
        const c = p.cabinets.find((x) => x.id === cabinetId);
        if (c) c.drawers = c.drawers.filter((d) => d.id !== drawerId);
      }),

    balanceDrawers: (cabinetId) =>
      commit((p) => {
        const c = p.cabinets.find((x) => x.id === cabinetId);
        if (!c || c.drawers.length === 0) return;
        const kick = c.type === 'wall' ? 0 : p.defaults.toeKickHeight;
        // Leave a usable door below when the cabinet has one.
        const doorReserve = c.doorCount > 0 ? Math.max(12, (c.height - kick) * 0.45) : 0;
        const fitted = fitDrawerHeights(c, p.defaults, c.drawers.map(() => 1), doorReserve);
        if (fitted.some((d) => d.frontHeight < 3)) return;
        // Keep the existing drawer ids so slide choices survive the rebalance.
        c.drawers = c.drawers.map((d, i) => ({ ...d, frontHeight: fitted[i].frontHeight }));
      }),

    updateView: (patch) =>
      commit((p) => {
        Object.assign(p.view, patch);
      }),
    applyViewPreset: (key) =>
      commit((p) => {
        const preset = VIEW_PRESETS.find((v) => v.key === key);
        if (preset) p.view = { ...preset.view };
      }),
    updateCrown: (patch) =>
      commit((p) => {
        Object.assign(p.crown, patch);
      }),
    updateLightRail: (patch) =>
      commit((p) => {
        Object.assign(p.lightRail, patch);
      }),

    moveItem: (kind, id, x, z) =>
      commit((p) => {
        // Quarter-inch grid: fine enough to butt cabinets, coarse enough that
        // dragging does not leave 0.03" gaps that show up in the cut list.
        const snap = (n: number) => Math.round(n * 4) / 4;

        const cab =
          kind === 'cabinet'
            ? p.cabinets.find((c) => c.id === id)
            : p.appliances.find((a) => a.id === id);
        if (!cab) return;
        const depth = 'depth' in cab ? cab.depth : 24;

        // Find the wall this drag lands nearest to, so a cabinet dragged
        // round a corner joins that wall's run instead of floating.
        const centre = roomCentre(p.room);
        let best: { wallId: string; along: number; dist: number } | null = null;
        for (const w of p.room.walls) {
          const frame = wallFrame(w, centre);
          const { along, offset } = projectOntoWall(frame, x, z);
          if (along < -cab.width || along > frame.length) continue;
          const dist = Math.abs(offset);
          if (!best || dist < best.dist) best = { wallId: w.id, along, dist };
        }

        // Within a cabinet depth of a wall counts as being on it.
        if (best && best.dist < Math.max(depth, 18)) {
          cab.wallId = best.wallId;
          cab.along = snap(Math.max(0, best.along));

          // Butt flush against a neighbour on the same wall and level.
          const isUpper = 'type' in cab ? cab.type === 'wall' : cab.mountHeight >= 48;
          const neighbours: { id: string; wallId?: string; along?: number; width: number; upper: boolean }[] = [
            ...p.cabinets
              .filter((o) => !o.excluded)
              .map((o) => ({ id: o.id, wallId: o.wallId, along: o.along, width: o.width, upper: o.type === 'wall' })),
            ...(p.appliances ?? []).map((o) => ({
              id: o.id,
              wallId: o.wallId,
              along: o.along,
              width: o.width,
              upper: o.mountHeight >= 48,
            })),
          ];
          for (const o of neighbours) {
            if (o.id === cab.id || o.wallId !== cab.wallId || o.upper !== isUpper) continue;
            const oa = o.along ?? 0;
            if (Math.abs(oa + o.width - cab.along) < 1.5) cab.along = oa + o.width;
            else if (Math.abs(oa - (cab.along + cab.width)) < 1.5) cab.along = oa - cab.width;
          }
          cab.along = Math.max(0, cab.along);
          applyWallPlacements(p);
        } else {
          // Dragged clear of every wall — an island. Position it freely.
          cab.wallId = undefined;
          cab.along = undefined;
          cab.x = snap(x);
          cab.z = snap(z);
        }
      }),

    updateDefaults: (patch) =>
      commit((p) => {
        Object.assign(p.defaults, patch);
      }),
    updateLabor: (patch) =>
      commit((p) => {
        Object.assign(p.labor, patch);
      }),
    updatePricing: (patch) =>
      commit((p) => {
        Object.assign(p.pricing, patch);
      }),
    updateMaterial: (id, patch) =>
      commit((p) => {
        const m = p.materials.find((x) => x.id === id);
        if (m) Object.assign(m, patch);
      }),
    updateHardwareCost: (id, cost) =>
      commit((p) => {
        const h = p.hardware.find((x) => x.id === id);
        if (h) h.cost = cost;
      }),

    addExtra: () =>
      commit((p) => {
        p.extras.push({ id: uid(), description: 'New line item', qty: 1, unitCost: 0, passThrough: false });
      }),
    updateExtra: (id, patch) =>
      commit((p) => {
        const e = p.extras.find((x) => x.id === id);
        if (e) Object.assign(e, patch);
      }),
    removeExtra: (id) =>
      commit((p) => {
        p.extras = p.extras.filter((e) => e.id !== id);
      }),

    toggleWallHidden: (id) =>
      commit((p) => {
        const w = p.room.walls.find((x) => x.id === id);
        if (w) w.hidden = !w.hidden;
      }),
    toggleBarTopHidden: (id) =>
      commit((p) => {
        const b = (p.barTops ?? []).find((x) => x.id === id);
        if (b) b.hidden = !b.hidden;
      }),
    showAllWalls: () =>
      commit((p) => {
        // The one "show everything again" control, so it clears bar walls too.
        for (const w of p.room.walls) w.hidden = false;
        for (const b of p.barTops ?? []) b.hidden = false;
      }),

    addWall: () =>
      commit((p) => {
        const last = p.room.walls[p.room.walls.length - 1];
        p.room.walls.push({
          id: uid(),
          x1: last?.x2 ?? 0,
          z1: last?.z2 ?? 0,
          x2: (last?.x2 ?? 0) + 96,
          z2: last?.z2 ?? 0,
          height: p.room.ceilingHeight,
          thickness: 4.5,
        });
      }),
    updateWall: (id, patch) =>
      commit((p) => {
        const w = p.room.walls.find((x) => x.id === id);
        if (w) Object.assign(w, patch);
      }),
    removeWall: (id) =>
      commit((p) => {
        p.room.walls = p.room.walls.filter((w) => w.id !== id);
      }),

    addAppliance: (presetKey) => {
      const preset = APPLIANCE_PRESETS.find((a) => a.key === presetKey);
      if (!preset) return;
      let newId = '';

      commit((p) => {
        const selected = p.cabinets.find((c) => c.id === get().selectedCabinetId);

        const app = makeAppliance(preset, 0, 0);
        const hangs = HANGS_UNDER_CABINET.has(preset.kind);

        /*
         * Always give the unit a wall and a place along it. Anything left
         * unassigned never takes part in packing, so it just sits wherever it
         * was dropped and happily overlaps a cabinet.
         */
        if (selected && hangs && selected.type === 'wall') {
          // A hood or over-range microwave hangs off the cabinet's underside.
          const bottom = selected.mountHeight ?? 54;
          app.mountHeight = Math.max(0, bottom - preset.height);
          app.wallId = selected.wallId;
          app.along =
            (selected.along ?? 0) + Math.max(0, (selected.width - preset.width) / 2);
        } else if (selected && selected.type !== 'wall') {
          // A floor unit needs its own bay, so it goes after that cabinet.
          app.mountHeight = preset.mountHeight;
          app.wallId = selected.wallId;
          app.along = (selected.along ?? 0) + selected.width;
        } else {
          // Nothing useful selected — land at the end of the active run.
          const wallId = selected?.wallId ?? get().activeWallId ?? p.room.walls[0]?.id;
          const isUpper = app.mountHeight >= 48;
          app.mountHeight = preset.mountHeight;
          app.wallId = wallId;
          app.along = [
            ...p.cabinets
              .filter((c) => c.wallId === wallId && (c.type === 'wall') === isUpper && !c.excluded)
              .map((c) => (c.along ?? 0) + c.width),
            ...(p.appliances ?? [])
              .filter((a) => a.wallId === wallId && a.mountHeight >= 48 === isUpper)
              .map((a) => (a.along ?? 0) + a.width),
          ].reduce((a, b) => Math.max(a, b), wallId ? runStatus(p, wallId, isUpper).startsAt : 0);
        }

        newId = app.id;
        p.appliances.push(app);
        reflowRuns(p);
      });

      if (newId) set({ selectedApplianceId: newId, selectedCabinetId: null });
    },
    updateAppliance: (id, patch) =>
      commit((p) => {
        const a = p.appliances.find((x) => x.id === id);
        if (!a) return;
        Object.assign(a, patch);
        // Moving it along the wall has to re-derive x/z or the unit edits in
        // the panel but stays put in the drawing.
        applyWallPlacements(p);
      }),
    removeAppliance: (id) =>
      commit((p) => {
        p.appliances = p.appliances.filter((a) => a.id !== id);
      }),

    addBarTop: () => {
      let newId = '';
      commit((p) => {
        const wallId = get().activeWallId ?? p.room.walls[0]?.id;
        /*
         * A bar goes behind an existing base run, so it starts life spanning
         * whatever is already on this wall rather than at an arbitrary spot.
         */
        const run = p.cabinets.filter(
          (c) => c.wallId === wallId && c.type !== 'wall' && !c.excluded,
        );
        const from = run.length ? Math.min(...run.map((c) => c.along ?? 0)) : 0;
        const to = run.length
          ? Math.max(...run.map((c) => (c.along ?? 0) + c.width))
          : from + 72;

        const bar = makeBarTop(p, {
          name: `Bar Top ${(p.barTops?.length ?? 0) + 1}`,
          wallId,
          along: from,
          length: Math.max(24, to - from),
        });
        newId = bar.id;
        p.barTops = [...(p.barTops ?? []), bar];
        applyWallPlacements(p);
      });
      if (newId) set({ selectedBarTopId: newId, selectedCabinetId: null, selectedApplianceId: null });
    },
    updateBarTop: (id, patch) =>
      commit((p) => {
        const b = (p.barTops ?? []).find((x) => x.id === id);
        if (!b) return;
        Object.assign(b, patch);
        applyWallPlacements(p);
      }),
    removeBarTop: (id) =>
      commit((p) => {
        p.barTops = (p.barTops ?? []).filter((b) => b.id !== id);
      }),
    selectBarTop: (id) =>
      set({
        selectedBarTopId: id,
        selectedCabinetId: null,
        selectedApplianceId: null,
        selectedWindowId: null,
      }),

    addWindow: () => {
      let newId = '';
      commit((p) => {
        const wallId = get().activeWallId ?? p.room.walls[0]?.id;
        if (!wallId) return;
        const wall = p.room.walls.find((w) => w.id === wallId);
        const wallLength = wall ? Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) : 96;

        const existing = (p.windows ?? []).filter((w) => w.wallId === wallId);
        const win = makeWindow(wallId, {
          name: `Window ${(p.windows?.length ?? 0) + 1}`,
          // Centre it on the wall, or sit it clear of the last one.
          along: existing.length
            ? Math.min(
                wallLength - 36,
                Math.max(...existing.map((w) => w.along + w.width)) + 12,
              )
            : Math.max(0, (wallLength - 36) / 2),
        });
        newId = win.id;
        p.windows = [...(p.windows ?? []), win];
      });
      if (newId) {
        set({
          selectedWindowId: newId,
          selectedCabinetId: null,
          selectedApplianceId: null,
          selectedBarTopId: null,
        });
      }
    },
    updateWindow: (id, patch) =>
      commit((p) => {
        const w = (p.windows ?? []).find((x) => x.id === id);
        // No placement pass: a window lives in wall coordinates only, so there
        // is no x/z to re-derive and nothing for a run to pack around.
        if (w) Object.assign(w, patch);
      }),
    removeWindow: (id) =>
      commit((p) => {
        p.windows = (p.windows ?? []).filter((w) => w.id !== id);
      }),
    selectWindow: (id) =>
      set({
        selectedWindowId: id,
        selectedCabinetId: null,
        selectedApplianceId: null,
        selectedBarTopId: null,
      }),

    stackCabinetAbove: (applianceId) => {
      let newId = '';
      commit((p) => {
        const app = p.appliances.find((a) => a.id === applianceId);
        if (!app) return;

        const bottom = app.mountHeight + app.height;
        // Fill from the top of the appliance up to the line the wall run tops
        // out on, so the fronts stay flush across the whole run. Never run
        // past the ceiling, whatever the run says.
        const run = p.cabinets.filter((c) => c.type === 'wall' && !c.excluded);
        const runTop = run.length
          ? Math.max(...run.map((c) => (c.mountHeight ?? 54) + c.height))
          : DEFAULT_WALL_TOP;
        const ceiling = p.room.ceilingHeight || 96;
        const height = Math.max(6, Math.round((Math.min(runTop, ceiling) - bottom) * 16) / 16);

        const cab = makeCabinet('wall', p, {
          name: `Cabinet over ${app.name.split(' ')[0]}`,
          width: app.width,
          height,
          depth: Math.max(12, Math.min(app.depth, 15)),
          // Inherit the appliance's wall and position along it. Setting only
          // x/z left it unassigned, and re-flow then packed it at the origin
          // of the free-standing run — which looked like it had jumped walls.
          wallId: app.wallId,
          along: app.along,
          x: app.x,
          z: app.z,
          rotation: app.rotation,
          mountHeight: bottom,
          doorCount: 2,
          shelfCount: 0,
          adjustableShelves: false,
          // Rides on the appliance, so it follows wherever that ends up.
          overAppliance: app.id,
          notes: `Sits on the ${app.name}. Verify the appliance's required clearance above.`,
        });
        newId = cab.id;
        p.cabinets.push(cab);
        applyWallPlacements(p);
      });
      if (newId) set({ selectedCabinetId: newId, selectedApplianceId: null, view: 'design' });
    },

    applyRoomShape: (shape, width, depth) =>
      commit((p) => {
        p.room = makeRoom(shape, width ?? 168, depth ?? 144, p.room.ceilingHeight);
      }),

    saveJob: () => {
      const p = get().project;
      const jobs = readJobs();
      jobs[p.id] = { savedAt: new Date().toISOString(), data: p };
      return writeJobs(jobs);
    },

    listJobs: () =>
      Object.values(readJobs())
        .map(({ savedAt, data }) => {
          const lf = data.cabinets
            .filter((c) => !c.excluded)
            .reduce((a, c) => a + c.width / 12, 0);
          let total = 0;
          try {
            total = computeEstimate(migrateProject(data)).clientTotal;
          } catch {
            total = 0;
          }
          return {
            id: data.id,
            name: data.name,
            client: data.client,
            updatedAt: savedAt,
            cabinetCount: data.cabinets.filter((c) => !c.excluded).length,
            linearFeet: lf,
            clientTotal: total,
          };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),

    openJob: (id) => {
      const entry = readJobs()[id];
      if (!entry) return null;
      // Save whatever is open first so switching jobs never loses work. If that
      // save fails, stay put rather than switching away over the top of it.
      const failed = get().saveJob();
      if (failed) return failed;
      const migrated = migrateProject(entry.data);
      persist(migrated);
      set({ project: migrated, selectedCabinetId: null, view: 'design' });
      return null;
    },

    deleteJob: (id) => {
      const jobs = readJobs();
      delete jobs[id];
      return writeJobs(jobs);
    },

    newJob: (name, client) => {
      const failed = get().saveJob();
      if (failed) return failed;
      const p = makeProject(name || 'New Project');
      p.client = client;
      persist(p);
      set({ project: p, selectedCabinetId: null, view: 'design' });
      return null;
    },

    duplicateJob: (id) => {
      const entry = readJobs()[id];
      if (!entry) return null;
      const copy: Project = JSON.parse(JSON.stringify(migrateProject(entry.data)));
      copy.id = uid();
      copy.name = `${copy.name} (copy)`;
      const jobs = readJobs();
      jobs[copy.id] = { savedAt: new Date().toISOString(), data: copy };
      return writeJobs(jobs);
    },

    exportJson: () => JSON.stringify(get().project, null, 2),
    importJson: (json) => {
      try {
        const parsed = JSON.parse(json) as unknown;
        if (!looksLikeProject(parsed)) {
          return 'That file is not a Cabinetry project — it has no cabinet list.';
        }
        const migrated = migrateProject(parsed);
        if (!migrated.id) migrated.id = uid();
        persist(migrated);
        set({ project: migrated, selectedCabinetId: null, view: 'design' });
        return null;
      } catch (e) {
        return `Could not read that file: ${(e as Error).message}`;
      }
    },
  };
});

/**
 * Pack every run, treating cabinets and appliances as one sequence.
 *
 * A range standing between two cabinets is part of that run, so widening the
 * cabinet before it must push it along rather than make the cabinet jump past
 * it. Order comes from each member's current distance along the wall, which
 * keeps what you see on screen and what gets packed in step.
 */
function reflowRuns(p: Project) {
  interface Member {
    along: number;
    width: number;
    /** Held in place — a pinned bridge — so the rest packs around it. */
    fixed: boolean;
    apply: (at: number) => void;
  }

  const runs = new Map<string, Member[]>();
  const push = (key: string, m: Member) => {
    const list = runs.get(key) ?? [];
    list.push(m);
    runs.set(key, list);
  };

  for (const c of p.cabinets) {
    if (c.excluded) continue;
    const upper = c.type === 'wall';
    const key = `${c.wallId ?? 'free'}|${upper ? 'upper' : 'lower'}`;
    push(key, {
      along: c.wallId ? (c.along ?? 0) : c.x,
      width: c.width,
      // Pinned cabinets hold their spot; ones riding an appliance are placed
      // afterwards from whatever that appliance ended up at.
      fixed: !!c.wallId && (!!c.pinned || !!c.overAppliance),
      apply: (at) => {
        if (c.wallId) {
          c.along = at;
        } else {
          c.x = at;
          c.z = 0;
          c.rotation = 0;
        }
      },
    });
  }

  for (const a of p.appliances ?? []) {
    if (!a.wallId) continue;
    // Anything hanging above the counter belongs to the upper run.
    const upper = a.mountHeight >= 48;
    push(`${a.wallId}|${upper ? 'upper' : 'lower'}`, {
      along: a.along ?? 0,
      width: a.width,
      // A hood or microwave is positioned against a cabinet, not packed. Any
      // unit can also be pinned by hand — a range centred on a window.
      fixed: upper || !!a.pinned,
      apply: (at) => {
        a.along = at;
      },
    });
  }

  for (const [key, members] of runs) {
    const wallId = key.split('|')[0];
    const upper = key.endsWith('upper');
    const start = wallId !== 'free' ? runStatus(p, wallId, upper).startsAt : 0;

    // Current position sets the order, so the run keeps the sequence you see.
    members.sort((m, n) => m.along - n.along);

    let at = start;
    for (const m of members) {
      if (m.fixed) {
        // Held members keep their place and the cursor jumps past them.
        at = Math.max(at, m.along + m.width);
        continue;
      }
      m.apply(at);
      at += m.width;
    }
  }

  // Anything riding on an appliance takes its wall and position from that
  // unit, once the run has been packed and the appliance has settled.
  for (const c of p.cabinets) {
    if (!c.overAppliance) continue;
    const app = (p.appliances ?? []).find((a) => a.id === c.overAppliance);
    if (!app) continue;
    c.wallId = app.wallId;
    c.along = app.along;
  }

  applyWallPlacements(p);
}

type JobStore = Record<string, { savedAt: string; data: Project }>;

function readJobs(): JobStore {
  try {
    return JSON.parse(localStorage.getItem(LIST_KEY) ?? '{}') as JobStore;
  } catch {
    return {};
  }
}

/**
 * Write the job library back to storage.
 *
 * Unlike the autosave in `persist`, a failure here cannot be swallowed. Saving
 * a job is a deliberate act, and the whole library lives under one key, so a
 * shop with a few dozen jobs can genuinely run the browser out of room. Told
 * nothing, they would carry on believing the work is safely filed away.
 */
function writeJobs(jobs: JobStore): string | null {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(jobs));
    return null;
  } catch (e) {
    const err = e as Error;
    if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return 'Browser storage is full, so nothing was saved. Export a job to a file, then delete it from the library to free up room.';
    }
    return `Could not save the job library: ${err.message}`;
  }
}

export const useSelectedCabinet = () =>
  useProject((s) => s.project.cabinets.find((c) => c.id === s.selectedCabinetId) ?? null);

export const useSelectedAppliance = () =>
  useProject((s) => s.project.appliances.find((a) => a.id === s.selectedApplianceId) ?? null);

export const useSelectedBarTop = () =>
  useProject((s) => (s.project.barTops ?? []).find((b) => b.id === s.selectedBarTopId) ?? null);

export const useSelectedWindow = () =>
  useProject((s) => (s.project.windows ?? []).find((w) => w.id === s.selectedWindowId) ?? null);
