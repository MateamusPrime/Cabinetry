import { useMemo, useRef, useState } from 'react';
import type { Cabinet, Project } from '../domain/types';
import { buildCabinetGeometry, footprint, roomCentre, runStatus, wallFrame } from '../domain/geometry';
import { formatFrac } from '../domain/units';
import { useProject } from '../store/useProject';

/**
 * Front elevation drawn straight from the same geometry the 3D view uses.
 * Doors and drawer fronts are outlined so reveals read clearly on paper.
 */
export function CabinetElevation({
  cabinet,
  project,
  width = 300,
  showDims = true,
}: {
  cabinet: Cabinet;
  project: Project;
  width?: number;
  showDims?: boolean;
}) {
  const boxes = useMemo(() => buildCabinetGeometry(cabinet, project, { showDoors: true }), [cabinet, project]);

  const yBase = cabinet.mountHeight ?? (cabinet.type === 'wall' ? 54 : 0);
  const pad = showDims ? 34 : 8;
  const scale = (width - pad * 2) / Math.max(cabinet.width, 1);
  const drawH = cabinet.height * scale;
  const height = drawH + pad * 2;

  // SVG y grows downward; the model measures up from the cabinet bottom.
  const sx = (x: number) => pad + x * scale;
  const sy = (y: number) => pad + (cabinet.height - (y - yBase)) * scale;

  const fronts = boxes.filter((b) => b.role === 'door' || b.role === 'drawerFront');
  const carcass = boxes.filter((b) => b.role !== 'door' && b.role !== 'drawerFront');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
      <rect x={0} y={0} width={width} height={height} fill="#101216" rx={4} />

      {/* Carcass silhouette */}
      <rect
        x={sx(0)}
        y={sy(yBase + cabinet.height)}
        width={cabinet.width * scale}
        height={drawH}
        fill="#1e2128"
        stroke="#454c58"
        strokeWidth={1}
      />

      {carcass.map((b) => {
        const x = b.pos[0] - b.size[0] / 2;
        const yTop = b.pos[1] + b.size[1] / 2;
        return (
          <rect
            key={b.key}
            x={sx(x)}
            y={sy(yTop)}
            width={b.size[0] * scale}
            height={b.size[1] * scale}
            fill={b.role === 'kick' ? '#191c21' : '#282c34'}
            stroke="#3d434e"
            strokeWidth={0.5}
          />
        );
      })}

      {fronts.map((b) => {
        const x = b.pos[0] - b.size[0] / 2;
        const yTop = b.pos[1] + b.size[1] / 2;
        const w = b.size[0] * scale;
        const h = b.size[1] * scale;
        return (
          <g key={b.key}>
            <rect x={sx(x)} y={sy(yTop)} width={w} height={h} fill={b.color} opacity={0.9} stroke="#15171b" strokeWidth={1} rx={1} />
            <rect
              x={sx(x) + 4}
              y={sy(yTop) + 4}
              width={Math.max(0, w - 8)}
              height={Math.max(0, h - 8)}
              fill="none"
              stroke="rgba(0,0,0,0.22)"
              strokeWidth={0.8}
            />
            {w > 34 && h > 16 && (
              <text
                x={sx(x) + w / 2}
                y={sy(yTop) + h / 2 + 3}
                textAnchor="middle"
                fontSize={9}
                fill="rgba(0,0,0,0.6)"
                fontFamily="ui-monospace, monospace"
              >
                {formatFrac(b.size[0])} × {formatFrac(b.size[1])}
              </text>
            )}
          </g>
        );
      })}

      {showDims && (
        <g stroke="#6f7886" fill="#8f97a5" fontSize={9} fontFamily="ui-monospace, monospace">
          {/* Overall width */}
          <line x1={sx(0)} y1={height - 16} x2={sx(cabinet.width)} y2={height - 16} />
          <line x1={sx(0)} y1={height - 20} x2={sx(0)} y2={height - 12} />
          <line x1={sx(cabinet.width)} y1={height - 20} x2={sx(cabinet.width)} y2={height - 12} />
          <text x={sx(cabinet.width / 2)} y={height - 20} textAnchor="middle" stroke="none">
            {formatFrac(cabinet.width)}"
          </text>

          {/* Overall height */}
          <line x1={16} y1={sy(yBase)} x2={16} y2={sy(yBase + cabinet.height)} />
          <line x1={12} y1={sy(yBase)} x2={20} y2={sy(yBase)} />
          <line x1={12} y1={sy(yBase + cabinet.height)} x2={20} y2={sy(yBase + cabinet.height)} />
          <text
            x={11}
            y={sy(yBase + cabinet.height / 2)}
            textAnchor="middle"
            stroke="none"
            transform={`rotate(-90 11 ${sy(yBase + cabinet.height / 2)})`}
          >
            {formatFrac(cabinet.height)}"
          </text>
        </g>
      )}
    </svg>
  );
}

/**
 * Top-down plan. Cabinets and appliances can be dragged straight onto the
 * layout; the store snaps them to a quarter inch and flush to neighbours.
 */
export function PlanView({
  project,
  selectedId,
  onSelect,
  showDims = true,
}: {
  project: Project;
  selectedId: string | null;
  onSelect: (id: string) => void;
  showDims?: boolean;
}) {
  const moveItem = useProject((s) => s.moveItem);
  const selectAppliance = useProject((s) => s.selectAppliance);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<{
    kind: 'cabinet' | 'appliance';
    id: string;
    offX: number;
    offZ: number;
  } | null>(null);

  const cabs = project.cabinets.filter((c) => !c.excluded);
  const apps = project.appliances ?? [];

  /** Pointer position in model inches. */
  const toModel = (e: React.PointerEvent): { x: number; z: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, z: p.y };
  };

  const startDrag = (e: React.PointerEvent, kind: 'cabinet' | 'appliance', id: string, x: number, z: number) => {
    const m = toModel(e);
    if (!m) return;
    // Capture keeps the drag alive if the pointer leaves the shape, but it
    // throws on an unrecognised pointer id. Losing capture is survivable;
    // losing the drag is not.
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* drag still works, it just stops tracking outside the element */
    }
    setDrag({ kind, id, offX: m.x - x, offZ: m.z - z });
    if (kind === 'cabinet') onSelect(id);
    e.stopPropagation();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const m = toModel(e);
    if (!m) return;
    moveItem(drag.kind, drag.id, m.x - drag.offX, m.z - drag.offZ);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* nothing to release */
    }
    setDrag(null);
  };

  const bounds = useMemo(() => {
    let minX = 0;
    let maxX = 120;
    let minZ = 0;
    let maxZ = 120;
    for (const item of [...cabs, ...apps]) {
      const f = footprint(item);
      minX = Math.min(minX, f.x0);
      maxX = Math.max(maxX, f.x1);
      minZ = Math.min(minZ, f.z0);
      maxZ = Math.max(maxZ, f.z1);
    }
    for (const w of project.room.walls) {
      minX = Math.min(minX, w.x1, w.x2);
      maxX = Math.max(maxX, w.x1, w.x2);
      minZ = Math.min(minZ, w.z1, w.z2);
      maxZ = Math.max(maxZ, w.z1, w.z2);
    }
    return { minX: minX - 18, maxX: maxX + 18, minZ: minZ - 18, maxZ: maxZ + 18 };
  }, [cabs, apps, project.room.walls]);

  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxZ - bounds.minZ;

  return (
    <svg
      ref={svgRef}
      viewBox={`${bounds.minX} ${bounds.minZ} ${w} ${h}`}
      style={{ width: '100%', height: '100%', touchAction: 'none' }}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <rect x={bounds.minX} y={bounds.minZ} width={w} height={h} fill="#101216" />

      {/* 12" grid */}
      <defs>
        <pattern id="plangrid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#22262e" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect x={bounds.minX} y={bounds.minZ} width={w} height={h} fill="url(#plangrid)" />

      {project.room.walls.map((wall) => (
        <line
          key={wall.id}
          x1={wall.x1}
          y1={wall.z1}
          x2={wall.x2}
          y2={wall.z2}
          stroke="#4a5260"
          strokeWidth={wall.thickness}
          strokeLinecap="square"
        />
      ))}

      {/* Appliances sit under the cabinet runs so a base box reads on top. */}
      {apps.map((a) => (
        <g
          key={a.id}
          transform={`translate(${a.x} ${a.z}) rotate(${-a.rotation})`}
          onPointerDown={(e) => {
            selectAppliance(a.id);
            startDrag(e, 'appliance', a.id, a.x, a.z);
          }}
          style={{ cursor: 'grab' }}
        >
          <rect width={a.width} height={a.depth} fill="#2f343c" stroke="#7c8694" strokeWidth={0.8} strokeDasharray="2 1.5" />
          <line x1={0} y1={0} x2={a.width} y2={a.depth} stroke="#4c545f" strokeWidth={0.5} />
          <line x1={a.width} y1={0} x2={0} y2={a.depth} stroke="#4c545f" strokeWidth={0.5} />
          {a.width > 18 && (
            <text x={a.width / 2} y={a.depth / 2 + 2.5} textAnchor="middle" fontSize={6} fill="#9aa3b2" fontFamily="ui-monospace, monospace">
              {a.name.split(' ')[0]}
            </text>
          )}
        </g>
      ))}

      {/* Wall cabinets drawn behind and dashed, base runs solid on top. */}
      {cabs
        .filter((c) => c.type === 'wall')
        .map((c) => (
          <g
            key={c.id}
            transform={`translate(${c.x} ${c.z}) rotate(${-c.rotation})`}
            onPointerDown={(e) => startDrag(e, 'cabinet', c.id, c.x, c.z)}
            style={{ cursor: 'grab' }}
          >
            <PlanShape cabinet={c} selected={c.id === selectedId} wall />
          </g>
        ))}

      {cabs
        .filter((c) => c.type !== 'wall')
        .map((c) => (
          <g
            key={c.id}
            transform={`translate(${c.x} ${c.z}) rotate(${-c.rotation})`}
            onPointerDown={(e) => startDrag(e, 'cabinet', c.id, c.x, c.z)}
            style={{ cursor: 'grab' }}
          >
            <PlanShape cabinet={c} selected={c.id === selectedId} />
          </g>
        ))}

      {showDims && <RunDimensions project={project} />}
    </svg>
  );
}

/**
 * Dimension line per wall showing the run and, in red, whatever is left over.
 * Drawn along the wall itself so it reads where the work is happening.
 */
function RunDimensions({ project }: { project: Project }) {
  const centre = roomCentre(project.room);

  return (
    <>
      {project.room.walls.map((wall) => {
        const status = runStatus(project, wall.id, false);
        if (status.cabinetCount === 0) return null;
        const f = wallFrame(wall, centre);

        // Stand the dimension line off the wall, into the room.
        const off = 30;
        const p = (along: number) => ({
          x: f.originX + f.dx * along + f.nx * off,
          z: f.originZ + f.dz * along + f.nz * off,
        });
        const a = p(status.startsAt);
        const b = p(status.filledTo);
        const c = p(status.endsAt);
        const angle = (Math.atan2(f.dz, f.dx) * 180) / Math.PI;
        const mid = p(status.startsAt + status.used / 2);
        const gapMid = p(status.startsAt + status.used + status.remaining / 2);

        return (
          <g key={wall.id} pointerEvents="none">
            <line x1={a.x} y1={a.z} x2={b.x} y2={b.z} stroke="#8b94a3" strokeWidth={0.7} />
            <text
              x={mid.x}
              y={mid.z - 2}
              textAnchor="middle"
              fontSize={7}
              fill="#b6bdc9"
              fontFamily="ui-monospace, monospace"
              transform={`rotate(${angle} ${mid.x} ${mid.z})`}
            >
              {formatFrac(status.used)}"
            </text>

            {status.remaining > 1 / 16 && (
              <>
                <line x1={b.x} y1={b.z} x2={c.x} y2={c.z} stroke="#e0705c" strokeWidth={1.2} />
                <text
                  x={gapMid.x}
                  y={gapMid.z - 2}
                  textAnchor="middle"
                  fontSize={7}
                  fill="#e0705c"
                  fontFamily="ui-monospace, monospace"
                  fontWeight={700}
                  transform={`rotate(${angle} ${gapMid.x} ${gapMid.z})`}
                >
                  {formatFrac(status.remaining)}" gap
                </text>
              </>
            )}
          </g>
        );
      })}
    </>
  );
}

/** Footprint outline, which is a pentagon for a diagonal corner. */
function PlanShape({ cabinet: c, selected, wall }: { cabinet: Cabinet; selected: boolean; wall?: boolean }) {
  const stroke = selected ? '#d99a4e' : wall ? '#6fa8d6' : '#5b6473';
  const fill = selected ? '#4a3a1e' : wall ? 'none' : '#262b33';
  const faceStroke = selected ? '#f0b970' : '#8b94a3';

  if (c.corner === 'diagonal') {
    // Square against both walls with the front corner cut off.
    const pts = `0,0 ${c.width},0 ${c.width},${c.depth} ${c.depth},${c.width} 0,${c.width}`;
    return (
      <>
        <polygon points={pts} fill={fill === 'none' ? 'none' : fill} stroke={stroke} strokeWidth={selected ? 1.4 : 0.8} strokeDasharray={wall ? '3 2' : undefined} />
        <line x1={c.width} y1={c.depth} x2={c.depth} y2={c.width} stroke={faceStroke} strokeWidth={1.6} />
      </>
    );
  }

  const blind = c.corner === 'blind' ? (c.blindWidth ?? 24) : 0;
  const faceX0 = blind && c.blindSide !== 'right' ? blind : 0;
  const faceX1 = blind && c.blindSide === 'right' ? c.width - blind : c.width;

  return (
    <>
      <rect
        width={c.width}
        height={c.depth}
        fill={fill === 'none' ? 'none' : fill}
        stroke={stroke}
        strokeWidth={selected ? 1.4 : 0.8}
        strokeDasharray={wall ? '3 2' : undefined}
      />
      {blind > 0 && (
        <rect
          x={c.blindSide === 'right' ? c.width - blind : 0}
          width={blind}
          height={c.depth}
          fill="rgba(255,255,255,0.05)"
          stroke="none"
        />
      )}
      {/* Face indicator marks only the reachable opening. */}
      <line x1={faceX0} y1={c.depth} x2={faceX1} y2={c.depth} stroke={faceStroke} strokeWidth={1.6} />
      {c.width > 14 && (
        <text x={c.width / 2} y={c.depth / 2 + 3} textAnchor="middle" fontSize={7} fill="#9aa3b2" fontFamily="ui-monospace, monospace">
          {formatFrac(c.width)}
        </text>
      )}
    </>
  );
}
