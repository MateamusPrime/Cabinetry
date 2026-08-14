import type { BarTop, PanelStyle, Project } from '../domain/types';
import { useProject } from '../store/useProject';
import { DimInput, Field, NumInput, Select, Toggle } from './Inputs';
import { PANEL_STYLE_OPTIONS } from './CabinetEditor';
import { barTopSlabSize, generateBarTopParts } from '../domain/partsGenerator';
import { formatFrac } from '../domain/units';

/**
 * Editor for a raised bar.
 *
 * The overhangs are the numbers that matter here: the front one is knee room
 * and decides whether a stool fits, and the end ones are what make a bar read
 * as a finished piece rather than a slab cut flush with its wall.
 */
export function BarTopEditor({ bar, project }: { bar: BarTop; project: Project }) {
  const update = useProject((s) => s.updateBarTop);
  const remove = useProject((s) => s.removeBarTop);
  const set = (patch: Partial<BarTop>) => update(bar.id, patch);

  const slab = barTopSlabSize(bar);
  const { warnings } = generateBarTopParts(bar, project);
  const counterHeight = 36;

  return (
    <div className="stack">
      <input value={bar.name} onChange={(e) => set({ name: e.target.value })} style={{ fontWeight: 600 }} />

      <div className="section-title">Wall</div>
      <div className="row">
        <Field label="Length">
          <DimInput value={bar.length} onChange={(n) => set({ length: n })} />
        </Field>
        <Field label="Height" hint={`${formatFrac(Math.max(0, bar.wallHeight - counterHeight))}" above a 36" counter.`}>
          <DimInput value={bar.wallHeight} onChange={(n) => set({ wallHeight: n })} />
        </Field>
        <Field label="Thickness">
          <DimInput value={bar.thickness} onChange={(n) => set({ thickness: n })} />
        </Field>
      </div>

      <div className="row">
        <button className="sm" onClick={() => set({ wallHeight: 42 })} title="Standard bar height">
          42" bar
        </button>
        <button className="sm" onClick={() => set({ wallHeight: 36 })} title="Flush with the counter">
          36" flush
        </button>
      </div>

      <Field
        label="Stand-off from wall line"
        hint="Push the wall out to clear a run deeper than standard. The bar is built out from the wall line on the seating side."
      >
        <DimInput value={bar.offset} onChange={(n) => set({ offset: n })} />
      </Field>

      <div className="section-title">Position</div>
      {bar.wallId ? (
        <Field label="Along wall" hint="From the wall's starting corner to the left end of the pony wall.">
          <DimInput value={bar.along ?? 0} onChange={(n) => set({ along: n })} />
        </Field>
      ) : (
        <div className="row">
          <Field label="X">
            <DimInput value={bar.x} onChange={(n) => set({ x: n })} />
          </Field>
          <Field label="Z">
            <DimInput value={bar.z} onChange={(n) => set({ z: n })} />
          </Field>
          <Field label="Rotation">
            <NumInput value={bar.rotation} onChange={(n) => set({ rotation: n })} step={15} suffix="°" />
          </Field>
        </div>
      )}

      <div className="section-title">Countertop Overhang</div>
      <div className="row">
        <Field label="Front (knee room)" hint="12&quot; minimum for seating, 15&quot; is comfortable.">
          <DimInput value={bar.overhangFront} onChange={(n) => set({ overhangFront: n })} />
        </Field>
        <Field label="Back" hint="Over the cabinets behind.">
          <DimInput value={bar.overhangBack} onChange={(n) => set({ overhangBack: n })} />
        </Field>
      </div>
      <div className="row">
        <Field label="Left end">
          <DimInput value={bar.overhangLeft} onChange={(n) => set({ overhangLeft: n })} />
        </Field>
        <Field label="Right end">
          <DimInput value={bar.overhangRight} onChange={(n) => set({ overhangRight: n })} />
        </Field>
        <Field label="Slab thickness">
          <DimInput value={bar.topThickness} onChange={(n) => set({ topThickness: n })} />
        </Field>
      </div>
      <div className="row">
        <button
          className="sm"
          onClick={() => set({ overhangLeft: 1.5, overhangRight: 1.5 })}
          title="Return the slab past both ends of the wall"
        >
          1-1/2&quot; both ends
        </button>
        <button className="sm" onClick={() => set({ overhangLeft: 0, overhangRight: 0 })}>
          Flush ends
        </button>
      </div>

      <div className="alert info" style={{ fontSize: 11 }}>
        Slab cuts at <strong>{formatFrac(slab.length)}&quot; &times; {formatFrac(slab.depth)}&quot;</strong>, sitting
        at {formatFrac(bar.wallHeight)}&quot; off the floor. Price the top itself as an extra, the same as the rest of
        the counters.
      </div>

      <div className="section-title">Seating Side</div>
      {/*
        What it is comes before what it looks like: choosing a painted wall
        settles that nobody in this shop builds it, so the panel question is
        already answered.
      */}
      <Field
        label="Finished as"
        hint="A clad bar is cabinetry and gets cut. A plastered wall is somebody else's work and contributes no parts."
      >
        <Select
          value={bar.finish ?? 'cabinet'}
          onChange={(v) =>
            set(
              v === 'wall'
                ? { finish: 'wall', panelStyle: 'none' }
                : {
                    finish: v as BarTop['finish'],
                    // Coming back from a painted wall, give it a panel again.
                    panelStyle: bar.panelStyle === 'none' ? 'shaker' : bar.panelStyle,
                  },
            )
          }
          options={[
            { value: 'wall', label: 'Painted wall — built by others' },
            { value: 'cabinet', label: 'Cabinetry — matches the doors' },
            { value: 'custom', label: 'Its own colour' },
          ]}
        />
      </Field>

      <Field label="Panel style" hint="What the room sees. Matches the door styles.">
        <Select
          value={bar.panelStyle ?? 'slab'}
          onChange={(v) => set({ panelStyle: v as PanelStyle | 'none' })}
          options={[
            { value: 'none', label: 'None — no parts, built by others' },
            ...PANEL_STYLE_OPTIONS,
          ]}
        />
      </Field>
      {(bar.panelStyle ?? 'slab') === 'none' && (
        <div className="field-hint">
          This wall contributes nothing to the cut list. The countertop on top of it is still priced as an extra,
          the same as every other counter.
        </div>
      )}
      {bar.finish === 'custom' && (
        <label className="field">
          <span>Colour</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="color"
              value={bar.finishColor ?? project.view.wallColor}
              onChange={(e) => set({ finishColor: e.target.value })}
              style={{ width: 34, height: 28, padding: 2, flex: '0 0 auto' }}
            />
            <span className="dim-text mono" style={{ fontSize: 11 }}>
              {bar.finishColor ?? project.view.wallColor}
            </span>
          </div>
        </label>
      )}

      {warnings.map((w) => (
        <div className="alert warn" key={w} style={{ fontSize: 11 }}>
          {w}
        </div>
      ))}

      <div className="section-title">Visibility</div>
      <Toggle
        label="Hide in the 3D view"
        checked={!!bar.hidden}
        onChange={(b) => set({ hidden: b })}
      />
      <div className="field-hint">
        Visual only — a hidden bar still cuts its parts and prices the same. Use the exclude switch below to take
        it out of the numbers.
      </div>

      <div className="section-title">Estimate</div>
      <Toggle
        label="Exclude from the estimate"
        checked={!!bar.excluded}
        onChange={(b) => set({ excluded: b })}
      />

      <button className="sm danger" onClick={() => remove(bar.id)} style={{ marginTop: 8 }}>
        Delete bar top
      </button>
    </div>
  );
}
