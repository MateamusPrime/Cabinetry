import { useMemo } from 'react';
import { useProject } from '../store/useProject';
import { generateProjectParts } from '../domain/partsGenerator';
import { buildTakeoff, type NestedSheet } from '../domain/nesting';
import { isSheet } from '../domain/materials';
import { formatFrac, money } from '../domain/units';

/** Distinct fills so a part on the diagram maps to its cabinet at a glance. */
const PALETTE = [
  '#d99a4e', '#6fa8d6', '#5fb98a', '#c084c0', '#e0705c',
  '#e0b45c', '#7f9ed4', '#8ec9a8', '#d4a0d4', '#c98b7a',
];

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function SheetDiagram({ sheet, kerf }: { sheet: NestedSheet; kerf: number }) {
  // Sheet x runs along the length (grain), y across the width.
  const W = sheet.sheetLength;
  const H = sheet.sheetWidth;
  const pad = 2;

  return (
    <svg className="sheet-svg" viewBox={`${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`} preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={0} width={W} height={H} fill="#191c21" stroke="#454c58" strokeWidth={0.6} />
      <rect
        x={sheet.trim}
        y={sheet.trim}
        width={sheet.usableLength}
        height={sheet.usableWidth}
        fill="none"
        stroke="#333a45"
        strokeWidth={0.4}
        strokeDasharray="2 2"
      />

      {sheet.placements.map((p) => {
        const x = sheet.trim + p.x;
        const y = sheet.trim + p.y;
        const fill = colorFor(p.cabinetName);
        const small = p.w < 14 || p.h < 7;
        return (
          <g key={p.partId}>
            <rect x={x} y={y} width={p.w} height={p.h} fill={fill} fillOpacity={0.82} stroke="#101216" strokeWidth={0.5} />
            {!small && (
              <>
                <text
                  x={x + p.w / 2}
                  y={y + p.h / 2 - 1}
                  textAnchor="middle"
                  fontSize={2.6}
                  fill="#10130f"
                  fontFamily="ui-monospace, monospace"
                  fontWeight={600}
                >
                  {p.name}
                </text>
                <text
                  x={x + p.w / 2}
                  y={y + p.h / 2 + 2.6}
                  textAnchor="middle"
                  fontSize={2.4}
                  fill="rgba(0,0,0,0.65)"
                  fontFamily="ui-monospace, monospace"
                >
                  {formatFrac(p.rotated ? p.h : p.w)} × {formatFrac(p.rotated ? p.w : p.h)}
                  {p.rotated ? ' ↻' : ''}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* Grain direction marker */}
      <g stroke="#5b6473" strokeWidth={0.3} fill="#5b6473">
        <line x1={1.5} y1={H - 4} x2={1.5} y2={H - 1.5} />
        <text x={2.6} y={H - 1.8} fontSize={2.4} fontFamily="ui-monospace, monospace" stroke="none">
          grain →
        </text>
      </g>
      <text x={W - 1} y={-0.6} textAnchor="end" fontSize={2.6} fill="#737c8c" fontFamily="ui-monospace, monospace">
        {sheet.sheetLength}" × {sheet.sheetWidth}" · kerf {formatFrac(kerf, 32)}" · {(sheet.yield * 100).toFixed(0)}% used
      </text>
    </svg>
  );
}

export function NestingView() {
  const project = useProject((s) => s.project);

  const { takeoff, sheetCosts } = useMemo(() => {
    const { parts } = generateProjectParts(project);
    const cabById = new Map(project.cabinets.map((c) => [c.id, c]));
    const t = buildTakeoff(
      parts,
      project.materials,
      project.defaults.kerf,
      project.defaults.sheetTrim,
      project.pricing.lumberWasteFactor,
      (part) => {
        const anyBanded = part.banded.front || part.banded.back || part.banded.left || part.banded.right;
        if (!anyBanded) return undefined;
        const mat = project.materials.find((m) => m.id === part.materialId);
        if (!isSheet(mat)) return undefined;
        return cabById.get(part.cabinetId)?.edgebandId ?? project.defaultEdgebandId;
      },
    );
    const costs = new Map<string, number>();
    for (const r of t.sheetResults) {
      const mat = project.materials.find((m) => m.id === r.materialId);
      if (isSheet(mat)) costs.set(r.materialId, mat.costPerSheet);
    }
    return { takeoff: t, sheetCosts: costs };
  }, [project]);

  if (takeoff.sheetResults.length === 0 && takeoff.lumberPlans.length === 0) {
    return (
      <div className="empty">
        <h3>Nothing to nest</h3>
        <p>Add cabinets and the optimizer will lay out your sheets.</p>
      </div>
    );
  }

  const totalSheets = takeoff.sheetResults.reduce((a, r) => a + r.sheets.length, 0);

  return (
    <div>
      <div className="between" style={{ marginBottom: 14 }}>
        <div>
          <h2>Cut Diagrams</h2>
          <div className="field-hint">
            {totalSheets} sheets · guillotine layout, every cut runs edge to edge · kerf {formatFrac(project.defaults.kerf, 32)}"
          </div>
        </div>
        <button className="sm" onClick={() => window.print()}>Print</button>
      </div>

      {takeoff.sheetResults.map((res) => {
        const unitCost = sheetCosts.get(res.materialId) ?? 0;
        const anyUnplaced = res.unplaced.length > 0;
        return (
          <div key={res.materialId} style={{ marginBottom: 26 }}>
            <div className="between" style={{ marginBottom: 8 }}>
              <h3>{res.materialName}</h3>
              <span className="field-hint">
                {res.sheets.length} sheet{res.sheets.length === 1 ? '' : 's'} · {(res.averageYield * 100).toFixed(0)}% average yield ·{' '}
                {money(res.sheets.length * unitCost)}
              </span>
            </div>

            {anyUnplaced && (
              <div className="alert bad">
                <strong>{res.unplaced.length} part{res.unplaced.length === 1 ? '' : 's'} will not fit on a sheet</strong>
                <ul>
                  {res.unplaced.slice(0, 6).map((u, i) => (
                    <li key={i}>
                      {u.cabinetName} — {u.name} ({formatFrac(u.h)}" × {formatFrac(u.w)}"): {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="sheet-grid">
              {res.sheets.map((s) => (
                <div className="sheet-card" key={s.index}>
                  <div className="between" style={{ marginBottom: 7 }}>
                    <strong>Sheet {s.index + 1}</strong>
                    <span className="field-hint">
                      {s.placements.length} parts · {(s.yield * 100).toFixed(0)}% used ·{' '}
                      {(((1 - s.yield) * s.sheetWidth * s.sheetLength) / 144).toFixed(1)} sq ft offcut
                    </span>
                  </div>
                  <SheetDiagram sheet={s} kerf={project.defaults.kerf} />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {takeoff.lumberPlans.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Solid Lumber</h3>
          <div className="field-hint" style={{ marginBottom: 10 }}>
            Hardwood comes in random widths and lengths, so this is a board-foot buy plus a rough-cut list rather than a nested diagram.
          </div>
          {takeoff.lumberPlans.map((plan) => (
            <div className="card" key={plan.materialId}>
              <div className="between" style={{ marginBottom: 8 }}>
                <h3>{plan.materialName}</h3>
                <span className="field-hint">
                  {plan.netBoardFeet.toFixed(1)} bd ft net → buy {plan.grossBoardFeet.toFixed(1)} bd ft (+{(plan.wasteFactor * 100).toFixed(0)}%)
                </span>
              </div>
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>Part</th>
                      <th>Cabinet</th>
                      <th className="num">Qty</th>
                      <th className="num">Length</th>
                      <th className="num">Width</th>
                      <th className="num">Bd ft</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.name}</td>
                        <td className="dim-text">{r.cabinetName}</td>
                        <td className="num">{r.qty}</td>
                        <td className="num">{formatFrac(r.length)}</td>
                        <td className="num">{formatFrac(r.width)}</td>
                        <td className="num">{r.boardFeet.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
