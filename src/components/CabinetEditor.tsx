import type { Cabinet, Material, PanelStyle, Project } from '../domain/types';
import { useProject } from '../store/useProject';
import { DimInput, Field, NumInput, Select, Toggle } from './Inputs';
import { CabinetElevation } from './Elevation';
import {
  boxWidth,
  computeFaceLayout,
  crownContext,
  frameOverhangs,
  frontalWidth,
  generateCabinetParts,
  specFor,
} from '../domain/partsGenerator';
import { formatFrac, formatIn } from '../domain/units';
import { isEdgeband, isLumber, isSheet } from '../domain/materials';
import { bridgeBottomForMicrowave } from '../domain/defaults';

/** Shared by finished ends, finished backs and bar walls so they read alike. */
export const PANEL_STYLE_OPTIONS: { value: PanelStyle; label: string }[] = [
  { value: 'slab', label: 'Slab — one flat sheet' },
  { value: 'shaker', label: 'Shaker — flat field in a frame' },
  { value: 'raised', label: 'Raised panel' },
  { value: 'beadboard', label: 'Beadboard' },
];

function materialOptions(materials: Material[], kinds: ('sheet' | 'lumber' | 'edgeband')[]) {
  return materials
    .filter((m) => kinds.includes(m.kind))
    .map((m) => ({ value: m.id, label: m.name }));
}

export function CabinetEditor({ cabinet, project }: { cabinet: Cabinet; project: Project }) {
  const updateCabinet = useProject((s) => s.updateCabinet);
  const addDrawer = useProject((s) => s.addDrawer);
  const updateDrawer = useProject((s) => s.updateDrawer);
  const removeDrawer = useProject((s) => s.removeDrawer);
  const balanceDrawers = useProject((s) => s.balanceDrawers);
  const duplicateCabinet = useProject((s) => s.duplicateCabinet);
  const removeCabinet = useProject((s) => s.removeCabinet);

  const set = (patch: Partial<Cabinet>) => updateCabinet(cabinet.id, patch);
  const spec = specFor(cabinet, project.defaults);
  const layout = computeFaceLayout(cabinet, spec, project.materials, crownContext(cabinet, project));
  const { parts, warnings } = generateCabinetParts(cabinet, project);

  const sheetOpts = materialOptions(project.materials, ['sheet']);
  const faceOpts = materialOptions(project.materials, ['sheet', 'lumber']);
  const ebOpts = materialOptions(project.materials, ['edgeband']);

  const doorOpening = layout.openings.find((o) => o.kind === 'door');

  return (
    <div className="stack">
      <div className="between">
        <input
          value={cabinet.name}
          onChange={(e) => set({ name: e.target.value })}
          style={{ fontWeight: 600, fontSize: 13 }}
        />
      </div>

      <CabinetElevation cabinet={cabinet} project={project} width={300} />

      {warnings.length > 0 && (
        <div className="alert warn">
          <strong>Check this cabinet</strong>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w.replace(`${cabinet.name}: `, '')}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="section-title">Size &amp; Position</div>
      <div className="row">
        <Field label="Width">
          <DimInput value={cabinet.width} onChange={(n) => set({ width: n })} />
        </Field>
        <Field label="Height">
          <DimInput value={cabinet.height} onChange={(n) => set({ height: n })} />
        </Field>
        <Field label="Depth">
          <DimInput value={cabinet.depth} onChange={(n) => set({ depth: n })} />
        </Field>
      </div>
      <Field label="Mounted on" hint="Cabinets on a wall follow it automatically; free-standing ones are positioned by hand.">
        <select
          value={cabinet.wallId ?? ''}
          onChange={(e) => set({ wallId: e.target.value || undefined })}
        >
          {project.room.walls.map((w, i) => (
            <option key={w.id} value={w.id}>
              Wall {i + 1} ({formatFrac(Math.hypot(w.x2 - w.x1, w.z2 - w.z1))}")
            </option>
          ))}
          <option value="">Free-standing (island)</option>
        </select>
      </Field>

      {cabinet.wallId ? (
        <>
          <Field label="Distance along the wall" hint="Measured from the wall's starting corner to this cabinet's left edge.">
            <DimInput value={cabinet.along ?? 0} onChange={(n) => set({ along: n })} />
          </Field>
          <Toggle
            label="Hold this position when re-flowing"
            checked={!!cabinet.pinned}
            onChange={(b) => set({ pinned: b })}
          />
          <div className="field-hint" style={{ marginBottom: 8 }}>
            Anything sitting over an appliance is held automatically, so a microwave bridge stays with its range.
          </div>
        </>
      ) : (
        <div className="row">
          <Field label="X">
            <DimInput value={cabinet.x} onChange={(n) => set({ x: n })} />
          </Field>
          <Field label="Z">
            <DimInput value={cabinet.z} onChange={(n) => set({ z: n })} />
          </Field>
          <Field label="Rotation">
            <NumInput value={cabinet.rotation} onChange={(n) => set({ rotation: n })} step={15} suffix="°" />
          </Field>
        </div>
      )}
      {cabinet.type === 'wall' && (
        <div className="field-hint" style={{ marginTop: -4, marginBottom: 8 }}>
          Installed height holds — a taller box grows upward. Currently{' '}
          <span className="mono">
            {formatFrac(cabinet.mountHeight ?? 54)}" to {formatFrac((cabinet.mountHeight ?? 54) + cabinet.height)}"
          </span>
          .
        </div>
      )}
      <Field
        label="Mount height (bottom above floor)"
        hint={cabinet.type === 'wall' ? '54" gives 18" of backsplash over a 36" counter.' : undefined}
      >
        <DimInput value={cabinet.mountHeight ?? 0} onChange={(n) => set({ mountHeight: n })} />
      </Field>
      {cabinet.type === 'wall' && (
        <button
          className="sm"
          style={{ marginBottom: 8 }}
          onClick={() => set({ mountHeight: bridgeBottomForMicrowave() })}
          title="Clearance over a 36in range plus the height of a typical over-range microwave"
        >
          Hang for a microwave ({formatFrac(bridgeBottomForMicrowave())}")
        </button>
      )}

      <div className="section-title">Construction</div>
      <Field label="Type">
        <Select
          value={cabinet.type}
          onChange={(v) => set({ type: v })}
          options={[
            { value: 'base', label: 'Base' },
            { value: 'wall', label: 'Wall' },
            { value: 'tall', label: 'Tall' },
            { value: 'vanity', label: 'Vanity' },
          ]}
        />
      </Field>
      <div className="row">
        <Field label="Style">
          <Select
            value={cabinet.construction ?? project.defaults.construction}
            onChange={(v) => set({ construction: v })}
            options={[
              { value: 'frameless', label: 'Frameless' },
              { value: 'faceFrame', label: 'Face Frame' },
            ]}
          />
        </Field>
        <Field label="Door mount">
          <Select
            value={cabinet.doorMount ?? project.defaults.doorMount}
            onChange={(v) => set({ doorMount: v })}
            options={[
              { value: 'fullOverlay', label: 'Full Overlay' },
              { value: 'halfOverlay', label: 'Half Overlay' },
              { value: 'inset', label: 'Inset' },
            ]}
          />
        </Field>
      </div>

      {spec.construction === 'faceFrame' && (
        <>
          <Field
            label="Frame overhang past the box"
            hint="Per side, on buried sides only. The frame stays the cabinet's nominal width and the box is narrowed behind it, so the run measurement never changes."
          >
            <DimInput
              value={cabinet.frameOverhang ?? project.defaults.frameOverhang}
              onChange={(n) => set({ frameOverhang: Math.max(0, n) })}
            />
          </Field>
          {(() => {
            const oh = frameOverhangs(cabinet, spec, project);
            const bw = boxWidth(cabinet, spec, project);
            const exposed = [
              oh.left === 0 ? 'left' : null,
              oh.right === 0 ? 'right' : null,
            ].filter(Boolean);
            return (
              <div className="field-hint">
                Frame {formatFrac(cabinet.width)}" wide, box cut to{' '}
                <strong>{formatFrac(bw)}"</strong>.{' '}
                {exposed.length === 2
                  ? 'Both sides are exposed, so the box runs full width.'
                  : exposed.length === 1
                    ? `The ${exposed[0]} side is exposed, so it takes no overhang there.`
                    : 'Both sides are buried, so the frame covers the joint each way.'}
              </div>
            );
          })()}
        </>
      )}

      {cabinet.type !== 'wall' && cabinet.type !== 'filler' && (
        <>
          <div className="section-title">Sink</div>
          <Field label="Sink in this cabinet" hint="Sits in the countertop and follows the cabinet — it takes no extra run length.">
            <Select
              value={cabinet.sink?.style ?? 'none'}
              onChange={(v) =>
                set({
                  sink:
                    v === 'none'
                      ? undefined
                      : {
                          style: v as 'undermount' | 'topmount' | 'farmhouse',
                          width: cabinet.sink?.width ?? 30,
                          frontToBack: cabinet.sink?.frontToBack ?? (v === 'farmhouse' ? 19 : 18),
                          bowlDepth: cabinet.sink?.bowlDepth ?? (v === 'farmhouse' ? 10 : 9),
                          apronHeight: cabinet.sink?.apronHeight ?? 10,
                          faucet: cabinet.sink?.faucet ?? true,
                        },
                })
              }
              options={[
                { value: 'none', label: 'No sink' },
                { value: 'undermount', label: 'Undermount' },
                { value: 'topmount', label: 'Top mount (drop-in)' },
                { value: 'farmhouse', label: 'Farmhouse / apron front' },
              ]}
            />
          </Field>

          {cabinet.sink && (
            <>
              <div className="row">
                <Field label="Bowl width">
                  <DimInput
                    value={cabinet.sink.width}
                    onChange={(n) => set({ sink: { ...cabinet.sink!, width: n } })}
                  />
                </Field>
                <Field label="Front to back">
                  <DimInput
                    value={cabinet.sink.frontToBack}
                    onChange={(n) => set({ sink: { ...cabinet.sink!, frontToBack: n } })}
                  />
                </Field>
                <Field label="Bowl depth">
                  <DimInput
                    value={cabinet.sink.bowlDepth}
                    onChange={(n) => set({ sink: { ...cabinet.sink!, bowlDepth: n } })}
                  />
                </Field>
              </div>
              {cabinet.sink.style === 'farmhouse' && (
                <Field label="Apron height" hint="Taken off the top of the face; the doors below shorten to suit.">
                  <DimInput
                    value={cabinet.sink.apronHeight}
                    onChange={(n) => set({ sink: { ...cabinet.sink!, apronHeight: n } })}
                  />
                </Field>
              )}
              <Toggle
                label="Show a faucet"
                checked={cabinet.sink.faucet}
                onChange={(b) => set({ sink: { ...cabinet.sink!, faucet: b } })}
              />
              {cabinet.sink.style === 'farmhouse' && (
                <div className="field-hint">
                  An apron bowl carries its weight on the cabinet, not the counter. Build a support ledge and
                  check the filled weight before you size it.
                </div>
              )}
            </>
          )}
        </>
      )}

      {/*
        A wall oven goes in a tall cabinet. Offering the pocket on a 34-1/2"
        base was clutter on every base in the job for a case that does not
        build — an existing pocket still shows so an older project can clear it.
      */}
      {(cabinet.type === 'tall' || cabinet.oven) && (
        <>
          <div className="section-title">Wall Oven</div>
          <Field label="Oven pocket" hint="Splits the face — drawers below, doors above, both sized from the opening.">
            <Select
              value={cabinet.oven ? String(cabinet.oven.count) : 'none'}
              onChange={(v) =>
                set({
                  oven:
                    v === 'none'
                      ? undefined
                      : {
                          count: Number(v) as 1 | 2,
                          width: cabinet.oven?.width ?? 28.5,
                          openingHeight: v === '2' ? 50 : 28.5,
                          bottomHeight: cabinet.oven?.bottomHeight ?? (v === '2' ? 24 : 30),
                          showAppliance: cabinet.oven?.showAppliance ?? true,
                        },
                })
              }
              options={[
                { value: 'none', label: 'No oven' },
                { value: '1', label: 'Single wall oven' },
                { value: '2', label: 'Double stacked ovens' },
              ]}
            />
          </Field>

          {cabinet.oven && (
            <>
              <div className="row">
                <Field label="Opening width">
                  <DimInput value={cabinet.oven.width} onChange={(n) => set({ oven: { ...cabinet.oven!, width: n } })} />
                </Field>
                <Field label="Opening height">
                  <DimInput
                    value={cabinet.oven.openingHeight}
                    onChange={(n) => set({ oven: { ...cabinet.oven!, openingHeight: n } })}
                  />
                </Field>
              </div>
              <Field
                label="Bottom of opening above floor"
                hint={`Opening runs ${formatFrac(cabinet.oven.bottomHeight)}" to ${formatFrac(
                  cabinet.oven.bottomHeight + cabinet.oven.openingHeight,
                )}". 30" is comfortable for a single; a double usually starts near 24".`}
              >
                <DimInput
                  value={cabinet.oven.bottomHeight}
                  onChange={(n) => set({ oven: { ...cabinet.oven!, bottomHeight: n } })}
                />
              </Field>
              <Toggle
                label="Show the oven in the pocket"
                checked={cabinet.oven.showAppliance}
                onChange={(b) => set({ oven: { ...cabinet.oven!, showAppliance: b } })}
              />
              <div className="field-hint">
                These are rough-opening sizes and they vary by model. Check the spec sheet before you cut — an
                opening a quarter inch tight is a rebuild.
              </div>
            </>
          )}
        </>
      )}

      <div className="section-title">Corner</div>
      <Field label="Corner treatment">
        <Select
          value={cabinet.corner ?? 'none'}
          onChange={(v) => set({ corner: v })}
          options={[
            { value: 'none', label: 'Not a corner cabinet' },
            { value: 'diagonal', label: 'Diagonal (lazy susan)' },
            { value: 'blind', label: 'Blind corner' },
          ]}
        />
      </Field>
      {cabinet.corner === 'diagonal' && (
        <div className="field-hint" style={{ marginBottom: 8 }}>
          Square footprint {formatFrac(cabinet.width)}" on both walls. The 45° face carries a{' '}
          <span className="mono">{formatFrac(frontalWidth(cabinet))}"</span> door.
          {cabinet.width - cabinet.depth < 6 && (
            <div style={{ color: 'var(--warn)', marginTop: 3 }}>
              Width needs to exceed the depth by enough to leave a usable face — try 36".
            </div>
          )}
        </div>
      )}
      {cabinet.corner === 'blind' && (
        <>
          <div className="row">
            <Field label="Blind width" hint="Hidden behind the return">
              <DimInput value={cabinet.blindWidth ?? 24} onChange={(n) => set({ blindWidth: n })} />
            </Field>
            <Field label="Corner is on the">
              <Select
                value={cabinet.blindSide ?? 'left'}
                onChange={(v) => set({ blindSide: v })}
                options={[
                  { value: 'left', label: 'Left end' },
                  { value: 'right', label: 'Right end' },
                ]}
              />
            </Field>
          </div>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            Reachable opening: <span className="mono">{formatFrac(frontalWidth(cabinet))}"</span>
          </div>
        </>
      )}

      <div className="section-title">Doors, Drawers &amp; Shelves</div>
      <div className="row">
        <Field label="Doors">
          <Select
            value={String(cabinet.doorCount) as '0' | '1' | '2'}
            onChange={(v) => set({ doorCount: Number(v) as 0 | 1 | 2 })}
            options={[
              { value: '0', label: 'None' },
              { value: '1', label: '1 Door' },
              { value: '2', label: '2 Doors' },
            ]}
          />
        </Field>
        <Field label="Shelves">
          <NumInput value={cabinet.shelfCount} onChange={(n) => set({ shelfCount: Math.max(0, Math.round(n)) })} min={0} max={8} />
        </Field>
      </div>
      {cabinet.doorCount === 1 && (
        <Field label="Hinge side" hint="Which stile the door swings from, viewed from the front.">
          <Select
            value={cabinet.hingeSide ?? 'right'}
            onChange={(v) => set({ hingeSide: v })}
            options={[
              { value: 'left', label: 'Hinged left (opens right)' },
              { value: 'right', label: 'Hinged right (opens left)' },
            ]}
          />
        </Field>
      )}
      {cabinet.doorCount === 2 && (
        <div className="field-hint" style={{ marginBottom: 8 }}>
          A pair is hinged on both outer stiles and opens from the middle.
        </div>
      )}

      <Toggle label="Adjustable shelves (drill pin holes)" checked={cabinet.adjustableShelves} onChange={(b) => set({ adjustableShelves: b })} />

      {doorOpening && (
        <div className="field-hint" style={{ marginTop: 4 }}>
          Door size: <span className="mono">{formatFrac(doorOpening.frontWidth)}" × {formatFrac(doorOpening.frontHeight)}"</span>
          {doorOpening.frontCount === 2 ? ' each (pair)' : ''}
        </div>
      )}

      <div className="between" style={{ marginTop: 10, marginBottom: 5 }}>
        <h4 style={{ margin: 0 }}>Drawers</h4>
        <div style={{ display: 'flex', gap: 4 }}>
          {cabinet.drawers.length > 0 && (
            <button className="sm ghost" onClick={() => balanceDrawers(cabinet.id)} title="Split the available face height evenly">
              Balance
            </button>
          )}
          <button className="sm" onClick={() => addDrawer(cabinet.id)}>+ Drawer</button>
        </div>
      </div>
      {cabinet.drawers.length === 0 && <div className="field-hint">No drawers. Fronts stack from the top down.</div>}
      {cabinet.drawers.map((d, i) => (
        <div key={d.id} style={{ marginBottom: 6 }}>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label={`Front ${i + 1} height`}>
              <DimInput value={d.frontHeight} onChange={(n) => updateDrawer(cabinet.id, d.id, { frontHeight: n })} />
            </Field>
            <div style={{ flex: '0 0 auto' }}>
              <button className="sm danger" onClick={() => removeDrawer(cabinet.id, d.id)}>×</button>
            </div>
          </div>
          <Toggle
            label="False front (no box or slides)"
            checked={!!d.falseFront}
            onChange={(b) => updateDrawer(cabinet.id, d.id, { falseFront: b })}
          />
        </div>
      ))}

      <div className="section-title">Materials</div>
      <Field label="Box / carcass">
        <Select value={cabinet.boxMaterialId} onChange={(v) => set({ boxMaterialId: v })} options={sheetOpts} />
      </Field>
      <Field label="Doors &amp; fronts">
        <Select value={cabinet.faceMaterialId} onChange={(v) => set({ faceMaterialId: v })} options={faceOpts} />
      </Field>
      <Field label="Back panel">
        <Select value={cabinet.backMaterialId} onChange={(v) => set({ backMaterialId: v })} options={sheetOpts} />
      </Field>
      <Field label="Drawer boxes">
        <Select value={cabinet.drawerBoxMaterialId} onChange={(v) => set({ drawerBoxMaterialId: v })} options={sheetOpts} />
      </Field>
      {cabinet.drawers.length > 0 && (
        <Field label="Drawer bottoms">
          <Select
            value={cabinet.drawerBottomMaterialId ?? project.defaultDrawerBottomMaterialId}
            onChange={(v) => set({ drawerBottomMaterialId: v })}
            options={sheetOpts}
          />
        </Field>
      )}
      <Field label="Edgebanding">
        <Select value={cabinet.edgebandId} onChange={(v) => set({ edgebandId: v })} options={ebOpts} />
      </Field>

      <div className="section-title">Exposed Ends &amp; Trim</div>
      <Toggle label="Finished left end" checked={cabinet.finishedLeft} onChange={(b) => set({ finishedLeft: b })} />
      <Toggle label="Finished right end" checked={cabinet.finishedRight} onChange={(b) => set({ finishedRight: b })} />
      {(cabinet.finishedLeft || cabinet.finishedRight) && (
        <Field
          label="End panel style"
          hint="Slab finishes the side panel itself. The rest are applied panels, and add their own parts."
        >
          <Select
            value={cabinet.endPanelStyle ?? 'slab'}
            onChange={(v) => set({ endPanelStyle: v })}
            options={PANEL_STYLE_OPTIONS}
          />
        </Field>
      )}

      <Field
        label="Finished back"
        hint="Islands and peninsulas show their backs to the room. Adds a panel over the carcass."
      >
        <Select
          value={cabinet.backPanel ?? 'none'}
          onChange={(v) => set({ backPanel: v === 'none' ? undefined : (v as PanelStyle) })}
          options={[{ value: 'none', label: 'Unfinished (against a wall)' }, ...PANEL_STYLE_OPTIONS]}
        />
      </Field>

      {/* Crown runs across the top of wall and tall cabinets; a base run has a
          countertop over it, so there is nothing there to trim. */}
      {(cabinet.type === 'wall' || cabinet.type === 'tall') && (
        <>
          {project.crown.enabled ? (
            <Toggle
              label="Crown across the top"
              checked={cabinet.crown ?? true}
              onChange={(b) => set({ crown: b })}
            />
          ) : (
            <div className="field-hint">Turn crown on under Settings → Trim to run it on this cabinet.</div>
          )}
        </>
      )}

      <div className="section-title">Hardware</div>
      <Field label="Hinge">
        <Select
          value={cabinet.hingeId ?? 'hw-hinge-softclose'}
          onChange={(v) => set({ hingeId: v })}
          options={project.hardware.filter((h) => h.category === 'hinge').map((h) => ({ value: h.id, label: h.name }))}
        />
      </Field>
      <Field label="Pull / knob">
        <Select
          value={cabinet.pullId ?? 'hw-pull-bar'}
          onChange={(v) => set({ pullId: v })}
          options={project.hardware
            .filter((h) => h.category === 'pull' || h.category === 'knob')
            .map((h) => ({ value: h.id, label: h.name }))}
        />
      </Field>

      <div className="section-title">Notes</div>
      <textarea
        rows={2}
        value={cabinet.notes ?? ''}
        placeholder="Shop notes for this cabinet"
        onChange={(e) => set({ notes: e.target.value })}
      />

      <div className="section-title">This Cabinet's Parts ({parts.reduce((a, p) => a + p.qty, 0)})</div>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Part</th>
              <th className="num">Qty</th>
              <th className="num">Length</th>
              <th className="num">Width</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="num">{p.qty}</td>
                <td className="num">{formatFrac(p.length)}</td>
                <td className="num">{formatFrac(p.width)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={() => duplicateCabinet(cabinet.id)}>Duplicate</button>
        <button className="danger" onClick={() => removeCabinet(cabinet.id)}>Delete</button>
      </div>
      <Toggle label="Exclude from estimate" checked={!!cabinet.excluded} onChange={(b) => set({ excluded: b })} />
    </div>
  );
}

/** Compact read-out of the material a cabinet is built from. */
export function MaterialSummary({ project }: { project: Project }) {
  const box = project.materials.find((m) => m.id === project.defaultBoxMaterialId);
  const face = project.materials.find((m) => m.id === project.defaultFaceMaterialId);
  return (
    <div className="field-hint">
      Box: {box?.name ?? '—'}
      {isSheet(box) && ` (${formatIn(box.thickness)})`}
      <br />
      Fronts: {face?.name ?? '—'}
      {isLumber(face) && ` (${formatIn(face.actualThickness)} actual)`}
      {isSheet(face) && ` (${formatIn(face.thickness)})`}
      {isEdgeband(face) && ''}
    </div>
  );
}
