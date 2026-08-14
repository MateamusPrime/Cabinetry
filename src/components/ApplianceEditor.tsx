import type { Appliance, Project } from '../domain/types';
import { useProject } from '../store/useProject';
import { DimInput, Field, NumInput, Select, Toggle } from './Inputs';
import { formatFrac } from '../domain/units';
import { overlapsInPlan } from '../domain/geometry';

/**
 * Appliances need the same treatment as cabinets: a real editor. Height above
 * the floor is the one that matters most, because that is how a microwave and
 * the cabinet over it get stacked.
 */
export function ApplianceEditor({ appliance, project }: { appliance: Appliance; project: Project }) {
  const update = useProject((s) => s.updateAppliance);
  const remove = useProject((s) => s.removeAppliance);
  const stackAbove = useProject((s) => s.stackCabinetAbove);
  const set = (patch: Partial<Appliance>) => update(appliance.id, patch);

  const top = appliance.mountHeight + appliance.height;

  // Anything sharing this appliance's column, so the stack reads at a glance.
  const column = [...project.cabinets]
    .filter((c) => !c.excluded && overlapsInPlan(c, appliance))
    .map((c) => ({
      name: c.name,
      bottom: c.mountHeight ?? (c.type === 'wall' ? 54 : 0),
      top: (c.mountHeight ?? (c.type === 'wall' ? 54 : 0)) + c.height,
    }))
    .concat([{ name: `${appliance.name} (this)`, bottom: appliance.mountHeight, top }])
    .sort((a, b) => b.bottom - a.bottom);

  return (
    <div className="stack">
      <input value={appliance.name} onChange={(e) => set({ name: e.target.value })} style={{ fontWeight: 600 }} />

      <div className="section-title">Size</div>
      <div className="row">
        <Field label="Width">
          <DimInput value={appliance.width} onChange={(n) => set({ width: n })} />
        </Field>
        <Field label="Height">
          <DimInput value={appliance.height} onChange={(n) => set({ height: n })} />
        </Field>
        <Field label="Depth">
          <DimInput value={appliance.depth} onChange={(n) => set({ depth: n })} />
        </Field>
      </div>
      <div className="alert info" style={{ fontSize: 11 }}>
        These are nominal sizes. Check the model's spec sheet before cutting the opening — a rough opening a
        quarter inch tight is a rebuild.
      </div>

      <div className="section-title">Position</div>
      {appliance.wallId ? (
        <>
          {/*
            Distance along the wall is the source of truth for anything in a
            run — x and z are derived from it — so editing those directly
            would just be undone on the next placement pass.
          */}
          <Field label="Along wall" hint="Measured from the wall's starting corner to this unit's left edge.">
            <DimInput value={appliance.along ?? 0} onChange={(n) => set({ along: n })} />
          </Field>
          <Toggle
            label="Hold position when re-flowing"
            checked={!!appliance.pinned}
            onChange={(b) => set({ pinned: b })}
          />
          <div className="field-hint">
            {appliance.pinned
              ? 'Pinned. Cabinets pack around it rather than pushing it along.'
              : 'Packs into the run with everything else. Pin it if it has to stay put — a range centred on a window.'}
          </div>
        </>
      ) : (
        <div className="row">
          <Field label="X">
            <DimInput value={appliance.x} onChange={(n) => set({ x: n })} />
          </Field>
          <Field label="Z">
            <DimInput value={appliance.z} onChange={(n) => set({ z: n })} />
          </Field>
          <Field label="Rotation">
            <NumInput value={appliance.rotation} onChange={(n) => set({ rotation: n })} step={15} suffix="°" />
          </Field>
        </div>
      )}
      <Field
        label="Height above floor"
        hint={`Bottom at ${formatFrac(appliance.mountHeight)}", top at ${formatFrac(top)}".`}
      >
        <DimInput value={appliance.mountHeight} onChange={(n) => set({ mountHeight: n })} />
      </Field>

      <div className="row">
        <button className="sm" onClick={() => set({ mountHeight: 0 })} title="Sit it on the floor">
          On floor
        </button>
        <button className="sm" onClick={() => set({ mountHeight: 66 })} title="Standard over-range clearance">
          Over range (66")
        </button>
      </div>

      <div className="section-title">Stack a Cabinet Above</div>
      <div className="field-hint" style={{ marginBottom: 6 }}>
        Adds a wall cabinet sitting directly on top of this unit, filling the gap up to the wall run.
      </div>
      <button onClick={() => stackAbove(appliance.id)}>Add cabinet above this appliance</button>

      {column.length > 1 && (
        <>
          <div className="section-title">This Column</div>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Bottom</th>
                <th className="num">Top</th>
              </tr>
            </thead>
            <tbody>
              {column.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td className="num">{formatFrac(c.bottom)}"</td>
                  <td className="num">{formatFrac(c.top)}"</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="section-title">Panels</div>
      <Toggle
        label="Panel ready (takes custom door panels)"
        checked={!!appliance.panelReady}
        onChange={(b) => set({ panelReady: b, panelCount: appliance.panelCount ?? 1 })}
      />
      {appliance.panelReady && (
        <Field label="Number of panels" hint="A French-door refrigerator takes two.">
          <Select
            value={String(appliance.panelCount ?? 1) as '1' | '2'}
            onChange={(v) => set({ panelCount: Number(v) })}
            options={[
              { value: '1', label: '1 panel' },
              { value: '2', label: '2 panels' },
            ]}
          />
        </Field>
      )}

      <div className="section-title">Notes</div>
      <textarea rows={2} value={appliance.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />

      <button className="danger" style={{ marginTop: 10 }} onClick={() => remove(appliance.id)}>
        Delete appliance
      </button>
    </div>
  );
}
