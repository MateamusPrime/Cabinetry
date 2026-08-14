import { useMemo, useState } from 'react';
import { useProject } from '../store/useProject';
import { generateProjectParts, rollupCutList } from '../domain/partsGenerator';
import { formatFrac, linFt, sqFt } from '../domain/units';
import { isLumber, isSheet } from '../domain/materials';
import type { EdgeFlags } from '../domain/types';

function edgeLabel(b: EdgeFlags): string {
  const parts: string[] = [];
  if (b.front) parts.push('F');
  if (b.back) parts.push('B');
  if (b.left) parts.push('L');
  if (b.right) parts.push('R');
  return parts.length === 4 ? 'All' : parts.join('+') || '—';
}

function toCsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\n');
}

function download(filename: string, content: string, type = 'text/csv') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CutListView() {
  const project = useProject((s) => s.project);
  const [groupBy, setGroupBy] = useState<'material' | 'cabinet'>('material');
  const [decimals, setDecimals] = useState(false);

  const { parts, warnings } = useMemo(() => generateProjectParts(project), [project]);
  const rows = useMemo(() => rollupCutList(parts), [parts]);

  const fmt = (n: number) => (decimals ? n.toFixed(3) : formatFrac(n, 32));

  const byMaterial = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = map.get(r.materialId);
      if (list) list.push(r);
      else map.set(r.materialId, [r]);
    }
    return map;
  }, [rows]);

  const byCabinet = useMemo(() => {
    const map = new Map<string, typeof parts>();
    for (const p of parts) {
      const list = map.get(p.cabinetName);
      if (list) list.push(p);
      else map.set(p.cabinetName, [p]);
    }
    return map;
  }, [parts]);

  const exportCsv = () => {
    const header = ['Material', 'Part', 'Qty', 'Length', 'Width', 'Thickness', 'Grain', 'Edgeband', 'Cabinets'];
    const body = rows.map((r) => {
      const mat = project.materials.find((m) => m.id === r.materialId);
      return [
        mat?.name ?? r.materialId,
        r.name,
        String(r.qty),
        fmt(r.length),
        fmt(r.width),
        fmt(r.thickness),
        r.grain,
        edgeLabel(r.banded),
        r.cabinets.join('; '),
      ];
    });
    download(`${project.name.replace(/\W+/g, '-')}-cutlist.csv`, toCsv([header, ...body]));
  };

  if (parts.length === 0) {
    return (
      <div className="empty">
        <h3>No parts yet</h3>
        <p>Add cabinets in the Design tab and the cut list builds itself.</p>
      </div>
    );
  }

  const totalPieces = parts.reduce((a, p) => a + p.qty, 0);

  return (
    <div>
      <div className="between" style={{ marginBottom: 14 }}>
        <div>
          <h2>Cut List</h2>
          <div className="field-hint">
            {totalPieces} pieces across {rows.length} unique sizes · {project.cabinets.filter((c) => !c.excluded).length} cabinets
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={groupBy === 'material' ? 'primary sm' : 'sm'} onClick={() => setGroupBy('material')}>
            By material
          </button>
          <button className={groupBy === 'cabinet' ? 'primary sm' : 'sm'} onClick={() => setGroupBy('cabinet')}>
            By cabinet
          </button>
          <button className="sm" onClick={() => setDecimals(!decimals)}>
            {decimals ? 'Fractions' : 'Decimals'}
          </button>
          <button className="sm" onClick={exportCsv}>Export CSV</button>
          <button className="sm" onClick={() => window.print()}>Print</button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="alert warn">
          <strong>{warnings.length} issue{warnings.length === 1 ? '' : 's'} to resolve before cutting</strong>
          <ul>
            {warnings.slice(0, 12).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {groupBy === 'material'
        ? [...byMaterial.entries()].map(([materialId, list]) => {
            const mat = project.materials.find((m) => m.id === materialId);
            const pieces = list.reduce((a, r) => a + r.qty, 0);
            const area = list.reduce((a, r) => a + sqFt(r.length, r.width) * r.qty, 0);
            return (
              <div className="card" key={materialId}>
                <div className="between" style={{ marginBottom: 8 }}>
                  <h3>{mat?.name ?? materialId}</h3>
                  <span className="field-hint">
                    {pieces} pieces · {area.toFixed(1)} sq ft
                    {isSheet(mat) && ` · ${mat.sheetWidth}" × ${mat.sheetLength}" sheets`}
                    {isLumber(mat) && ` · ${mat.nominalThickness * 4}/4 stock`}
                  </span>
                </div>
                <div className="scroll-x">
                  <table>
                    <thead>
                      <tr>
                        <th>Part</th>
                        <th className="num">Qty</th>
                        <th className="num">Length</th>
                        <th className="num">Width</th>
                        <th>Grain</th>
                        <th>Band</th>
                        <th>Cabinets</th>
                        {/* Machining, so the setout is on the row being cut. */}
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.key}>
                          <td>{r.name}</td>
                          <td className="num">{r.qty}</td>
                          <td className="num">{fmt(r.length)}</td>
                          <td className="num">{fmt(r.width)}</td>
                          <td className="dim-text">{r.grain === 'none' ? 'any' : r.grain}</td>
                          <td className="dim-text">{edgeLabel(r.banded)}</td>
                          <td className="dim-text" style={{ fontSize: 11 }}>{r.cabinets.join(', ')}</td>
                          <td className="dim-text" style={{ fontSize: 11 }}>{r.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        : [...byCabinet.entries()].map(([cabName, list]) => (
            <div className="card" key={cabName}>
              <div className="between" style={{ marginBottom: 8 }}>
                <h3>{cabName}</h3>
                <span className="field-hint">{list.reduce((a, p) => a + p.qty, 0)} pieces</span>
              </div>
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>Part</th>
                      <th>Material</th>
                      <th className="num">Qty</th>
                      <th className="num">Length</th>
                      <th className="num">Width</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td className="dim-text">{project.materials.find((m) => m.id === p.materialId)?.name}</td>
                        <td className="num">{p.qty}</td>
                        <td className="num">{fmt(p.length)}</td>
                        <td className="num">{fmt(p.width)}</td>
                        <td className="dim-text" style={{ fontSize: 11 }}>{p.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

      <div className="card">
        <h4>Edgebanding</h4>
        <EdgebandSummary />
      </div>
    </div>
  );
}

function EdgebandSummary() {
  const project = useProject((s) => s.project);
  const { parts } = useMemo(() => generateProjectParts(project), [project]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    const cabById = new Map(project.cabinets.map((c) => [c.id, c]));
    for (const p of parts) {
      const mat = project.materials.find((m) => m.id === p.materialId);
      if (!isSheet(mat)) continue;
      const edges =
        (p.banded.front ? p.width : 0) +
        (p.banded.back ? p.width : 0) +
        (p.banded.left ? p.length : 0) +
        (p.banded.right ? p.length : 0);
      if (edges <= 0) continue;
      const ebId = cabById.get(p.cabinetId)?.edgebandId ?? project.defaultEdgebandId;
      map.set(ebId, (map.get(ebId) ?? 0) + linFt(edges * p.qty));
    }
    return map;
  }, [parts, project]);

  if (totals.size === 0) return <div className="field-hint">No banded edges in this project.</div>;

  return (
    <table>
      <thead>
        <tr>
          <th>Banding</th>
          <th className="num">Linear feet</th>
          <th className="num">Buy (+10%)</th>
        </tr>
      </thead>
      <tbody>
        {[...totals.entries()].map(([id, feet]) => (
          <tr key={id}>
            <td>{project.materials.find((m) => m.id === id)?.name ?? id}</td>
            <td className="num">{feet.toFixed(1)}</td>
            <td className="num">{Math.ceil(feet * 1.1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
