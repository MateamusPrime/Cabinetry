import { lazy, Suspense, useMemo, useState } from 'react';
import {
  useProject,
  useSelectedAppliance,
  useSelectedBarTop,
  useSelectedCabinet,
  useSelectedWindow,
  type ViewMode,
} from './store/useProject';
import { ApplianceEditor } from './components/ApplianceEditor';
import { BarTopEditor } from './components/BarTopEditor';
import { WindowEditor } from './components/WindowEditor';
import { CABINET_PRESETS, VIEW_PRESETS } from './domain/defaults';
import { PlanView } from './components/Elevation';
import { CabinetEditor } from './components/CabinetEditor';
import { CutListView } from './components/CutListView';
import { NestingView } from './components/NestingView';
import { EstimateView } from './components/EstimateView';
import { SettingsView } from './components/SettingsView';
import { JobsPanel } from './components/JobsPanel';
import { APPLIANCE_PRESETS } from './domain/defaults';
import { computeEstimate, linearFeet } from './domain/estimate';
import { findCollisions, layoutWarnings, runStatus } from './domain/geometry';
import { formatFrac, money } from './domain/units';
import { Field } from './components/Inputs';
import { RunStatusBar } from './components/RunStatusBar';

// Three.js is roughly three quarters of the bundle. Splitting it out keeps
// the cut list and estimate views loading without the 3D engine.
const Scene3D = lazy(() => import('./components/Scene3D').then((m) => ({ default: m.Scene3D })));

const TABS: { id: ViewMode; label: string }[] = [
  { id: 'design', label: '3D Design' },
  { id: 'cutlist', label: 'Cut List' },
  { id: 'nesting', label: 'Cut Diagrams' },
  { id: 'estimate', label: 'Estimate' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const project = useProject((s) => s.project);
  const view = useProject((s) => s.view);
  const setView = useProject((s) => s.setView);
  const select = useProject((s) => s.select);
  const selected = useSelectedCabinet();
  const selectedAppliance = useSelectedAppliance();
  const selectedBarTop = useSelectedBarTop();
  const selectedWindow = useSelectedWindow();
  const [jobsOpen, setJobsOpen] = useState(false);

  const est = useMemo(() => {
    try {
      return computeEstimate(project);
    } catch {
      return null;
    }
  }, [project]);

  return (
    <div className="app">
      {jobsOpen && <JobsPanel onClose={() => setJobsOpen(false)} />}
      <div className="topbar">
        <div className="brand">
          <strong>CABINETRY</strong>
          <span className="dim-text">{project.name}</span>
        </div>
        <button className="sm" onClick={() => setJobsOpen(true)}>
          Jobs
        </button>
        {est && project.cabinets.length > 0 && (
          <div className="dim-text mono" style={{ fontSize: 11 }}>
            {project.cabinets.filter((c) => !c.excluded).length} cabinets ·{' '}
            {(linearFeet(project.cabinets).base + linearFeet(project.cabinets).wall + linearFeet(project.cabinets).tall).toFixed(1)} lf ·{' '}
            <span style={{ color: 'var(--accent-2)' }}>{money(est.clientTotal)}</span>
          </div>
        )}
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${view === t.id ? ' active' : ''}`} onClick={() => setView(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="body">
        {view === 'design' && <LeftPanel />}

        {view === 'design' ? (
          <DesignViewport />
        ) : (
          <div className="main pad">
            {view === 'cutlist' && <CutListView />}
            {view === 'nesting' && <NestingView />}
            {view === 'estimate' && <EstimateView />}
            {view === 'settings' && <SettingsView />}
          </div>
        )}

        {view === 'design' && (
          <div className="panel right">
            {selected ? (
              <CabinetEditor cabinet={selected} project={project} />
            ) : selectedAppliance ? (
              <ApplianceEditor appliance={selectedAppliance} project={project} />
            ) : selectedBarTop ? (
              <BarTopEditor bar={selectedBarTop} project={project} />
            ) : selectedWindow ? (
              <WindowEditor window={selectedWindow} project={project} />
            ) : (
              <ProjectOverview onPick={select} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LeftPanel() {
  const project = useProject((s) => s.project);
  const addCabinet = useProject((s) => s.addCabinet);
  const select = useProject((s) => s.select);
  const selectedId = useProject((s) => s.selectedCabinetId);
  const autoArrange = useProject((s) => s.autoArrange);
  const addAppliance = useProject((s) => s.addAppliance);
  const selectAppliance = useProject((s) => s.selectAppliance);
  const selectedApplianceId = useProject((s) => s.selectedApplianceId);
  const addBarTop = useProject((s) => s.addBarTop);
  const selectBarTop = useProject((s) => s.selectBarTop);
  const selectedBarTopId = useProject((s) => s.selectedBarTopId);
  const addWindow = useProject((s) => s.addWindow);
  const selectWindow = useProject((s) => s.selectWindow);
  const selectedWindowId = useProject((s) => s.selectedWindowId);
  const reorderCabinet = useProject((s) => s.reorderCabinet);
  const alignWallTops = useProject((s) => s.alignWallTops);
  const activeWallId = useProject((s) => s.activeWallId);
  const setActiveWall = useProject((s) => s.setActiveWall);
  const selectedCabinet = project.cabinets.find((c) => c.id === selectedId) ?? null;
  const [filter, setFilter] = useState<'all' | 'base' | 'wall' | 'tall' | 'vanity'>('all');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const presets = CABINET_PRESETS.filter((p) => filter === 'all' || p.type === filter);

  return (
    <div className="panel left">
      <div className="section-title">Wall</div>
      <Field label="New cabinets go on" hint="Each wall keeps its own run, so L and U shaped kitchens work.">
        <select value={activeWallId ?? project.room.walls[0]?.id ?? ''} onChange={(e) => setActiveWall(e.target.value)}>
          {project.room.walls.map((w, i) => {
            /*
             * The same figure the run panel shows. Summing cabinet widths here
             * ignored every appliance and every corner cabinet reaching in from
             * the next wall, so this read wildly free on a wall that was full.
             */
            const status = runStatus(project, w.id, false);
            return (
              <option key={w.id} value={w.id}>
                Wall {i + 1} — {formatFrac(status.wallLength)}" ({formatFrac(status.remaining)}" free)
              </option>
            );
          })}
        </select>
      </Field>
      {project.room.walls.length < 2 && (
        <div className="field-hint">
          Only one wall. Add more under Settings → Room, or pick an L / U shape there.
        </div>
      )}

      <RunStatusBar wallId={activeWallId ?? project.room.walls[0]?.id ?? ''} />

      <div className="section-title">Add a Cabinet</div>
      <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>
        {(['all', 'base', 'wall', 'tall', 'vanity'] as const).map((f) => (
          <button key={f} className={filter === f ? 'primary sm' : 'sm ghost'} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {presets.map((p) => (
        <button key={p.key} className="preset-btn" onClick={() => addCabinet(p.key)}>
          {p.label}
          <small>{p.description}</small>
        </button>
      ))}

      <div className="section-title">Add an Appliance</div>
      <div className="field-hint" style={{ marginBottom: 6 }}>
        {selectedCabinet ? (
          <>
            Lines up with <strong>{selectedCabinet.name}</strong>
            {selectedCabinet.type === 'wall'
              ? ' — a hood or microwave hangs underneath it, anything else drops to the floor in that bay.'
              : ' — in the same bay.'}
          </>
        ) : (
          'Select a cabinet first and the appliance lines up with it. Otherwise it lands at the end of the base run.'
        )}
      </div>
      <div className="field-hint" style={{ marginBottom: 6 }}>
        Nominal sizes — check the model's spec sheet before you cut the opening.
      </div>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) addAppliance(e.target.value);
          e.target.value = '';
        }}
      >
        <option value="">Choose an appliance…</option>
        {APPLIANCE_PRESETS.map((a) => (
          <option key={a.key} value={a.key}>
            {a.label}
            {a.panelReady ? ' — panel ready' : ''}
          </option>
        ))}
      </select>

      {project.appliances.length > 0 && (
        <>
          <div className="section-title">Appliances ({project.appliances.length})</div>
          <div className="list">
            {project.appliances.map((a) => (
              <button
                key={a.id}
                className={`list-item${a.id === selectedApplianceId ? ' active' : ''}`}
                onClick={() => selectAppliance(a.id)}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.name}
                </span>
                <span className="meta">
                  {a.pinned ? '📌 ' : ''}
                  {formatFrac(a.width)}" @ {formatFrac(a.mountHeight)}"
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="section-title">Windows</div>
      <div className="field-hint" style={{ marginBottom: 6 }}>
        Cuts a real opening through the active wall. Not part of any run — cabinets neither move it nor pack
        around it.
      </div>
      <button className="sm" onClick={addWindow}>
        Add a window
      </button>
      {(project.windows ?? []).length > 0 && (
        <div className="list" style={{ marginTop: 6 }}>
          {(project.windows ?? []).map((w) => {
            const wallIndex = project.room.walls.findIndex((x) => x.id === w.wallId);
            return (
              <button
                key={w.id}
                className={`list-item${w.id === selectedWindowId ? ' active' : ''}`}
                onClick={() => selectWindow(w.id)}
                style={w.hidden ? { opacity: 0.45 } : undefined}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.name}
                </span>
                <span className="meta">
                  W{wallIndex + 1} · {formatFrac(w.width)}×{formatFrac(w.height)}"
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="section-title">Bar Tops</div>
      <div className="field-hint" style={{ marginBottom: 6 }}>
        A raised bar behind a run: a pony wall with its own slab. It does not change the cabinets in front of it.
      </div>
      <button className="sm" onClick={addBarTop}>
        Add a bar top
      </button>
      {(project.barTops ?? []).length > 0 && (
        <div className="list" style={{ marginTop: 6 }}>
          {(project.barTops ?? []).map((b) => (
            <button
              key={b.id}
              className={`list-item${b.id === selectedBarTopId ? ' active' : ''}`}
              onClick={() => selectBarTop(b.id)}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.name}
              </span>
              <span className="meta">
                {formatFrac(b.length)}" @ {formatFrac(b.wallHeight)}"
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="section-title">Cabinets ({project.cabinets.length})</div>
      {project.cabinets.length === 0 && <div className="field-hint">Nothing placed yet.</div>}
      {project.cabinets.length > 1 && (
        <div className="field-hint" style={{ marginBottom: 5 }}>
          Drag to reorder — the run re-flows left to right to match.
        </div>
      )}
      <div className="list">
        {project.cabinets.map((c, i) => (
          <button
            key={c.id}
            className={`list-item${c.id === selectedId ? ' active' : ''}${dragOver === i ? ' drop-target' : ''}`}
            onClick={() => select(c.id)}
            draggable
            onDragStart={(e) => {
              setDragIndex(i);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOver !== i) setDragOver(i);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setDragOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== i) reorderCabinet(project.cabinets[dragIndex].id, i);
              setDragIndex(null);
              setDragOver(null);
            }}
            style={c.excluded ? { opacity: 0.45 } : undefined}
          >
            <span className="drag-grip" title="Drag to reorder">⠿</span>
            <span className={`chip ${c.type}`}>{c.type}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.name}
            </span>
            <span className="meta">{formatFrac(c.width)}"</span>
          </button>
        ))}
      </div>

      {project.cabinets.length > 1 && (
        <div className="stack" style={{ marginTop: 10 }}>
          <button onClick={autoArrange}>Re-flow runs (clears overlaps)</button>
          <button onClick={alignWallTops}>Align wall cabinet tops</button>
        </div>
      )}
    </div>
  );
}

function DesignViewport() {
  const project = useProject((s) => s.project);
  const selectedId = useProject((s) => s.selectedCabinetId);
  const select = useProject((s) => s.select);
  const showDoors = useProject((s) => s.showDoors);
  const toggleDoors = useProject((s) => s.toggleDoors);
  const applyViewPreset = useProject((s) => s.applyViewPreset);
  const showDimensions = useProject((s) => s.showDimensions);
  const toggleDimensions = useProject((s) => s.toggleDimensions);
  const toggleWallHidden = useProject((s) => s.toggleWallHidden);
  const toggleBarTopHidden = useProject((s) => s.toggleBarTopHidden);
  const showAllWalls = useProject((s) => s.showAllWalls);
  const [mode, setMode] = useState<'3d' | 'plan'>('3d');

  const autoArrange = useProject((s) => s.autoArrange);
  const collisions = useMemo(
    () => findCollisions(project.cabinets, project.appliances),
    [project.cabinets, project.appliances],
  );
  const clearances = useMemo(() => layoutWarnings(project), [project]);

  return (
    <div className="main">
      <div className="viewport">
        {mode === '3d' ? (
          <Suspense fallback={<div className="empty">Loading the 3D view…</div>}>
            <Scene3D />
          </Suspense>
        ) : (
          <div style={{ position: 'absolute', inset: 0, padding: 20 }}>
            <PlanView project={project} selectedId={selectedId} onSelect={select} showDims={showDimensions} />
          </div>
        )}
      </div>

      <div className="viewport-overlay">
        <button className={mode === '3d' ? 'primary sm' : 'sm'} onClick={() => setMode('3d')}>3D</button>
        <button className={mode === 'plan' ? 'primary sm' : 'sm'} onClick={() => setMode('plan')}>Plan</button>
        <button className={showDimensions ? 'primary sm' : 'sm'} onClick={toggleDimensions}>
          {showDimensions ? 'Hide dims' : 'Show dims'}
        </button>
        {mode === '3d' && (
          <>
            <button className="sm" onClick={toggleDoors}>
              {showDoors ? 'Hide doors' : 'Show doors'}
            </button>
            <select
              className="sm"
              style={{ width: 'auto' }}
              value=""
              onChange={(e) => {
                if (e.target.value) applyViewPreset(e.target.value);
                e.target.value = '';
              }}
              title="Presentation look"
            >
              <option value="">Look…</option>
              {VIEW_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {collisions.length > 0 && (
        <div style={{ position: 'absolute', top: 10, right: 12, zIndex: 5, maxWidth: 320 }}>
          <div className="alert bad" style={{ marginBottom: 0 }}>
            <strong>
              {collisions.length} overlap{collisions.length === 1 ? '' : 's'} — these occupy the same space
            </strong>
            <div style={{ fontSize: 11, marginTop: 3 }}>
              {collisions.slice(0, 4).map((c, i) => (
                <div key={i}>
                  {c.aName} ↔ {c.bName}
                </div>
              ))}
              {collisions.length > 4 && <div>…and {collisions.length - 4} more</div>}
            </div>
            <button className="sm" style={{ marginTop: 7 }} onClick={autoArrange}>
              Re-flow runs to fix
            </button>
          </div>
        </div>
      )}

      {clearances.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: collisions.length > 0 ? 128 : 10,
            right: 12,
            zIndex: 5,
            maxWidth: 320,
          }}
        >
          <div className="alert warn" style={{ marginBottom: 0 }}>
            <strong>Clearance</strong>
            <ul style={{ fontSize: 11 }}>
              {clearances.slice(0, 3).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {mode === '3d' && project.room.walls.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            right: 12,
            zIndex: 5,
            background: 'rgba(20, 22, 26, 0.85)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            padding: '7px 9px',
            backdropFilter: 'blur(6px)',
          }}
        >
          <div className="field-hint" style={{ marginBottom: 5 }}>
            Show walls
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 190 }}>
            {project.room.walls.map((w, i) => (
              <button
                key={w.id}
                className={w.hidden ? 'sm ghost' : 'primary sm'}
                onClick={() => toggleWallHidden(w.id)}
                title={w.hidden ? `Wall ${i + 1} is hidden` : `Hide wall ${i + 1} to see past it`}
              >
                {i + 1}
              </button>
            ))}
            {(project.room.walls.some((w) => w.hidden) ||
              (project.barTops ?? []).some((b) => b.hidden)) && (
              <button className="sm" onClick={showAllWalls}>
                All
              </button>
            )}
          </div>

          {/*
            Bar walls hide the same way a room wall does, and for the same
            reason: a 42" wall standing in front of a run blocks the very
            cabinets you are trying to look at.
          */}
          {(project.barTops ?? []).length > 0 && (
            <>
              <div className="field-hint" style={{ margin: '7px 0 5px' }}>
                Show bar walls
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 190 }}>
                {(project.barTops ?? []).map((b, i) => (
                  <button
                    key={b.id}
                    className={b.hidden ? 'sm ghost' : 'primary sm'}
                    onClick={() => toggleBarTopHidden(b.id)}
                    title={b.hidden ? `${b.name} is hidden` : `Hide ${b.name} to see the run behind it`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="viewport-legend">
        {mode === '3d' ? 'Drag to orbit · scroll to zoom · right-drag to pan · click a cabinet to edit' : 'Click a cabinet to edit · grid squares are 12"'}
      </div>
    </div>
  );
}

function ProjectOverview({ onPick }: { onPick: (id: string) => void }) {
  const project = useProject((s) => s.project);
  const setView = useProject((s) => s.setView);
  const est = useMemo(() => {
    try {
      return computeEstimate(project);
    } catch {
      return null;
    }
  }, [project]);

  if (project.cabinets.length === 0) {
    return (
      <div>
        <div className="section-title">Getting Started</div>
        <p className="muted">
          Pick a cabinet from the library on the left. It drops into the run and you can size it, choose materials, and
          add doors and drawers here.
        </p>
        <p className="muted">
          Everything downstream — the cut list, the sheet layouts, and the estimate — is generated from what you build,
          so it stays in step as you make changes.
        </p>
        <div className="section-title">Before You Quote</div>
        <p className="muted">
          Open <button className="sm ghost" onClick={() => setView('settings')}>Settings → Materials</button> and replace
          the default prices with your supplier's. The defaults are realistic but they are not your numbers.
        </p>
      </div>
    );
  }

  const lf = linearFeet(project.cabinets);

  return (
    <div>
      <div className="section-title">Project</div>
      <div className="kpi" style={{ marginBottom: 8 }}>
        <div className="k">Client price</div>
        <div className="v" style={{ color: 'var(--accent-2)' }}>{est ? money(est.clientTotal) : '—'}</div>
        <div className="s">{est ? `${(est.effectiveMarginPct * 100).toFixed(0)}% margin · ${est.laborHours.total.toFixed(0)} shop hours` : ''}</div>
      </div>

      <table>
        <tbody>
          <tr><td>Base run</td><td className="num">{lf.base.toFixed(1)} lf</td></tr>
          <tr><td>Wall run</td><td className="num">{lf.wall.toFixed(1)} lf</td></tr>
          <tr><td>Tall</td><td className="num">{lf.tall.toFixed(1)} lf</td></tr>
          {est && (
            <>
              <tr><td>Sheets</td><td className="num">{est.takeoff.sheetResults.reduce((a, r) => a + r.sheets.length, 0)}</td></tr>
              <tr><td>Board feet</td><td className="num">{est.takeoff.lumberPlans.reduce((a, p) => a + p.grossBoardFeet, 0).toFixed(0)}</td></tr>
              <tr><td>Finished area</td><td className="num">{est.finishSqFt.toFixed(0)} sq ft</td></tr>
            </>
          )}
        </tbody>
      </table>

      {est && est.warnings.length > 0 && (
        <div className="alert warn" style={{ marginTop: 12 }}>
          <strong>{est.warnings.length} issue{est.warnings.length === 1 ? '' : 's'}</strong>
          <ul>
            {est.warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="section-title">Cabinets</div>
      <div className="list">
        {project.cabinets.map((c) => (
          <button key={c.id} className="list-item" onClick={() => onPick(c.id)}>
            <span className={`chip ${c.type}`}>{c.type}</span>
            <span style={{ flex: 1 }}>{c.name}</span>
            <span className="meta">
              {est?.perCabinet.find((p) => p.cabinetId === c.id)
                ? money(est.perCabinet.find((p) => p.cabinetId === c.id)!.price)
                : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
