import { useMemo, useState } from 'react';
import { useProject } from '../store/useProject';
import { computeEstimate, linearFeet } from '../domain/estimate';
import { formatFrac, money } from '../domain/units';
import type { CostLine } from '../domain/estimate';
import { NumInput, PctInput, Toggle } from './Inputs';

function LineTable({ title, lines, showUnit = true }: { title: string; lines: CostLine[]; showUnit?: boolean }) {
  if (lines.length === 0) return null;
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return (
    <div className="card">
      <h4>{title}</h4>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            {showUnit && <th className="num">Qty</th>}
            {showUnit && <th className="num">Unit</th>}
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.label}
                {l.detail && <div className="field-hint">{l.detail}</div>}
              </td>
              {showUnit && <td className="num">{l.qty != null ? `${l.qty} ${l.unit ?? ''}` : '—'}</td>}
              {showUnit && <td className="num">{l.unitCost != null ? money(l.unitCost) : '—'}</td>}
              <td className="num">{money(l.amount)}</td>
            </tr>
          ))}
          <tr className="subtotal">
            <td colSpan={showUnit ? 3 : 1}>Subtotal</td>
            <td className="num">{money(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function EstimateView() {
  const project = useProject((s) => s.project);
  const updatePricing = useProject((s) => s.updatePricing);
  const updateLabor = useProject((s) => s.updateLabor);
  const addExtra = useProject((s) => s.addExtra);
  const updateExtra = useProject((s) => s.updateExtra);
  const removeExtra = useProject((s) => s.removeExtra);
  const [mode, setMode] = useState<'internal' | 'client'>('internal');

  const est = useMemo(() => computeEstimate(project), [project]);
  const lf = linearFeet(project.cabinets);
  const totalLf = lf.base + lf.wall + lf.tall;

  if (project.cabinets.filter((c) => !c.excluded).length === 0) {
    return (
      <div className="empty">
        <h3>Nothing to price</h3>
        <p>Add cabinets in the Design tab to build an estimate.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="between" style={{ marginBottom: 14 }}>
        <div>
          <h2>Estimate</h2>
          <div className="field-hint">
            {totalLf.toFixed(1)} linear feet · {money(est.clientTotal / Math.max(totalLf, 0.01))} per linear foot
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={mode === 'internal' ? 'primary sm' : 'sm'} onClick={() => setMode('internal')}>
            Internal cost
          </button>
          <button className={mode === 'client' ? 'primary sm' : 'sm'} onClick={() => setMode('client')}>
            Client quote
          </button>
          <button className="sm" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      {est.warnings.length > 0 && (
        <div className="alert warn">
          <strong>The estimate is built on a design with {est.warnings.length} open issue{est.warnings.length === 1 ? '' : 's'}</strong>
          <ul>
            {est.warnings.slice(0, 6).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'client' ? <ClientQuote /> : null}

      {mode === 'internal' && (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="k">Material</div>
              <div className="v">{money(est.materialSubtotal)}</div>
              <div className="s">{((est.materialSubtotal / est.totalCost) * 100).toFixed(0)}% of cost</div>
            </div>
            <div className="kpi">
              <div className="k">Labor</div>
              <div className="v">{money(est.laborSubtotal)}</div>
              <div className="s">{est.laborHours.total.toFixed(1)} hours</div>
            </div>
            <div className="kpi">
              <div className="k">Total cost</div>
              <div className="v">{money(est.totalCost)}</div>
              <div className="s">incl. overhead + contingency</div>
            </div>
            <div className="kpi accent">
              <div className="k">Client price</div>
              <div className="v">{money(est.clientTotal)}</div>
              <div className="s">{money(est.clientTotal / Math.max(totalLf, 0.01))} / lin ft</div>
            </div>
            <div className="kpi good">
              <div className="k">Gross profit</div>
              <div className="v">{money(est.grossProfit)}</div>
              <div className="s">{(est.effectiveMarginPct * 100).toFixed(1)}% margin</div>
            </div>
          </div>

          <div className="two-col">
            <div>
              <LineTable title="Sheet Goods" lines={est.sheetLines} />
              <LineTable title="Solid Lumber" lines={est.lumberLines} />
              <LineTable title="Trim (bought in)" lines={est.trimLines} />
              <LineTable title="Edgebanding" lines={est.edgebandLines} />

              <div className="card">
                <h4>Hardware</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="num">Qty</th>
                      <th className="num">Unit</th>
                      <th className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {est.hardwareCounts.map((h) => (
                      <tr key={h.item.id}>
                        <td>{h.item.name}</td>
                        <td className="num">{h.qty} {h.item.unit}</td>
                        <td className="num">{money(h.item.cost)}</td>
                        <td className="num">{money(h.amount)}</td>
                      </tr>
                    ))}
                    <tr className="subtotal">
                      <td colSpan={3}>Subtotal</td>
                      <td className="num">{money(est.hardwareCounts.reduce((a, h) => a + h.amount, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <LineTable title="Finish &amp; Consumables" lines={[est.finishLine, est.consumablesLine]} />
            </div>

            <div>
              <LineTable title="Labor" lines={est.laborLines} />

              <div className="card">
                <h4>Roll-up</h4>
                <table>
                  <tbody>
                    <tr>
                      <td>Material</td>
                      <td className="num">{money(est.materialSubtotal)}</td>
                    </tr>
                    <tr>
                      <td>Labor</td>
                      <td className="num">{money(est.laborSubtotal)}</td>
                    </tr>
                    <tr className="subtotal">
                      <td>Direct cost</td>
                      <td className="num">{money(est.directCost)}</td>
                    </tr>
                    <tr>
                      <td>Overhead ({(project.pricing.overheadPct * 100).toFixed(0)}%)</td>
                      <td className="num">{money(est.overhead)}</td>
                    </tr>
                    <tr>
                      <td>Contingency ({(project.pricing.contingencyPct * 100).toFixed(0)}%)</td>
                      <td className="num">{money(est.contingency)}</td>
                    </tr>
                    <tr className="subtotal">
                      <td>Total cost</td>
                      <td className="num">{money(est.totalCost)}</td>
                    </tr>
                    <tr>
                      <td>Cabinetry price at {(project.pricing.targetMarginPct * 100).toFixed(0)}% margin</td>
                      <td className="num">{money(est.cabinetryPrice)}</td>
                    </tr>
                    {est.extrasPrice > 0 && (
                      <tr>
                        <td>Extras</td>
                        <td className="num">{money(est.extrasPrice)}</td>
                      </tr>
                    )}
                    {est.delivery > 0 && (
                      <tr>
                        <td>Delivery</td>
                        <td className="num">{money(est.delivery)}</td>
                      </tr>
                    )}
                    {est.tax > 0 && (
                      <tr>
                        <td>Sales tax ({(project.pricing.salesTaxPct * 100).toFixed(2)}%)</td>
                        <td className="num">{money(est.tax)}</td>
                      </tr>
                    )}
                    <tr className="total">
                      <td>Client total</td>
                      <td className="num">{money(est.clientTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="card">
                <h4>Pricing Controls</h4>
                <div className="row">
                  <label className="field">
                    <span>Overhead</span>
                    <PctInput value={project.pricing.overheadPct} onChange={(n) => updatePricing({ overheadPct: n })} />
                  </label>
                  <label className="field">
                    <span>Contingency</span>
                    <PctInput value={project.pricing.contingencyPct} onChange={(n) => updatePricing({ contingencyPct: n })} />
                  </label>
                  <label className="field">
                    <span>Target margin</span>
                    <PctInput value={project.pricing.targetMarginPct} onChange={(n) => updatePricing({ targetMarginPct: n })} />
                  </label>
                </div>
                <div className="field-hint" style={{ marginBottom: 8 }}>
                  Margin is on the sell price, not markup on cost. A 35% margin means price = cost ÷ 0.65, which is a
                  54% markup.
                </div>
                <div className="row">
                  <label className="field">
                    <span>Shop rate</span>
                    <NumInput value={project.labor.shopRatePerHour} onChange={(n) => updateLabor({ shopRatePerHour: n })} step={5} suffix="/hr" />
                  </label>
                  <label className="field">
                    <span>Install rate</span>
                    <NumInput value={project.labor.installRatePerHour} onChange={(n) => updateLabor({ installRatePerHour: n })} step={5} suffix="/hr" />
                  </label>
                  <label className="field">
                    <span>Design rate</span>
                    <NumInput value={project.labor.designRatePerHour} onChange={(n) => updateLabor({ designRatePerHour: n })} step={5} suffix="/hr" />
                  </label>
                </div>
                <div className="row">
                  <label className="field">
                    <span>Sales tax</span>
                    <PctInput value={project.pricing.salesTaxPct} onChange={(n) => updatePricing({ salesTaxPct: n })} />
                  </label>
                  <label className="field">
                    <span>Delivery</span>
                    <NumInput value={project.pricing.deliveryFlat} onChange={(n) => updatePricing({ deliveryFlat: n })} step={25} suffix="$" />
                  </label>
                  <label className="field">
                    <span>Deposit</span>
                    <PctInput value={project.pricing.depositPct} onChange={(n) => updatePricing({ depositPct: n })} />
                  </label>
                </div>
                <Toggle label="Labor is taxable in this jurisdiction" checked={project.pricing.taxLabor} onChange={(b) => updatePricing({ taxLabor: b })} />
              </div>

              <div className="card">
                <div className="between" style={{ marginBottom: 8 }}>
                  <h4 style={{ margin: 0 }}>Extras</h4>
                  <button className="sm" onClick={addExtra}>+ Line</button>
                </div>
                {project.extras.length === 0 && (
                  <div className="field-hint">Countertops, appliance panels, subcontracted work, crown molding.</div>
                )}
                {project.extras.map((e) => (
                  <div key={e.id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
                    <input value={e.description} onChange={(ev) => updateExtra(e.id, { description: ev.target.value })} style={{ marginBottom: 5 }} />
                    <div className="row">
                      <label className="field">
                        <span>Qty</span>
                        <NumInput value={e.qty} onChange={(n) => updateExtra(e.id, { qty: n })} step={1} />
                      </label>
                      <label className="field">
                        <span>Unit cost</span>
                        <NumInput value={e.unitCost} onChange={(n) => updateExtra(e.id, { unitCost: n })} step={25} suffix="$" />
                      </label>
                      <div style={{ flex: '0 0 auto', paddingTop: 18 }}>
                        <button className="sm danger" onClick={() => removeExtra(e.id)}>×</button>
                      </div>
                    </div>
                    <Toggle
                      label="Pass-through (flat handling instead of full margin)"
                      checked={e.passThrough}
                      onChange={(b) => updateExtra(e.id, { passThrough: b })}
                    />
                  </div>
                ))}
              </div>

              <div className="card">
                <h4>Cost by Cabinet</h4>
                <div className="field-hint" style={{ marginBottom: 8 }}>
                  Allocated by build hours, which tracks true cost far better than a flat per-unit split.
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Cabinet</th>
                      <th className="num">Cost</th>
                      <th className="num">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {est.perCabinet.map((c) => (
                      <tr key={c.cabinetId}>
                        <td>{c.name}</td>
                        <td className="num">{money(c.cost)}</td>
                        <td className="num">{money(c.price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Clean, printable summary with the internal cost structure stripped out. */
function ClientQuote() {
  const project = useProject((s) => s.project);
  const est = useMemo(() => computeEstimate(project), [project]);
  const lf = linearFeet(project.cabinets);

  const active = project.cabinets.filter((c) => !c.excluded);
  const finish = project.finishes.find((f) => f.id === project.selectedFinishId);
  const boxMat = project.materials.find((m) => m.id === project.defaultBoxMaterialId);
  const faceMat = project.materials.find((m) => m.id === project.defaultFaceMaterialId);

  return (
    <div className="card" style={{ maxWidth: 780 }}>
      <div style={{ borderBottom: '2px solid var(--line-2)', paddingBottom: 12, marginBottom: 14 }}>
        <h2 style={{ fontSize: 18 }}>{project.name}</h2>
        <div className="muted">
          {project.client && <>Prepared for {project.client}<br /></>}
          {project.address}
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>
          Quote date {new Date().toLocaleDateString()} · valid 30 days
        </div>
      </div>

      <h4>Scope</h4>
      <table style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>Cabinet</th>
            <th>Size</th>
            <th className="num">Doors</th>
            <th className="num">Drawers</th>
          </tr>
        </thead>
        <tbody>
          {active.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="mono">
                {formatFrac(c.width)}" W × {formatFrac(c.height)}" H × {formatFrac(c.depth)}" D
              </td>
              <td className="num">{c.doorCount}</td>
              <td className="num">{c.drawers.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Specification</h4>
      <table style={{ marginBottom: 16 }}>
        <tbody>
          <tr><td>Construction</td><td>{project.defaults.construction === 'frameless' ? 'Frameless (full access)' : 'Face frame'}, {project.defaults.doorMount === 'inset' ? 'inset' : project.defaults.doorMount === 'halfOverlay' ? 'half overlay' : 'full overlay'} doors</td></tr>
          <tr><td>Cabinet boxes</td><td>{boxMat?.name}</td></tr>
          <tr><td>Doors and fronts</td><td>{faceMat?.name}</td></tr>
          <tr><td>Finish</td><td>{finish?.name}</td></tr>
          <tr><td>Extent</td><td>{(lf.base + lf.wall + lf.tall).toFixed(1)} linear feet · {active.length} cabinets</td></tr>
        </tbody>
      </table>

      <h4>Investment</h4>
      <table>
        <tbody>
          <tr>
            <td>Custom cabinetry, finished and installed</td>
            <td className="num">{money(est.cabinetryPrice)}</td>
          </tr>
          {project.extras.map((e) => (
            <tr key={e.id}>
              <td>{e.description}</td>
              <td className="num">
                {money(e.passThrough ? e.qty * e.unitCost * (1 + (e.markupPct ?? 0.1)) : (e.qty * e.unitCost) / (1 - project.pricing.targetMarginPct))}
              </td>
            </tr>
          ))}
          {est.delivery > 0 && (
            <tr>
              <td>Delivery</td>
              <td className="num">{money(est.delivery)}</td>
            </tr>
          )}
          {est.tax > 0 && (
            <tr>
              <td>Sales tax</td>
              <td className="num">{money(est.tax)}</td>
            </tr>
          )}
          <tr className="total">
            <td>Project total</td>
            <td className="num">{money(est.clientTotal)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
        <h4>Terms</h4>
        <div className="muted">
          Deposit of {money(est.deposit)} ({(project.pricing.depositPct * 100).toFixed(0)}%) due at signing to reserve
          shop time and order material. Balance of {money(est.balance)} due on completion of installation.
          Final measurements are verified on site before cutting begins; changes after that point are quoted separately.
        </div>
      </div>
    </div>
  );
}
