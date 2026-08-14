import type { Project, WindowOpening } from '../domain/types';
import { useProject } from '../store/useProject';
import { DimInput, Field, Select, Toggle } from './Inputs';
import { formatFrac } from '../domain/units';

/**
 * Editor for an opening cut through a wall.
 *
 * A window is not part of any run, so there is nothing here about packing or
 * re-flowing: it holds the spot you put it in and the cabinets neither move it
 * nor move around it.
 */
export function WindowEditor({ window: win, project }: { window: WindowOpening; project: Project }) {
  const update = useProject((s) => s.updateWindow);
  const remove = useProject((s) => s.removeWindow);
  const set = (patch: Partial<WindowOpening>) => update(win.id, patch);

  const wall = project.room.walls.find((w) => w.id === win.wallId);
  const wallLength = wall ? Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1) : 0;
  const wallIndex = project.room.walls.findIndex((w) => w.id === win.wallId);
  const head = win.sillHeight + win.height;

  const pastEnd = win.along + win.width > wallLength + 1 / 32;
  const pastTop = wall ? head > wall.height + 1 / 32 : false;

  return (
    <div className="stack">
      <input value={win.name} onChange={(e) => set({ name: e.target.value })} style={{ fontWeight: 600 }} />

      <div className="section-title">Wall</div>
      <Field label="Cut through" hint="Openings move with their wall; they are not part of any run.">
        <Select
          value={win.wallId}
          onChange={(v) => set({ wallId: v })}
          options={project.room.walls.map((w, i) => ({
            value: w.id,
            label: `Wall ${i + 1} — ${formatFrac(Math.hypot(w.x2 - w.x1, w.z2 - w.z1))}"`,
          }))}
        />
      </Field>

      <div className="section-title">Rough Opening</div>
      <div className="row">
        <Field label="Width">
          <DimInput value={win.width} onChange={(n) => set({ width: Math.max(1, n) })} />
        </Field>
        <Field label="Height">
          <DimInput value={win.height} onChange={(n) => set({ height: Math.max(1, n) })} />
        </Field>
      </div>

      <div className="section-title">Position</div>
      <Field
        label="Along wall"
        hint={`From the start of wall ${wallIndex + 1} to the left edge. Wall is ${formatFrac(wallLength)}" long.`}
      >
        <DimInput value={win.along} onChange={(n) => set({ along: Math.max(0, n) })} />
      </Field>
      <Field label="Sill height" hint={`Head lands at ${formatFrac(head)}" off the floor.`}>
        <DimInput value={win.sillHeight} onChange={(n) => set({ sillHeight: Math.max(0, n) })} />
      </Field>

      <div className="row">
        <button
          className="sm"
          onClick={() => set({ along: Math.max(0, (wallLength - win.width) / 2) })}
          title="Centre it on the wall"
        >
          Centre on wall
        </button>
        <button className="sm" onClick={() => set({ sillHeight: 42 })} title="Clears a 36&quot; counter and backsplash">
          Sill at 42"
        </button>
      </div>

      {pastEnd && (
        <div className="alert warn" style={{ fontSize: 11 }}>
          This opening runs {formatFrac(win.along + win.width - wallLength)}" past the end of the wall.
        </div>
      )}
      {pastTop && (
        <div className="alert warn" style={{ fontSize: 11 }}>
          The head is {formatFrac(head - (wall?.height ?? 0))}" above the top of the wall.
        </div>
      )}

      <div className="section-title">Trim</div>
      <Field label="Casing width" hint="Cosmetic — shown around the opening in the 3D view.">
        <DimInput value={win.casingWidth} onChange={(n) => set({ casingWidth: Math.max(0, n) })} />
      </Field>

      <div className="section-title">Visibility</div>
      <Toggle label="Hide in the 3D view" checked={!!win.hidden} onChange={(b) => set({ hidden: b })} />
      <div className="field-hint">
        Hiding it closes the opening back up in the drawing. Windows never affect the cut list or the estimate
        either way.
      </div>

      <button className="sm danger" onClick={() => remove(win.id)} style={{ marginTop: 8 }}>
        Delete window
      </button>
    </div>
  );
}
