import { useEffect, useRef, useState } from 'react';
import type { ViewSettings } from '../domain/types';
import { useProject } from '../store/useProject';
import { DimInput, Field, NumInput, PctInput, Select, Toggle } from './Inputs';
import { isEdgeband, isLumber, isSheet, speciesColor } from '../domain/materials';
import { ROOM_SHAPES, VIEW_PRESETS } from '../domain/defaults';
import { formatFrac, money } from '../domain/units';

export function SettingsView() {
  const project = useProject((s) => s.project);
  const update = useProject((s) => s.update);
  const updateDefaults = useProject((s) => s.updateDefaults);
  const updateLabor = useProject((s) => s.updateLabor);
  const updatePricing = useProject((s) => s.updatePricing);
  const updateMaterial = useProject((s) => s.updateMaterial);
  const updateHardwareCost = useProject((s) => s.updateHardwareCost);
  const updateView = useProject((s) => s.updateView);
  const applyViewPreset = useProject((s) => s.applyViewPreset);
  const updateCrown = useProject((s) => s.updateCrown);
  const updateLightRail = useProject((s) => s.updateLightRail);
  const applyRoomShape = useProject((s) => s.applyRoomShape);
  const toggleWallHidden = useProject((s) => s.toggleWallHidden);
  const addWall = useProject((s) => s.addWall);
  const updateWall = useProject((s) => s.updateWall);
  const removeWall = useProject((s) => s.removeWall);
  const exportJson = useProject((s) => s.exportJson);
  const importJson = useProject((s) => s.importJson);
  const newProject = useProject((s) => s.newProject);

  const [tab, setTab] = useState<
    'project' | 'construction' | 'trim' | 'appearance' | 'materials' | 'hardware' | 'labor' | 'room' | 'data'
  >('project');
  const [importError, setImportError] = useState<string | null>(null);
  const [roomW, setRoomW] = useState(168);
  const [roomD, setRoomD] = useState(144);
  const fileRef = useRef<HTMLInputElement>(null);
  const d = project.defaults;
  const v = project.view;

  // What the render would use if nothing were overriding it, so the pickers
  // open on the current appearance rather than on an arbitrary colour.
  const speciesOf = (id: string) => {
    const m = project.materials.find((x) => x.id === id);
    return m && 'species' in m ? m.species : 'Maple';
  };
  const defaultDoorColor = speciesColor(speciesOf(project.defaultFaceMaterialId));
  const defaultBoxColor = speciesColor(speciesOf(project.defaultBoxMaterialId));

  const tabs = [
    ['project', 'Project'],
    ['construction', 'Construction'],
    ['trim', 'Trim'],
    ['appearance', 'Appearance'],
    ['materials', 'Materials & Prices'],
    ['hardware', 'Hardware'],
    ['labor', 'Labor & Rates'],
    ['room', 'Room'],
    ['data', 'Save / Load'],
  ] as const;

  return (
    <div>
      <h2 style={{ marginBottom: 12 }}>Settings</h2>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {tabs.map(([k, label]) => (
          <button key={k} className={tab === k ? 'primary sm' : 'sm'} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'project' && (
        <div className="card" style={{ maxWidth: 520 }}>
          <h4>Project Details</h4>
          <Field label="Project name">
            <input value={project.name} onChange={(e) => update((p) => { p.name = e.target.value; })} />
          </Field>
          <Field label="Client">
            <input value={project.client} onChange={(e) => update((p) => { p.client = e.target.value; })} />
          </Field>
          <Field label="Address">
            <input value={project.address} onChange={(e) => update((p) => { p.address = e.target.value; })} />
          </Field>
          <Field label="Finish system">
            <Select
              value={project.selectedFinishId}
              onChange={(v) => update((p) => { p.selectedFinishId = v; })}
              options={project.finishes.map((f) => ({ value: f.id, label: `${f.name} — ${money(f.costPerSqFt)}/sq ft` }))}
            />
          </Field>
          <div className="section-title">Default Materials for New Cabinets</div>
          <Field label="Box / carcass">
            <Select
              value={project.defaultBoxMaterialId}
              onChange={(v) => update((p) => { p.defaultBoxMaterialId = v; })}
              options={project.materials.filter(isSheet).map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>
          <Field label="Doors &amp; fronts">
            <Select
              value={project.defaultFaceMaterialId}
              onChange={(v) => update((p) => { p.defaultFaceMaterialId = v; })}
              options={project.materials.filter((m) => m.kind !== 'edgeband').map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>
          <Field label="Backs">
            <Select
              value={project.defaultBackMaterialId}
              onChange={(v) => update((p) => { p.defaultBackMaterialId = v; })}
              options={project.materials.filter(isSheet).map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>
          <Field label="Drawer boxes">
            <Select
              value={project.defaultDrawerBoxMaterialId}
              onChange={(v) => update((p) => { p.defaultDrawerBoxMaterialId = v; })}
              options={project.materials.filter(isSheet).map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>
          <Field
            label="Drawer bottoms"
            hint="Dropped into a 1/4&quot;-deep groove. A 1/2&quot; bottom wants a wider groove but the same panel size."
          >
            <Select
              value={project.defaultDrawerBottomMaterialId}
              onChange={(v) => update((p) => { p.defaultDrawerBottomMaterialId = v; })}
              options={project.materials.filter(isSheet).map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>
          <Field label="Edgebanding">
            <Select
              value={project.defaultEdgebandId}
              onChange={(v) => update((p) => { p.defaultEdgebandId = v; })}
              options={project.materials.filter(isEdgeband).map((m) => ({ value: m.id, label: m.name }))}
            />
          </Field>
        </div>
      )}

      {tab === 'construction' && (
        <div className="two-col">
          <div className="card">
            <h4>Style</h4>
            <div className="row">
              <Field label="Construction">
                <Select
                  value={d.construction}
                  onChange={(v) => updateDefaults({ construction: v })}
                  options={[
                    { value: 'frameless', label: 'Frameless (Euro / 32mm)' },
                    { value: 'faceFrame', label: 'Face Frame' },
                  ]}
                />
              </Field>
              <Field label="Door mount">
                <Select
                  value={d.doorMount}
                  onChange={(v) => updateDefaults({ doorMount: v })}
                  options={[
                    { value: 'fullOverlay', label: 'Full Overlay' },
                    { value: 'halfOverlay', label: 'Half Overlay' },
                    { value: 'inset', label: 'Inset' },
                  ]}
                />
              </Field>
            </div>

            <div className="section-title">Reveals</div>
            <div className="row">
              <Field label="Edge reveal" hint="Gap at exposed edges">
                <DimInput value={d.revealEdge} onChange={(n) => updateDefaults({ revealEdge: n })} />
              </Field>
              <Field label="Between fronts" hint="Door pair / stacked drawers">
                <DimInput value={d.revealBetween} onChange={(n) => updateDefaults({ revealBetween: n })} />
              </Field>
              <Field label="Overlay" hint="Face frame only">
                <DimInput value={d.overlay} onChange={(n) => updateDefaults({ overlay: n })} />
              </Field>
            </div>

            <div className="section-title">Face Frame Stock</div>
            <div className="row">
              <Field label="Stile width">
                <DimInput value={d.frameStileWidth} onChange={(n) => updateDefaults({ frameStileWidth: n })} />
              </Field>
              <Field label="Rail width">
                <DimInput value={d.frameRailWidth} onChange={(n) => updateDefaults({ frameRailWidth: n })} />
              </Field>
              <Field label="Thickness">
                <DimInput value={d.frameThickness} onChange={(n) => updateDefaults({ frameThickness: n })} />
              </Field>
            </div>
            <div className="section-title">Frameless Corner Clearance</div>
            <div className="row">
              <Field label="Corner stile width" hint="Mitred into the 45 face, and matched on whatever butts it.">
                <DimInput
                  value={d.cornerFrameWidth}
                  onChange={(n) => updateDefaults({ cornerFrameWidth: Math.max(0, n) })}
                />
              </Field>
              <Field label="Front laps it by" hint="Per side. What is left exposed is the working clearance.">
                <DimInput
                  value={d.cornerFrameOverlay}
                  onChange={(n) =>
                    updateDefaults({ cornerFrameOverlay: Math.max(0, Math.min(d.cornerFrameWidth, n)) })
                  }
                />
              </Field>
            </div>
            <div className="field-hint">
              Leaves {formatFrac(Math.max(0, d.cornerFrameWidth - d.cornerFrameOverlay))}" of stile showing each
              side, so {formatFrac(2 * Math.max(0, d.cornerFrameWidth - d.cornerFrameOverlay))}" between the corner
              door and the front beside it.
            </div>

            <Field
              label="Overhang past the box"
              hint="Per side. Gives you something to scribe to the wall and to cover the joint between cabinets. 0 keeps the frame flush; 1/8&quot; and 1/4&quot; are common. Any cabinet can override it."
            >
              <DimInput
                value={d.frameOverhang}
                onChange={(n) => updateDefaults({ frameOverhang: Math.max(0, n) })}
              />
            </Field>

            <div className="section-title">Toe Kick</div>
            <div className="row">
              <Field label="Height">
                <DimInput value={d.toeKickHeight} onChange={(n) => updateDefaults({ toeKickHeight: n })} />
              </Field>
              <Field label="Setback depth">
                <DimInput value={d.toeKickDepth} onChange={(n) => updateDefaults({ toeKickDepth: n })} />
              </Field>
            </div>
            <Field
              label="Kick face"
              hint="Changes the cut list as well as the render — a matching kick is cut from the door material."
            >
              <Select
                value={d.toeKickFinish}
                onChange={(v) => updateDefaults({ toeKickFinish: v })}
                options={[
                  { value: 'box', label: 'Carcass material (cheapest)' },
                  { value: 'face', label: 'Match the doors' },
                  { value: 'painted', label: 'Painted out' },
                ]}
              />
            </Field>
            {d.toeKickFinish === 'painted' && (
              <ColorField
                label="Kick colour"
                value={d.toeKickPaintColor}
                onChange={(c) => updateDefaults({ toeKickPaintColor: c })}
              />
            )}
            <div className="field-hint">
              A toe kick sits {formatFrac(d.toeKickDepth)}" back in its own shadow, so it always reads darker on
              screen than the sample in your hand.
            </div>
          </div>

          <div className="card">
            <h4>Joinery</h4>
            <div className="row">
              <Field label="Back style">
                <Select
                  value={d.backStyle}
                  onChange={(v) => updateDefaults({ backStyle: v })}
                  options={[
                    { value: 'rabbeted', label: 'Rabbeted into sides' },
                    { value: 'dadoed', label: 'Dadoed' },
                    { value: 'applied', label: 'Applied to rear edges' },
                    { value: 'none', label: 'No back' },
                  ]}
                />
              </Field>
              <Field label="Joinery depth">
                <DimInput value={d.backJoineryDepth} onChange={(n) => updateDefaults({ backJoineryDepth: n })} />
              </Field>
            </div>

            <div className="row">
              <Field
                label="Deck, top &amp; fixed shelves"
                hint="Dado housing cuts those parts longer by the groove depth at each end."
              >
                <Select
                  value={d.carcassJoinery}
                  onChange={(v) => updateDefaults({ carcassJoinery: v })}
                  options={[
                    { value: 'butt', label: 'Butt jointed and fastened' },
                    { value: 'dado', label: 'Housed in a dado' },
                  ]}
                />
              </Field>
              <Field label="Dado depth">
                <DimInput
                  value={d.carcassDadoDepth}
                  onChange={(n) => updateDefaults({ carcassDadoDepth: Math.max(0, n) })}
                />
              </Field>
            </div>
            {d.carcassJoinery === 'dado' && (
              <div className="field-hint">
                The cut list carries the groove setout on each Side part — position from the bottom edge for the
                deck, every fixed shelf and the top.
              </div>
            )}

            <div className="section-title">Grooves</div>
            <div className="row">
              <Field label="Drawer bottom groove" hint="Depth all round. The bottom is cut to suit it.">
                <DimInput
                  value={d.drawerBottomGroove}
                  onChange={(n) => updateDefaults({ drawerBottomGroove: Math.max(0, n) })}
                />
              </Field>
              <Field label="Panel groove" hint="Shaker and raised fields.">
                <DimInput
                  value={d.panelGroove}
                  onChange={(n) => updateDefaults({ panelGroove: Math.max(0, n) })}
                />
              </Field>
              <Field label="Panel float" hint="Slack for seasonal movement. Too little splits the frame.">
                <DimInput
                  value={d.panelFloat}
                  onChange={(n) => updateDefaults({ panelFloat: Math.max(0, n) })}
                />
              </Field>
            </div>
            <div className="row">
              <Field label="Base cabinet top">
                <Select
                  value={d.baseTopStyle}
                  onChange={(v) => updateDefaults({ baseTopStyle: v })}
                  options={[
                    { value: 'stretchers', label: 'Front + rear stretchers' },
                    { value: 'full', label: 'Full top panel' },
                  ]}
                />
              </Field>
              <Field label="Stretcher width">
                <DimInput value={d.stretcherWidth} onChange={(n) => updateDefaults({ stretcherWidth: n })} />
              </Field>
            </div>

            <div className="section-title">Shelves</div>
            <div className="row">
              <Field label="Front setback">
                <DimInput value={d.shelfSetback} onChange={(n) => updateDefaults({ shelfSetback: n })} />
              </Field>
              <Field label="Side clearance" hint="Total, for adjustable shelves">
                <DimInput value={d.shelfSideClearance} onChange={(n) => updateDefaults({ shelfSideClearance: n })} />
              </Field>
            </div>

            <div className="section-title">Drawer Boxes</div>
            <div className="row">
              <Field label="Slide clearance" hint="Per side">
                <DimInput value={d.drawerSlideClearance} onChange={(n) => updateDefaults({ drawerSlideClearance: n })} />
              </Field>
              <Field label="Depth reduction" hint="Cabinet depth less this">
                <DimInput value={d.drawerBoxDepthReduction} onChange={(n) => updateDefaults({ drawerBoxDepthReduction: n })} />
              </Field>
              <Field label="Height reduction" hint="Front height less this">
                <DimInput value={d.drawerBoxHeightReduction} onChange={(n) => updateDefaults({ drawerBoxHeightReduction: n })} />
              </Field>
            </div>

            <div className="section-title">Corners</div>
            <Field
              label="Corner filler width"
              hint="Frameless corner doors foul the neighbouring door without one. A face frame already sets the door back, so framed work can use 0."
            >
              <DimInput value={d.cornerFillerWidth} onChange={(n) => updateDefaults({ cornerFillerWidth: n })} />
            </Field>

            <div className="section-title">Machining</div>
            <div className="row">
              <Field label="Saw kerf">
                <DimInput value={d.kerf} onChange={(n) => updateDefaults({ kerf: n })} />
              </Field>
              <Field label="Sheet trim" hint="Removed from each sheet edge">
                <DimInput value={d.sheetTrim} onChange={(n) => updateDefaults({ sheetTrim: n })} />
              </Field>
            </div>
          </div>
        </div>
      )}

      {tab === 'trim' && (
        <div className="two-col">
          <div className="card">
            <h4>Crown Moulding</h4>
            <Toggle
              label="Run crown on this project"
              checked={project.crown.enabled}
              onChange={(b) => updateCrown({ enabled: b })}
            />
            <div className="field-hint" style={{ marginBottom: 10 }}>
              Applied to wall and tall cabinets by default. Any individual cabinet can opt out in its editor.
              Run length covers the front plus any end that is not buried against a neighbour.
            </div>
            {project.crown.enabled && (
              <>
                <Field label="Profile name">
                  <input value={project.crown.name} onChange={(e) => updateCrown({ name: e.target.value })} />
                </Field>
                <div className="row">
                  <Field label="Face height">
                    <DimInput value={project.crown.height} onChange={(n) => updateCrown({ height: n })} />
                  </Field>
                  <Field label="Projection">
                    <DimInput value={project.crown.projection} onChange={(n) => updateCrown({ projection: n })} />
                  </Field>
                  <Field label="Mitre waste">
                    <PctInput value={project.crown.wasteFactor} onChange={(n) => updateCrown({ wasteFactor: n })} />
                  </Field>
                </div>
                <Toggle
                  label="Mill it in the shop from solid stock"
                  checked={project.crown.millInShop}
                  onChange={(b) => updateCrown({ millInShop: b })}
                />
                {project.crown.millInShop ? (
                  <Field label="Stock to mill from" hint="Board feet land in the lumber takeoff.">
                    <Select
                      value={project.crown.materialId}
                      onChange={(v) => updateCrown({ materialId: v })}
                      options={project.materials.filter(isLumber).map((m) => ({ value: m.id, label: m.name }))}
                    />
                  </Field>
                ) : (
                  <Field label="Bought-in cost" hint="Priced by the linear foot, outside the sheet and board-foot takeoff.">
                    <NumInput
                      value={project.crown.costPerLinearFoot}
                      onChange={(n) => updateCrown({ costPerLinearFoot: n })}
                      step={0.25}
                      suffix="$/ft"
                    />
                  </Field>
                )}
              </>
            )}
          </div>

          <div className="card">
            <h4>Light Rail</h4>
            <Toggle
              label="Run light rail under the wall cabinets"
              checked={project.lightRail.enabled}
              onChange={(b) => updateLightRail({ enabled: b })}
            />
            <div className="field-hint" style={{ marginBottom: 10 }}>
              Hides under-cabinet lighting along the bottom edge of the wall run.
            </div>
            {project.lightRail.enabled && (
              <div className="row">
                <Field label="Height">
                  <DimInput value={project.lightRail.height} onChange={(n) => updateLightRail({ height: n })} />
                </Field>
                <Field label="Projection">
                  <DimInput value={project.lightRail.projection} onChange={(n) => updateLightRail({ projection: n })} />
                </Field>
                <Field label="Cost">
                  <NumInput
                    value={project.lightRail.costPerLinearFoot}
                    onChange={(n) => updateLightRail({ costPerLinearFoot: n })}
                    step={0.25}
                    suffix="$/ft"
                  />
                </Field>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'appearance' && (
        <div className="two-col">
          <div className="card">
            <h4>Presentation Presets</h4>
            <div className="field-hint" style={{ marginBottom: 10 }}>
              Presentation only — none of this touches the cut list or the estimate. Saved with the job, so a
              client-facing look sticks.
            </div>
            <div className="stack">
              {VIEW_PRESETS.map((p) => (
                <button key={p.key} className="preset-btn" onClick={() => applyViewPreset(p.key)}>
                  {p.label}
                  <small>{p.description}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h4>Colours</h4>
            <div className="row">
              <ColorField label="Background" value={v.background} onChange={(c) => updateView({ background: c })} />
              <ColorField label="Walls" value={v.wallColor} onChange={(c) => updateView({ wallColor: c })} />
            </div>
            <div className="row">
              <ColorField label="Floor" value={v.floorColor} onChange={(c) => updateView({ floorColor: c })} />
              <ColorField label="Countertop" value={v.counterColor} onChange={(c) => updateView({ counterColor: c })} />
            </div>

            <div className="section-title">Cabinets</div>
            <div className="field-hint" style={{ marginBottom: 6 }}>
              Paints the drawing only. The cut list and the estimate stay on the materials you specified, so this is
              safe for showing a client the same kitchen in another finish.
            </div>
            <div className="row">
              <ColorField
                label="Doors &amp; fronts"
                value={v.doorColor ?? defaultDoorColor}
                onChange={(c) => updateView({ doorColor: c })}
              />
              <ColorField
                label="Carcass"
                value={v.boxColor ?? defaultBoxColor}
                onChange={(c) => updateView({ boxColor: c })}
              />
            </div>
            <div className="row">
              <button
                className="sm"
                onClick={() => updateView({ doorColor: undefined, boxColor: undefined })}
                title="Go back to the colour of the material each cabinet is specified in"
              >
                Match materials
              </button>
              {CABINET_FINISH_SWATCHES.map((s) => (
                <button
                  key={s.label}
                  className="sm"
                  onClick={() => updateView({ doorColor: s.door, boxColor: s.box })}
                  title={s.label}
                  style={{ background: s.door, color: s.ink, borderColor: 'var(--line)' }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {(v.doorColor || v.boxColor) && (
              <div className="field-hint" style={{ color: 'var(--accent-2)' }}>
                The render is overriding the material colours. "Match materials" puts it back.
              </div>
            )}

            <div className="section-title">Hardware</div>
            <div className="field-hint" style={{ marginBottom: 6 }}>
              How the pulls are drawn. What each cabinet is billed for is still its own hardware selection, under
              the cabinet's Hardware section.
            </div>
            <Field label="Pull style">
              <Select
                value={v.pullStyle ?? 'bar'}
                onChange={(s) => updateView({ pullStyle: s as ViewSettings['pullStyle'] })}
                options={[
                  { value: 'bar', label: 'Bar pull' },
                  { value: 'knob', label: 'Knob' },
                  { value: 'cup', label: 'Cup / bin pull (knobs on doors)' },
                  { value: 'edge', label: 'Edge tab' },
                ]}
              />
            </Field>
            <div className="row">
              <ColorField
                label="Finish"
                value={v.pullColor ?? '#8b8f96'}
                onChange={(c) => updateView({ pullColor: c })}
              />
              <Field label="Sheen" hint="0 for powder-coated, 1 for polished metal.">
                <NumInput
                  value={v.pullMetalness ?? 0.75}
                  onChange={(n) => updateView({ pullMetalness: Math.min(1, Math.max(0, n)) })}
                  step={0.05}
                  min={0}
                  max={1}
                />
              </Field>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {PULL_FINISHES.map((f) => (
                <button
                  key={f.label}
                  className="sm"
                  onClick={() => updateView({ pullColor: f.color, pullMetalness: f.metalness })}
                  title={f.label}
                  style={{ background: f.color, color: f.ink, borderColor: 'var(--line)' }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="section-title">Lighting</div>
            <Field label="Brightness" hint="Lift it for a light backdrop, drop it for a dim one.">
              <NumInput
                value={v.brightness}
                onChange={(n) => updateView({ brightness: Math.min(1.8, Math.max(0.4, n)) })}
                step={0.05}
                min={0.4}
                max={1.8}
              />
            </Field>

            <div className="section-title">Show</div>
            <Toggle label="Floor grid" checked={v.showGrid} onChange={(b) => updateView({ showGrid: b })} />
            <Toggle label="Walls" checked={v.showWalls} onChange={(b) => updateView({ showWalls: b })} />
            <Toggle
              label="Countertops"
              checked={v.showCountertops}
              onChange={(b) => updateView({ showCountertops: b })}
            />
            <div className="field-hint">
              Hiding the countertops is the quickest way to show a client the boxes and drawer layout underneath.
            </div>
          </div>
        </div>
      )}

      {tab === 'materials' && (
        <>
          <div className="alert info">
            These are starting prices, not quotes. Replace them with your actual supplier numbers — everything downstream
            depends on them.
          </div>
          <div className="card">
            <h4>Sheet Goods</h4>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Species</th>
                    <th className="num">Thickness</th>
                    <th className="num">Sheet size</th>
                    <th>Grain</th>
                    <th className="num">Cost / sheet</th>
                  </tr>
                </thead>
                <tbody>
                  {project.materials.filter(isSheet).map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td className="dim-text">{m.species}</td>
                      <td className="num">{m.thickness}"</td>
                      <td className="num">{m.sheetWidth}×{m.sheetLength}</td>
                      <td className="dim-text">{m.hasGrain ? 'directional' : 'any'}</td>
                      <td className="num" style={{ width: 110 }}>
                        <NumInput value={m.costPerSheet} onChange={(n) => updateMaterial(m.id, { costPerSheet: n })} step={1} suffix="$" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h4>Solid Lumber</h4>
            <div className="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Species</th>
                    <th className="num">Nominal</th>
                    <th className="num">Actual</th>
                    <th className="num">Cost / bd ft</th>
                  </tr>
                </thead>
                <tbody>
                  {project.materials.filter(isLumber).map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td className="dim-text">{m.species}</td>
                      <td className="num">{m.nominalThickness * 4}/4</td>
                      <td className="num">{m.actualThickness}"</td>
                      <td className="num" style={{ width: 110 }}>
                        <NumInput value={m.costPerBoardFoot} onChange={(n) => updateMaterial(m.id, { costPerBoardFoot: n })} step={0.25} suffix="$" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h4>Edgebanding</h4>
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="num">Width</th>
                  <th className="num">Cost / lin ft</th>
                </tr>
              </thead>
              <tbody>
                {project.materials.filter(isEdgeband).map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className="num">{m.width}"</td>
                    <td className="num" style={{ width: 110 }}>
                      <NumInput value={m.costPerLinearFoot} onChange={(n) => updateMaterial(m.id, { costPerLinearFoot: n })} step={0.02} suffix="$" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h4>Finishes</h4>
            <table>
              <thead>
                <tr>
                  <th>System</th>
                  <th className="num">Material cost / sq ft</th>
                </tr>
              </thead>
              <tbody>
                {project.finishes.map((f) => (
                  <tr key={f.id}>
                    <td>{f.name}{f.id === project.selectedFinishId && <span className="chip" style={{ marginLeft: 6 }}>selected</span>}</td>
                    <td className="num" style={{ width: 110 }}>
                      <NumInput
                        value={f.costPerSqFt}
                        onChange={(n) => update((p) => { const x = p.finishes.find((y) => y.id === f.id); if (x) x.costPerSqFt = n; })}
                        step={0.05}
                        suffix="$"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ maxWidth: 520 }}>
            <h4>Waste Allowances</h4>
            <div className="row">
              <Field label="Sheet waste" hint="On top of nested count">
                <PctInput value={project.pricing.sheetWasteFactor} onChange={(n) => updatePricing({ sheetWasteFactor: n })} />
              </Field>
              <Field label="Lumber waste" hint="Defect and ripping loss">
                <PctInput value={project.pricing.lumberWasteFactor} onChange={(n) => updatePricing({ lumberWasteFactor: n })} />
              </Field>
              <Field label="Consumables" hint="% of material cost">
                <PctInput value={project.pricing.consumablesPct} onChange={(n) => updatePricing({ consumablesPct: n })} />
              </Field>
            </div>
          </div>
        </>
      )}

      {tab === 'hardware' && (
        <div className="card" style={{ maxWidth: 620 }}>
          <h4>Hardware Prices</h4>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th className="num">Unit</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {project.hardware.map((h) => (
                <tr key={h.id}>
                  <td>{h.name}</td>
                  <td className="dim-text">{h.category}</td>
                  <td className="num dim-text">{h.unit}</td>
                  <td className="num" style={{ width: 110 }}>
                    <NumInput value={h.cost} onChange={(n) => updateHardwareCost(h.id, n)} step={0.25} suffix="$" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'labor' && (
        <div className="two-col">
          <div className="card">
            <h4>Rates</h4>
            <div className="row">
              <Field label="Shop">
                <NumInput value={project.labor.shopRatePerHour} onChange={(n) => updateLabor({ shopRatePerHour: n })} step={5} suffix="/hr" />
              </Field>
              <Field label="Install">
                <NumInput value={project.labor.installRatePerHour} onChange={(n) => updateLabor({ installRatePerHour: n })} step={5} suffix="/hr" />
              </Field>
              <Field label="Design">
                <NumInput value={project.labor.designRatePerHour} onChange={(n) => updateLabor({ designRatePerHour: n })} step={5} suffix="/hr" />
              </Field>
            </div>

            <div className="section-title">Build Hours per Cabinet</div>
            <div className="row">
              <Field label="Base">
                <NumInput value={project.labor.hoursPerBaseCabinet} onChange={(n) => updateLabor({ hoursPerBaseCabinet: n })} step={0.25} suffix="hr" />
              </Field>
              <Field label="Wall">
                <NumInput value={project.labor.hoursPerWallCabinet} onChange={(n) => updateLabor({ hoursPerWallCabinet: n })} step={0.25} suffix="hr" />
              </Field>
              <Field label="Tall">
                <NumInput value={project.labor.hoursPerTallCabinet} onChange={(n) => updateLabor({ hoursPerTallCabinet: n })} step={0.25} suffix="hr" />
              </Field>
            </div>
            <div className="row">
              <Field label="Per door">
                <NumInput value={project.labor.hoursPerDoor} onChange={(n) => updateLabor({ hoursPerDoor: n })} step={0.25} suffix="hr" />
              </Field>
              <Field label="Per drawer">
                <NumInput value={project.labor.hoursPerDrawer} onChange={(n) => updateLabor({ hoursPerDrawer: n })} step={0.25} suffix="hr" />
              </Field>
              <Field label="Per face frame">
                <NumInput value={project.labor.hoursPerFaceFrame} onChange={(n) => updateLabor({ hoursPerFaceFrame: n })} step={0.25} suffix="hr" />
              </Field>
            </div>
            <Field
              label="Bar wall, per linear foot"
              hint="Only counted where the bar wall is shop work. A painted wall built by others costs nothing here."
            >
              <NumInput
                value={project.labor.hoursPerBarWallFoot}
                onChange={(n) => updateLabor({ hoursPerBarWallFoot: n })}
                step={0.05}
                suffix="hr"
              />
            </Field>
          </div>

          <div className="card">
            <h4>Finishing, Install &amp; Design</h4>
            <Field label="Finishing hours per sq ft" hint="Sanding, sealing, sand between coats, topcoats">
              <NumInput value={project.labor.finishHoursPerSqFt} onChange={(n) => updateLabor({ finishHoursPerSqFt: n })} step={0.01} suffix="hr" />
            </Field>
            <Field label="Install hours per cabinet">
              <NumInput value={project.labor.hoursPerCabinetInstall} onChange={(n) => updateLabor({ hoursPerCabinetInstall: n })} step={0.25} suffix="hr" />
            </Field>
            <div className="row">
              <Field label="Design hours (flat)">
                <NumInput value={project.labor.designHoursFlat} onChange={(n) => updateLabor({ designHoursFlat: n })} step={0.5} suffix="hr" />
              </Field>
              <Field label="Design hours per cabinet">
                <NumInput value={project.labor.designHoursPerCabinet} onChange={(n) => updateLabor({ designHoursPerCabinet: n })} step={0.05} suffix="hr" />
              </Field>
            </div>
            <Field label="Per finished end">
              <NumInput value={project.labor.hoursPerFinishedEnd} onChange={(n) => updateLabor({ hoursPerFinishedEnd: n })} step={0.1} suffix="hr" />
            </Field>
          </div>
        </div>
      )}

      {tab === 'room' && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h4>Room Shape</h4>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            A starting point only. Walls are plain segments, so any shape works — drag the endpoints in the
            plan view or type exact coordinates below. Angles other than 90° are fine.
          </div>
          <div className="row" style={{ marginBottom: 6 }}>
            <Field label="Room width">
              <DimInput value={roomW} onChange={setRoomW} />
            </Field>
            <Field label="Room depth">
              <DimInput value={roomD} onChange={setRoomD} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {ROOM_SHAPES.map((s) => (
              <button key={s.key} className="sm" title={s.description} onClick={() => applyRoomShape(s.key, roomW, roomD)}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="alert warn" style={{ fontSize: 11 }}>
            Applying a shape replaces every wall. Cabinets and appliances are left where they are.
          </div>

          <div className="between" style={{ marginBottom: 4, marginTop: 14 }}>
            <h4 style={{ margin: 0 }}>Walls</h4>
            <button className="sm" onClick={addWall}>+ Wall</button>
          </div>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            Hiding a wall drops it and its cabinets from the 3D view so you can see into the room. It changes
            nothing in the cut list or the estimate — use <em>Exclude from estimate</em> on a cabinet for that. A
            corner cabinet stands on two walls, so it stays until both are hidden.
          </div>
          <Field label="Ceiling height">
            <DimInput value={project.room.ceilingHeight} onChange={(n) => update((p) => { p.room.ceilingHeight = n; })} />
          </Field>
          {project.room.walls.map((w, i) => (
            <div key={w.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginTop: 10 }}>
              <div className="between" style={{ marginBottom: 6 }}>
                <strong>Wall {i + 1}</strong>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className={w.hidden ? 'sm' : 'sm ghost'}
                    onClick={() => toggleWallHidden(w.id)}
                    title="Hidden walls and their cabinets stay in the cut list and the estimate"
                  >
                    {w.hidden ? 'Hidden' : 'Visible'}
                  </button>
                  <button className="sm danger" onClick={() => removeWall(w.id)}>Remove</button>
                </div>
              </div>
              <div className="row">
                <Field label="Start X"><DimInput value={w.x1} onChange={(n) => updateWall(w.id, { x1: n })} /></Field>
                <Field label="Start Z"><DimInput value={w.z1} onChange={(n) => updateWall(w.id, { z1: n })} /></Field>
                <Field label="End X"><DimInput value={w.x2} onChange={(n) => updateWall(w.id, { x2: n })} /></Field>
                <Field label="End Z"><DimInput value={w.z2} onChange={(n) => updateWall(w.id, { z2: n })} /></Field>
              </div>
              <div className="row">
                <Field label="Height"><DimInput value={w.height} onChange={(n) => updateWall(w.id, { height: n })} /></Field>
                <Field label="Thickness"><DimInput value={w.thickness} onChange={(n) => updateWall(w.id, { thickness: n })} /></Field>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'data' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h4>Save &amp; Load</h4>
          <div className="field-hint" style={{ marginBottom: 12 }}>
            Your work saves to this browser automatically. Export a file to back it up or move it to another machine.
          </div>
          <div className="row" style={{ marginBottom: 14 }}>
            <button
              onClick={() => {
                const blob = new Blob([exportJson()], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${project.name.replace(/\W+/g, '-')}.cabinetry.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export project file
            </button>
            <button onClick={() => fileRef.current?.click()}>Import project file</button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const err = importJson(await file.text());
              setImportError(err);
              e.target.value = '';
            }}
          />
          {importError && <div className="alert bad">{importError}</div>}

          <div className="section-title">Start Over</div>
          <StartOver onConfirm={() => newProject('New Project')} />
        </div>
      )}
    </div>
  );
}

/** Colour swatch plus a hex field, so a brand colour can be typed exactly. */
/**
 * Common painted and stained finishes, as a one-click starting point. These
 * are render colours only — they do not change what anything is made of.
 */
const CABINET_FINISH_SWATCHES: { label: string; door: string; box: string; ink: string }[] = [
  { label: 'White', door: '#f2f0ec', box: '#e8e5df', ink: '#2a2d31' },
  { label: 'Off-white', door: '#e6e1d6', box: '#ddd8cc', ink: '#2a2d31' },
  { label: 'Grey', door: '#9aa1a8', box: '#8d949b', ink: '#16181b' },
  { label: 'Navy', door: '#2f4058', box: '#2a3950', ink: '#eef2f6' },
  { label: 'Sage', door: '#7e8b72', box: '#75816a', ink: '#f2f5ef' },
  { label: 'Charcoal', door: '#3b3f44', box: '#35393e', ink: '#eef0f2' },
];

/** The finishes a kitchen actually gets specified in. Render colours only. */
const PULL_FINISHES: { label: string; color: string; metalness: number; ink: string }[] = [
  { label: 'Brushed Nickel', color: '#8b8f96', metalness: 0.75, ink: '#16181b' },
  { label: 'Chrome', color: '#d3d8dd', metalness: 0.95, ink: '#16181b' },
  { label: 'Matte Black', color: '#1f2124', metalness: 0.2, ink: '#e9ebee' },
  { label: 'Aged Brass', color: '#b08d4f', metalness: 0.7, ink: '#16181b' },
  { label: 'Bronze', color: '#4a3b31', metalness: 0.5, ink: '#eee6df' },
  { label: 'Stainless', color: '#a8adb3', metalness: 0.85, ink: '#16181b' },
];

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 34, height: 28, padding: 2, flex: '0 0 auto' }}
        />
        <HexInput value={value} onChange={onChange} />
      </div>
    </label>
  );
}

/**
 * Hex entry that keeps its own text while you type. A fully controlled field
 * would reject every partial value and make the box impossible to edit; only
 * a complete colour is pushed upstream.
 */
function HexInput({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);

  const valid = /^#[0-9a-fA-F]{6}$/.test(text);

  return (
    <input
      className={`mono${text && !valid ? ' invalid' : ''}`}
      value={text}
      spellCheck={false}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (!valid) setText(value);
      }}
      onChange={(e) => {
        setText(e.target.value);
        if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value);
      }}
    />
  );
}

/** Two-step confirm — wiping a project is not something to do on one click. */
function StartOver({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <>
        <button className="danger" onClick={() => setArmed(true)}>New empty project</button>
        <div className="field-hint">Export first if you want to keep the current one.</div>
      </>
    );
  }
  return (
    <div className="alert warn">
      This clears the current project from the browser. Export it first if you have not.
      <div className="row" style={{ marginTop: 8 }}>
        <button className="danger" onClick={onConfirm}>Yes, start a new project</button>
        <button onClick={() => setArmed(false)}>Cancel</button>
      </div>
    </div>
  );
}

export { Toggle };
