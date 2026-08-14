import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Appliance, Cabinet, Project } from '../domain/types';
import {
  isVisibleWithWalls,
  overlapsInPlan,
  roomCentre,
  runStatus,
  wallFrame,
} from '../domain/geometry';
import { COOKTOP_TO_OVERHEAD_UNIT } from '../domain/defaults';
import { formatFrac } from '../domain/units';

/** Scene units are feet; the model is in inches. */
const S = 1 / 12;

const LINE = '#7fa8c9';
const GAP_LINE = '#e0705c';

/**
 * Dimension line with a tick at each end, drawn from points given in inches.
 * `lineSegments` takes point pairs, so each segment is listed explicitly.
 */
function DimLine({ pairs, color }: { pairs: [number, number, number][][]; color: string }) {
  const geometry = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (const [a, b] of pairs) {
      pts.push(new THREE.Vector3(a[0] * S, a[1] * S, a[2] * S));
      pts.push(new THREE.Vector3(b[0] * S, b[1] * S, b[2] * S));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [pairs]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
    </lineSegments>
  );
}

function DimLabel({
  at,
  text,
  tone = 'normal',
}: {
  at: [number, number, number];
  text: string;
  tone?: 'normal' | 'gap';
}) {
  return (
    <Html
      center
      position={[at[0] * S, at[1] * S, at[2] * S]}
      zIndexRange={[20, 0]}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
    >
      <span className={`dim3d${tone === 'gap' ? ' gap' : ''}`}>{text}</span>
    </Html>
  );
}

/**
 * Horizontal width dimension across the front of a unit.
 *
 * Appliances get one too — a range standing in a run is as much a part of
 * that run as the cabinets either side, and leaving it off made the run's
 * dimensions stop making sense where the appliance sat.
 */
function WidthDimension({ item }: { item: Cabinet | Appliance }) {
  const isCabinet = 'type' in item;
  const W = item.width;
  const base = isCabinet ? (item.mountHeight ?? (item.type === 'wall' ? 54 : 0)) : item.mountHeight;
  // Sit the line just clear of the top: above the counter on a base run,
  // above the box on a wall run.
  const high = isCabinet && (item.type === 'wall' || item.type === 'tall');
  const y = base + item.height + (high ? 3 : 4.5);
  const z = item.depth;
  const tick = 1.5;

  const pairs: [number, number, number][][] = [
    [
      [0, y, z],
      [W, y, z],
    ],
    [
      [0, y - tick, z],
      [0, y + tick, z],
    ],
    [
      [W, y - tick, z],
      [W, y + tick, z],
    ],
  ];

  return (
    <group position={[item.x * S, 0, item.z * S]} rotation={[0, (item.rotation * Math.PI) / 180, 0]}>
      <DimLine pairs={pairs} color={LINE} />
      <DimLabel at={[W / 2, y + 2.5, z]} text={`${formatFrac(W)}"`} />
    </group>
  );
}

/**
 * Vertical clearance from a counter up to whatever hangs above it — a wall
 * cabinet, a microwave, a hood. This is the measurement that decides whether
 * a mixer fits under the uppers, and it is the one people ask about most.
 */
function ClearanceDimension({
  cabinet,
  above,
  label,
}: {
  cabinet: Cabinet;
  above: number;
  label: string;
}) {
  const counter = (cabinet.mountHeight ?? 0) + cabinet.height + 1.5;
  if (above - counter < 2) return null;

  const x = Math.min(3, cabinet.width / 2);
  const z = cabinet.depth;
  const tick = 1.5;

  const pairs: [number, number, number][][] = [
    [
      [x, counter, z],
      [x, above, z],
    ],
    [
      [x - tick, counter, z],
      [x + tick, counter, z],
    ],
    [
      [x - tick, above, z],
      [x + tick, above, z],
    ],
  ];

  return (
    <group
      position={[cabinet.x * S, 0, cabinet.z * S]}
      rotation={[0, (cabinet.rotation * Math.PI) / 180, 0]}
    >
      <DimLine pairs={pairs} color={LINE} />
      <DimLabel at={[x, (counter + above) / 2, z]} text={`${formatFrac(above - counter)}" ${label}`} />
    </group>
  );
}

/**
 * Clearance from a cooking surface up to whatever hangs over it.
 *
 * This is the dimension that decides whether the kitchen passes inspection,
 * so it is drawn at the centre of the appliance where it cannot be missed and
 * turns red the moment it drops under the recommended 30".
 */
function CookClearance({
  appliance,
  above,
  label,
}: {
  appliance: Appliance;
  above: number;
  label: string;
}) {
  const top = appliance.mountHeight + appliance.height;
  if (above - top < 1) return null;

  const gap = above - top;
  const tight = gap < COOKTOP_TO_OVERHEAD_UNIT;
  const colour = tight ? GAP_LINE : LINE;

  const x = appliance.width / 2;
  const z = appliance.depth;
  const tick = 3;

  const pairs: [number, number, number][][] = [
    [
      [x, top, z],
      [x, above, z],
    ],
    [
      [x - tick, top, z],
      [x + tick, top, z],
    ],
    [
      [x - tick, above, z],
      [x + tick, above, z],
    ],
  ];

  return (
    <group
      position={[appliance.x * S, 0, appliance.z * S]}
      rotation={[0, (appliance.rotation * Math.PI) / 180, 0]}
    >
      <DimLine pairs={pairs} color={colour} />
      <DimLabel
        at={[x, (top + above) / 2, z]}
        text={`${formatFrac(gap)}" ${label}`}
        tone={tight ? 'gap' : 'normal'}
      />
    </group>
  );
}

/**
 * Blueprint-style annotations over the model. Everything here is derived from
 * the same geometry the cut list uses, so a dimension on screen is a dimension
 * you can cut to.
 */
export function Dimensions3D({ project }: { project: Project }) {
  // Hiding a wall takes its dimensions with it, or the drawing keeps calling
  // out sizes for cabinets that are no longer on screen.
  const anyHidden = project.room.walls.some((w) => w.hidden);
  const active = project.cabinets.filter(
    (c) => !c.excluded && (!anyHidden || isVisibleWithWalls(c, project.room)),
  );
  const apps = (project.appliances ?? []).filter(
    (a) => !anyHidden || isVisibleWithWalls(a, project.room),
  );
  const centre = useMemo(() => roomCentre(project.room), [project.room]);

  // Pair each base cabinet with the lowest thing hanging over it.
  const clearances = useMemo(() => {
    const out: { cabinet: Cabinet; above: number; label: string }[] = [];

    for (const cab of active) {
      if (cab.type !== 'base' && cab.type !== 'vanity') continue;
      const counter = (cab.mountHeight ?? 0) + cab.height + 1.5;

      // Everything hanging over this cabinet, lowest first.
      const overhead: { y: number; label: string }[] = [];
      for (const other of active) {
        if (other.id === cab.id || other.type !== 'wall') continue;
        if (overlapsInPlan(cab, other)) overhead.push({ y: other.mountHeight ?? 54, label: 'to upper' });
      }
      for (const a of apps as Appliance[]) {
        if (a.mountHeight <= 0 || !overlapsInPlan(cab, a)) continue;
        overhead.push({ y: a.mountHeight, label: a.kind === 'hood' ? 'to hood' : 'to appliance' });
      }

      const lowest = overhead
        .filter((o) => o.y > counter + 2)
        .sort((a, b) => a.y - b.y)[0];
      if (lowest) out.push({ cabinet: cab, above: lowest.y, label: lowest.label });
    }
    return out;
  }, [active, apps]);

  // Same idea for a range or cooktop: measure up to whatever hangs over it.
  const cookClearances = useMemo(() => {
    const out: { appliance: Appliance; above: number; label: string }[] = [];
    for (const cook of apps) {
      if (cook.kind !== 'range' && cook.kind !== 'cooktop') continue;
      const top = cook.mountHeight + cook.height;

      const overhead: { y: number; label: string }[] = [];
      for (const a of apps) {
        if (a.id === cook.id || !overlapsInPlan(cook, a)) continue;
        if (a.mountHeight > top + 1) {
          overhead.push({ y: a.mountHeight, label: a.kind === 'hood' ? 'to hood' : 'to microwave' });
        }
      }
      for (const c of active) {
        if (c.type !== 'wall' || !overlapsInPlan(cook, c)) continue;
        const bottom = c.mountHeight ?? 54;
        if (bottom > top + 1) overhead.push({ y: bottom, label: 'to cabinet' });
      }

      const lowest = overhead.sort((a, b) => a.y - b.y)[0];
      if (lowest) out.push({ appliance: cook, above: lowest.y, label: lowest.label });
    }
    return out;
  }, [active, apps]);

  return (
    <group>
      {active
        .filter((c) => c.type !== 'filler' || c.width > 2)
        .map((c) => (
          <WidthDimension key={`w-${c.id}`} item={c} />
        ))}

      {/* Appliances standing in a run are dimensioned like the cabinets. */}
      {apps
        .filter((a) => a.mountHeight < 48)
        .map((a) => (
          <WidthDimension key={`wa-${a.id}`} item={a} />
        ))}

      {clearances.map((c) => (
        <ClearanceDimension key={`c-${c.cabinet.id}`} cabinet={c.cabinet} above={c.above} label={c.label} />
      ))}

      {cookClearances.map((c) => (
        <CookClearance key={`k-${c.appliance.id}`} appliance={c.appliance} above={c.above} label={c.label} />
      ))}

      {/* Leftover at the end of each wall's base run. */}
      {project.room.walls.map((wall) => {
        if (wall.hidden) return null;
        const status = runStatus(project, wall.id, false);
        if (status.cabinetCount === 0 || status.remaining < 0.5) return null;
        const f = wallFrame(wall, centre);
        const y = 38;
        // Start where the run actually stops. Using the cabinet widths alone
        // ignored the range and the fridge, so the line began before them and
        // struck straight through both.
        const from = status.filledTo;
        const to = status.endsAt;

        const at = (along: number): [number, number, number] => [
          f.originX + f.dx * along + f.nx * 12,
          y,
          f.originZ + f.dz * along + f.nz * 12,
        ];
        const a = at(from);
        const b = at(to);
        const mid = at((from + to) / 2);

        return (
          <group key={`gap-${wall.id}`}>
            <DimLine
              pairs={[
                [a, b],
                [
                  [a[0], a[1] - 2, a[2]],
                  [a[0], a[1] + 2, a[2]],
                ],
                [
                  [b[0], b[1] - 2, b[2]],
                  [b[0], b[1] + 2, b[2]],
                ],
              ]}
              color={GAP_LINE}
            />
            <DimLabel at={[mid[0], mid[1] + 3, mid[2]]} text={`${formatFrac(status.remaining)}" gap`} tone="gap" />
          </group>
        );
      })}
    </group>
  );
}
