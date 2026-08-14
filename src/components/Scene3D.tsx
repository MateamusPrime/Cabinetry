import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type {
  Appliance,
  BarTop,
  Cabinet,
  Project,
  PullStyle,
  Wall,
  WindowOpening,
} from '../domain/types';
import {
  buildApplianceGeometry,
  buildBarTopGeometry,
  buildCabinetGeometry,
  buildSinkGeometry,
  crownRuns,
  doorPullSide,
  footprint,
  isVisibleWithWalls,
  roomCentre,
  wallFrame,
  wallOpeningRects,
  type Box3D,
  type CrownRunPath,
} from '../domain/geometry';
import { DEFAULT_VIEW } from '../domain/defaults';
import { Dimensions3D } from './Dimensions3D';
import { useProject } from '../store/useProject';

/** Scene units are feet; the model is in inches. */
const S = 1 / 12;

/** Crown cross-section: face at the bottom, cove out and up, small flat on top. */
function crownProfile(h: number, p: number): [number, number][] {
  return [
    [0, 0],
    [p * 0.16, h * 0.42],
    [p * 0.44, h * 0.7],
    [p * 0.74, h * 0.89],
    [p, h],
    [p, h + 0.35],
    [0, h + 0.35],
  ];
}

/**
 * Crown swept along a path with mitred joints.
 *
 * A ring of profile points is emitted at every vertex and the rings are
 * stitched together. At a corner the profile's outward direction is the
 * bisector of the two segments, stretched by 1/cos(half-angle) so the two
 * lengths meet cleanly — which is exactly what cutting a mitre does, and why
 * inside and outside corners both close instead of overlapping.
 */
function CrownSweep({ run }: { run: CrownRunPath }) {
  const geometry = useMemo(() => {
    const pts = run.points;
    if (pts.length < 2) return null;

    const profile = crownProfile(run.height, run.projection);
    const positions: number[] = [];
    const indices: number[] = [];

    // Outward normal of each segment, pointing away from the cabinet face.
    const segNormal: [number, number][] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1][0] - pts[i][0];
      const dz = pts[i + 1][1] - pts[i][1];
      const len = Math.hypot(dx, dz) || 1;
      segNormal.push([-dz / len, dx / len]);
    }

    const rings: [number, number, number][][] = [];
    for (let i = 0; i < pts.length; i++) {
      const nPrev = segNormal[Math.max(0, i - 1)];
      const nNext = segNormal[Math.min(segNormal.length - 1, i)];
      let nx = nPrev[0] + nNext[0];
      let nz = nPrev[1] + nNext[1];
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl;
      nz /= nl;
      // Mitre stretch: how far out the joint has to reach to close.
      const cos = Math.max(0.35, nx * nNext[0] + nz * nNext[1]);
      const stretch = 1 / cos;

      rings.push(
        profile.map(([out, up]) => [
          pts[i][0] + nx * out * stretch,
          run.y + up,
          pts[i][1] + nz * out * stretch,
        ]),
      );
    }

    const ringSize = profile.length;
    for (const ring of rings) for (const v of ring) positions.push(v[0] * S, v[1] * S, v[2] * S);

    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < ringSize; j++) {
        const a = i * ringSize + j;
        const b = i * ringSize + ((j + 1) % ringSize);
        const c = (i + 1) * ringSize + j;
        const d = (i + 1) * ringSize + ((j + 1) % ringSize);
        indices.push(a, c, b, b, c, d);
      }
    }

    // Cap the two open ends so the mitre reads as a solid cut.
    const capFan = (ringIndex: number, flip: boolean) => {
      const base = ringIndex * ringSize;
      for (let j = 1; j < ringSize - 1; j++) {
        if (flip) indices.push(base, base + j + 1, base + j);
        else indices.push(base, base + j, base + j + 1);
      }
    };
    capFan(0, true);
    capFan(rings.length - 1, false);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [run]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={run.color} roughness={0.6} metalness={0.02} side={THREE.DoubleSide} />
    </mesh>
  );
}

/**
 * A horizontal panel whose outline is a polygon rather than a rectangle —
 * the deck, top and shelves of a diagonal corner cabinet.
 */
function PolyPanel({ box, children }: { box: Box3D; children: React.ReactNode }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const pts = box.polygon!;
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: box.size[1], bevelEnabled: false });
    // Drawn in XY, so stand it up and centre it on the panel's own thickness.
    geo.rotateX(Math.PI / 2);
    geo.translate(0, box.size[1] / 2, 0);
    geo.scale(S, S, S);
    return geo;
  }, [box.polygon, box.size]);

  return (
    <mesh geometry={geometry} position={[0, box.pos[1] * S, 0]} castShadow receiveShadow>
      {children}
    </mesh>
  );
}

function CabinetMesh({
  cabinet,
  project,
  selected,
  showDoors,
  onSelect,
}: {
  cabinet: Cabinet;
  project: Project;
  selected: boolean;
  showDoors: boolean;
  onSelect: (id: string) => void;
}) {
  const boxes = useMemo(
    () => buildCabinetGeometry(cabinet, project, { showDoors }),
    [cabinet, project, showDoors],
  );

  return (
    <group
      position={[cabinet.x * S, 0, cabinet.z * S]}
      rotation={[0, (cabinet.rotation * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(cabinet.id);
      }}
    >
      {boxes.map((b) => {
        const isFront = b.role === 'door' || b.role === 'drawerFront';
        const color = selected
          ? new THREE.Color(b.color).lerp(new THREE.Color('#f0b970'), 0.35)
          : new THREE.Color(b.color);
        const material = (
          <meshStandardMaterial
            color={color}
            roughness={isFront ? 0.45 : 0.72}
            metalness={0.02}
            emissive={selected ? '#3a2a10' : '#000000'}
          />
        );

        // Shaped panels (corner decks and shelves) extrude a polygon instead
        // of drawing a box, so the 45 degree face closes properly.
        if (b.polygon) {
          return (
            <PolyPanel key={b.key} box={b}>
              {material}
            </PolyPanel>
          );
        }


        return (
          <mesh
            key={b.key}
            position={[b.pos[0] * S, b.pos[1] * S, b.pos[2] * S]}
            rotation={b.rotY ? [0, b.rotY, 0] : undefined}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[b.size[0] * S, b.size[1] * S, b.size[2] * S]} />
            {material}
          </mesh>
        );
      })}

      {/*
        Pulls, mounted where they actually go rather than centred on the panel:
        near the opening edge of a door, and near the reachable end of it —
        top of a base door, bottom of a wall door, comfortable height on a
        tall door. Wide drawers get the same pair of pulls the estimate counts.
      */}
      {showDoors &&
        boxes
          .filter((b) => b.role === 'door' || b.role === 'drawerFront')
          .flatMap((b) => {
            const isDrawer = b.role === 'drawerFront';
            // Work in the panel's own frame so a rotated corner door places
            // its pull on the 45 degree face rather than on a world axis.
            const halfW = b.size[0] / 2;
            const halfH = b.size[1] / 2;
            const localZ = (b.size[2] / 2 + 0.55) * S;
            const pullStyle = project.view?.pullStyle ?? 'bar';
            const pullColor = project.view?.pullColor ?? DEFAULT_PULL_COLOR;
            const pullMetal = project.view?.pullMetalness ?? DEFAULT_PULL_METALNESS;
            const bar = (key: string, x: number, y: number, len: number, vertical: boolean) => (
              <group
                key={key}
                position={[b.pos[0] * S, b.pos[1] * S, b.pos[2] * S]}
                rotation={b.rotY ? [0, b.rotY, 0] : undefined}
              >
                <Pull
                  style={pullStyle}
                  color={pullColor}
                  metalness={pullMetal}
                  x={(x - b.pos[0]) * S}
                  y={(y - b.pos[1]) * S}
                  z={localZ}
                  len={len}
                  vertical={vertical}
                  isDrawer={isDrawer}
                />
              </group>
            );

            const left = b.pos[0] - halfW;
            const right = b.pos[0] + halfW;
            const top = b.pos[1] + halfH;
            const bottom = b.pos[1] - halfH;

            if (isDrawer) {
              const len = Math.min(6, b.size[0] * 0.45);
              // Matches the estimator, which bills two pulls over 24" wide.
              if (b.size[0] > 24) {
                const q = b.size[0] / 4;
                return [
                  bar(`${b.key}-pull-l`, b.pos[0] - q, b.pos[1], len, false),
                  bar(`${b.key}-pull-r`, b.pos[0] + q, b.pos[1], len, false),
                ];
              }
              return [bar(`${b.key}-pull`, b.pos[0], b.pos[1], len, false)];
            }

            // Door: the pull goes on the edge that opens, opposite the hinges.
            // The rule lives in the domain layer so it can be tested.
            const inset = 2.25;
            const x = doorPullSide(cabinet, b.pos[0]) === 'right' ? right - inset : left + inset;

            const len = Math.min(6, b.size[1] * 0.35);
            const y =
              cabinet.type === 'wall'
                ? bottom + Math.max(3, len / 2 + 1)
                : cabinet.type === 'tall'
                  ? Math.min(top - 3, 45)
                  : top - Math.max(3, len / 2 + 1);

            return [bar(`${b.key}-pull`, x, y, len, true)];
          })}
    </group>
  );
}

function ApplianceMesh({
  appliance,
  selected,
  onSelect,
}: {
  appliance: Appliance;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const boxes = useMemo(() => buildApplianceGeometry(appliance), [appliance]);
  return (
    <group
      position={[appliance.x * S, 0, appliance.z * S]}
      rotation={[0, (appliance.rotation * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(appliance.id);
      }}
    >
      {boxes.map((b) => (
        <mesh key={b.key} position={[b.pos[0] * S, b.pos[1] * S, b.pos[2] * S]} castShadow receiveShadow>
          <boxGeometry args={[b.size[0] * S, b.size[1] * S, b.size[2] * S]} />
          <meshStandardMaterial
            color={
              selected
                ? new THREE.Color(b.color).lerp(new THREE.Color('#f0b970'), 0.45)
                : new THREE.Color(b.color)
            }
            roughness={0.32}
            metalness={0.55}
            emissive={selected ? '#3a2a10' : '#000000'}
          />
        </mesh>
      ))}
    </group>
  );
}

function BarTopMesh({
  bar,
  project,
  counterColor,
  selected,
  onSelect,
}: {
  bar: BarTop;
  project: Project;
  counterColor: string;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const boxes = useMemo(
    () => buildBarTopGeometry(bar, project, counterColor),
    [bar, project, counterColor],
  );
  return (
    <group
      position={[bar.x * S, 0, bar.z * S]}
      rotation={[0, (bar.rotation * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(bar.id);
      }}
    >
      {boxes.map((b) => (
        <mesh key={b.key} position={[b.pos[0] * S, b.pos[1] * S, b.pos[2] * S]} castShadow receiveShadow>
          <boxGeometry args={[b.size[0] * S, b.size[1] * S, b.size[2] * S]} />
          <meshStandardMaterial
            color={
              selected
                ? new THREE.Color(b.color).lerp(new THREE.Color('#f0b970'), 0.45)
                : new THREE.Color(b.color)
            }
            roughness={0.4}
            metalness={0.05}
            emissive={selected ? '#3a2a10' : '#000000'}
          />
        </mesh>
      ))}
    </group>
  );
}

const DEFAULT_PULL_COLOR = '#8b8f96';
const DEFAULT_PULL_METALNESS = 0.75;

/**
 * One piece of hardware, drawn in its panel's own frame so a corner door's
 * pull lands on the 45 degree face rather than on a world axis.
 *
 * `len` is the centre-to-centre length a bar would take; the point styles
 * ignore it. Everything is modelled standing off the face by its own posts,
 * because a pull flat against the door reads as a painted stripe.
 */
function Pull({
  style,
  color,
  metalness,
  x,
  y,
  z,
  len,
  vertical,
  isDrawer,
}: {
  style: PullStyle;
  color: string;
  metalness: number;
  x: number;
  y: number;
  z: number;
  len: number;
  vertical: boolean;
  isDrawer: boolean;
}) {
  const mat = (
    <meshStandardMaterial color={color} roughness={0.35 + (1 - metalness) * 0.35} metalness={metalness} />
  );
  const r = 0.2 * S;

  // A bin pull only belongs on a drawer; a door takes a knob instead.
  const shape: PullStyle = style === 'cup' && !isDrawer ? 'knob' : style;

  if (shape === 'knob') {
    const post = 0.55 * S;
    return (
      <group position={[x, y, z - 0.55 * S]}>
        <mesh position={[0, 0, post / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.16 * S, 0.16 * S, post, 10]} />
          {mat}
        </mesh>
        <mesh position={[0, 0, post + 0.3 * S]}>
          <sphereGeometry args={[0.55 * S, 16, 12]} />
          {mat}
        </mesh>
      </group>
    );
  }

  if (shape === 'edge') {
    // A tab that stands off the face just enough to get a finger behind.
    const L = len * S;
    return (
      <group position={[x, y, z - 0.4 * S]}>
        <mesh position={[0, 0, 0.4 * S]}>
          <boxGeometry
            args={vertical ? [0.55 * S, L, 0.8 * S] : [L, 0.55 * S, 0.8 * S]}
          />
          {mat}
        </mesh>
      </group>
    );
  }

  if (shape === 'cup') {
    const L = len * S;
    // Half a tube, opening downward, on a flat back — a bin pull.
    return (
      <group position={[x, y, z - 0.5 * S]}>
        <mesh position={[0, 0, 0.15 * S]}>
          <boxGeometry args={[L, 1.1 * S, 0.3 * S]} />
          {mat}
        </mesh>
        <mesh position={[0, 0.1 * S, 0.75 * S]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.65 * S, 0.65 * S, L, 14, 1, true, 0, Math.PI]} />
          {mat}
        </mesh>
      </group>
    );
  }

  // Bar: a tube on two posts, which is what gives it its shadow line.
  const half = (len / 2) * S;
  const stand = 0.9 * S;
  const postAt = (o: number) => (
    <mesh
      key={o}
      position={vertical ? [0, o, z - stand / 2] : [o, 0, z - stand / 2]}
      rotation={[Math.PI / 2, 0, 0]}
    >
      <cylinderGeometry args={[0.12 * S, 0.12 * S, stand, 8]} />
      {mat}
    </mesh>
  );

  return (
    <group position={[x, y, 0]}>
      {[half * 0.78, -half * 0.78].map(postAt)}
      <mesh position={[0, 0, z]} rotation={vertical ? [0, 0, 0] : [0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[r, r, len * S, 12]} />
        {mat}
      </mesh>
    </group>
  );
}

/** Counter overhang past the door face, in inches. */
const COUNTER_OVERHANG = 1;
const COUNTER_THICKNESS = 1.5;

/**
 * Countertop for a diagonal corner: the cabinet's pentagon footprint with the
 * overhang added on the 45 degree face only. The two side edges butt against
 * the returning counter runs, so they get no overhang.
 *
 * Shifting a 45 degree line out by `o` perpendicular moves its axis
 * intercepts by `o * sqrt(2)`, which is where the extra term comes from.
 */
function CornerCountertop({ cabinet, color }: { cabinet: Cabinet; color: string }) {
  const geometry = useMemo(() => {
    const W = cabinet.width;
    const D = cabinet.depth;
    const e = COUNTER_OVERHANG * Math.SQRT2;

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(W, 0);
    shape.lineTo(W, D + e);
    shape.lineTo(D + e, W);
    shape.lineTo(0, W);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: COUNTER_THICKNESS, bevelEnabled: false });
    // The shape is drawn in XY; stand it up so the extrusion runs vertically.
    geo.rotateX(Math.PI / 2);
    geo.scale(S, S, S);
    return geo;
  }, [cabinet.width, cabinet.depth]);

  return (
    <mesh
      geometry={geometry}
      position={[cabinet.x * S, (cabinet.height + COUNTER_THICKNESS) * S, cabinet.z * S]}
      rotation={[0, (cabinet.rotation * Math.PI) / 180, 0]}
      receiveShadow
    >
      <meshStandardMaterial color={color} roughness={0.28} metalness={0.05} />
    </mesh>
  );
}

/**
 * A straight counter slab with an optional sink cutout. Built as an extruded
 * shape rather than a box so the hole is a real hole you can see the basin
 * through.
 */
function CounterSlab({ cabinet, color }: { cabinet: Cabinet; color: string }) {
  const counterTop = cabinet.height + COUNTER_THICKNESS;
  const sink = useMemo(() => buildSinkGeometry(cabinet, counterTop), [cabinet, counterTop]);

  const geometry = useMemo(() => {
    const W = cabinet.width;
    const D = cabinet.depth + COUNTER_OVERHANG;

    const farmhouse = !!sink.apron;
    const cut = sink.cutout;
    const hx0 = cut ? Math.max(0.5, cut.x0) : 0;
    const hx1 = cut ? Math.min(W - 0.5, cut.x1) : 0;
    const hz0 = cut ? Math.max(0.5, cut.z0) : 0;
    const notched = farmhouse && !!cut && hx1 - hx0 > 1;

    const shape = new THREE.Shape();
    if (notched) {
      /*
       * An apron sink is open at the front: the counter stops either side of
       * the bowl and its edge returns back toward the wall. This traces round
       * that notch rather than punching a closed hole, which would leave a
       * strip of stone running across the apron — not a thing anyone builds.
       */
      shape.moveTo(0, 0);
      shape.lineTo(W, 0);
      shape.lineTo(W, D);
      shape.lineTo(hx1, D);
      shape.lineTo(hx1, hz0);
      shape.lineTo(hx0, hz0);
      shape.lineTo(hx0, D);
      shape.lineTo(0, D);
      shape.closePath();
    } else {
      shape.moveTo(0, 0);
      shape.lineTo(W, 0);
      shape.lineTo(W, D);
      shape.lineTo(0, D);
      shape.closePath();

      if (cut) {
        const hz1 = Math.min(D - 0.5, cut.z1);
        if (hx1 - hx0 > 1 && hz1 - hz0 > 1) {
          const hole = new THREE.Path();
          hole.moveTo(hx0, hz0);
          hole.lineTo(hx1, hz0);
          hole.lineTo(hx1, hz1);
          hole.lineTo(hx0, hz1);
          hole.closePath();
          shape.holes.push(hole);
        }
      }
    }

    const geo = new THREE.ExtrudeGeometry(shape, { depth: COUNTER_THICKNESS, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    geo.scale(S, S, S);
    return geo;
  }, [cabinet.width, cabinet.depth, sink.cutout, sink.apron]);

  return (
    <group
      position={[cabinet.x * S, 0, cabinet.z * S]}
      rotation={[0, (cabinet.rotation * Math.PI) / 180, 0]}
    >
      <mesh geometry={geometry} position={[0, counterTop * S, 0]} receiveShadow>
        <meshStandardMaterial color={color} roughness={0.28} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>

      {sink.boxes.map((b) => (
        <mesh key={b.key} position={[b.pos[0] * S, b.pos[1] * S, b.pos[2] * S]} castShadow receiveShadow>
          <boxGeometry args={[b.size[0] * S, b.size[1] * S, b.size[2] * S]} />
          <meshStandardMaterial color={b.color} roughness={0.22} metalness={0.5} />
        </mesh>
      ))}

      {sink.faucet && <Faucet at={sink.faucet} />}
    </group>
  );
}

/** Gooseneck faucet: a column, an arc of short segments, and a spout. */
function Faucet({ at }: { at: { x: number; y: number; z: number } }) {
  const metal = '#b6bcc4';
  const H = 9;
  const reach = 5;
  const segments = 7;

  return (
    <group position={[at.x * S, at.y * S, at.z * S]}>
      <mesh position={[0, 0.15 * S, 0]}>
        <cylinderGeometry args={[1.1 * S, 1.3 * S, 0.6 * S, 16]} />
        <meshStandardMaterial color={metal} roughness={0.2} metalness={0.85} />
      </mesh>
      <mesh position={[0, (H / 2) * S, 0]}>
        <cylinderGeometry args={[0.45 * S, 0.45 * S, H * S, 14]} />
        <meshStandardMaterial color={metal} roughness={0.2} metalness={0.85} />
      </mesh>
      {Array.from({ length: segments }, (_, i) => {
        // Quarter-circle sweep from the top of the column out over the bowl.
        const t = (i / (segments - 1)) * (Math.PI / 2);
        const r = reach;
        return (
          <mesh
            key={i}
            position={[0, (H + Math.sin(t) * r * 0.45) * S, (Math.cos(t) === 1 ? 0 : (1 - Math.cos(t)) * r) * S]}
          >
            <sphereGeometry args={[0.42 * S, 10, 8]} />
            <meshStandardMaterial color={metal} roughness={0.2} metalness={0.85} />
          </mesh>
        );
      })}
      <mesh position={[0, (H + reach * 0.45 - 1) * S, reach * S]}>
        <cylinderGeometry args={[0.35 * S, 0.35 * S, 2 * S, 12]} />
        <meshStandardMaterial color={metal} roughness={0.2} metalness={0.85} />
      </mesh>
    </group>
  );
}

/**
 * Appliances that live under the counter and therefore need one over them.
 * A range brings its own top and a refrigerator is full height, so neither
 * belongs here.
 */
const UNDER_COUNTER = new Set(['dishwasher', 'wineFridge']);

function Countertop({
  cabinets,
  appliances,
  counterColor,
}: {
  cabinets: Cabinet[];
  appliances: Appliance[];
  counterColor: string;
}) {
  const runs = cabinets.filter((c) => c.type === 'base' || c.type === 'vanity');
  // Counter height comes from the run it sits in, so a vanity does not get a
  // kitchen-height slab over its dishwasher.
  const runHeight = runs.length ? runs[0].height : 34.5;
  const underCounter = appliances.filter((a) => UNDER_COUNTER.has(a.kind) && a.mountHeight < 1);

  if (runs.length === 0 && underCounter.length === 0) return null;

  return (
    <>
      {runs.map((c) =>
        c.corner === 'diagonal' ? (
          <CornerCountertop key={`${c.id}-top`} cabinet={c} color={counterColor} />
        ) : (
          <CounterSlab key={`${c.id}-top`} cabinet={c} color={counterColor} />
        ),
      )}

      {/* The counter runs over a dishwasher just as it does over a cabinet. */}
      {underCounter.map((a) => (
        <group
          key={`${a.id}-top`}
          position={[a.x * S, 0, a.z * S]}
          rotation={[0, (a.rotation * Math.PI) / 180, 0]}
        >
          <mesh
            position={[
              (a.width / 2) * S,
              (runHeight + COUNTER_THICKNESS / 2) * S,
              (a.depth / 2 + COUNTER_OVERHANG / 2) * S,
            ]}
            receiveShadow
          >
            <boxGeometry args={[a.width * S, COUNTER_THICKNESS * S, (a.depth + COUNTER_OVERHANG) * S]} />
            <meshStandardMaterial color={counterColor} roughness={0.28} metalness={0.05} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/**
 * One wall, drawn in its own frame so a window opening lands exactly where
 * `along` says — the same coordinate cabinets are placed with.
 *
 * The slab is extruded from a rectangle with a hole punched per window rather
 * than drawn as a box, so an opening is a real void through the wall: you can
 * see the room beyond it and it takes the wall's own thickness.
 */
function WallSlab({
  wall,
  windows,
  frame,
  color,
  onSelectWindow,
  selectedWindowId,
}: {
  wall: Wall;
  windows: WindowOpening[];
  frame: ReturnType<typeof wallFrame>;
  color: string;
  onSelectWindow: (id: string) => void;
  selectedWindowId: string | null;
}) {
  const cut = windows.filter((w) => !w.hidden);

  const geometry = useMemo(() => {
    const L = frame.length * S;
    const H = wall.height * S;

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(L, 0);
    shape.lineTo(L, H);
    shape.lineTo(0, H);
    shape.closePath();

    for (const r of wallOpeningRects(wall, frame.length, cut)) {
      const hole = new THREE.Path();
      hole.moveTo(r.x0 * S, r.y0 * S);
      hole.lineTo(r.x1 * S, r.y0 * S);
      hole.lineTo(r.x1 * S, r.y1 * S);
      hole.lineTo(r.x0 * S, r.y1 * S);
      hole.closePath();
      shape.holes.push(hole);
    }

    const g = new THREE.ExtrudeGeometry(shape, {
      depth: wall.thickness * S,
      bevelEnabled: false,
    });
    // Extrusion runs along +z from zero; the wall sits behind its own line.
    g.translate(0, 0, -wall.thickness * S);
    return g;
  }, [cut, frame.length, wall.height, wall.thickness]);

  return (
    <group
      position={[frame.originX * S, 0, frame.originZ * S]}
      rotation={[0, (frame.rotation * Math.PI) / 180, 0]}
    >
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial color={color} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {cut.map((w) => (
        <WindowTrim
          key={w.id}
          window={w}
          thickness={wall.thickness}
          selected={w.id === selectedWindowId}
          onSelect={onSelectWindow}
        />
      ))}
    </group>
  );
}

/**
 * Casing round an opening plus a pane of glass, so a window reads as a window
 * rather than a rectangular hole to nowhere. Cosmetic only.
 */
function WindowTrim({
  window: win,
  thickness,
  selected,
  onSelect,
}: {
  window: WindowOpening;
  thickness: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const c = win.casingWidth;
  const x0 = win.along;
  const x1 = win.along + win.width;
  const y0 = win.sillHeight;
  const y1 = win.sillHeight + win.height;
  const trimColor = selected ? '#f0b970' : '#e8e6e1';

  // Casing stands just proud of the room-side face of the wall.
  const zFace = 0.4;
  const bar = (key: string, ax0: number, ax1: number, ay0: number, ay1: number) => (
    <mesh
      key={key}
      position={[((ax0 + ax1) / 2) * S, ((ay0 + ay1) / 2) * S, (zFace / 2) * S]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(win.id);
      }}
      castShadow
    >
      <boxGeometry args={[(ax1 - ax0) * S, (ay1 - ay0) * S, zFace * S]} />
      <meshStandardMaterial color={trimColor} roughness={0.6} />
    </mesh>
  );

  return (
    <group>
      {bar('head', x0 - c, x1 + c, y1, y1 + c)}
      {bar('sill', x0 - c, x1 + c, y0 - c, y0)}
      {bar('left', x0 - c, x0, y0, y1)}
      {bar('right', x1, x1 + c, y0, y1)}

      {/* Glass, set in the middle of the wall's thickness. */}
      <mesh
        position={[((x0 + x1) / 2) * S, ((y0 + y1) / 2) * S, (-thickness / 2) * S]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(win.id);
        }}
      >
        <boxGeometry args={[win.width * S, win.height * S, 0.06 * S]} />
        <meshStandardMaterial
          color="#cfe4ee"
          roughness={0.08}
          metalness={0.1}
          transparent
          opacity={0.34}
        />
      </mesh>
    </group>
  );
}

function Walls({ project, color }: { project: Project; color: string }) {
  const centre = useMemo(() => roomCentre(project.room), [project.room]);
  const selectWindow = useProject((s) => s.selectWindow);
  const selectedWindowId = useProject((s) => s.selectedWindowId);

  return (
    <>
      {project.room.walls.map((w) => {
        if (w.hidden) return null;
        const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1);
        if (len < 1) return null;

        return (
          <WallSlab
            key={w.id}
            wall={w}
            windows={(project.windows ?? []).filter((win) => win.wallId === w.id)}
            frame={wallFrame(w, centre)}
            color={color}
            onSelectWindow={selectWindow}
            selectedWindowId={selectedWindowId}
          />
        );
      })}
    </>
  );
}

/**
 * A WebGL context can be dropped by the driver at any time — most often on
 * integrated graphics, or when React's StrictMode mounts, unmounts and
 * remounts the canvas during development. The canvas then paints nothing and
 * reads as a blank white panel with only `THREE.WebGLRenderer: Context Lost`
 * in the console.
 *
 * Calling preventDefault on the lost event is what allows the browser to hand
 * back a restored context at all. Remounting the whole canvas on a new key is
 * the reliable way to rebuild the scene's GPU resources afterwards.
 */
const MAX_AUTO_RECOVERIES = 3;

function useContextLossRecovery() {
  const [canvasKey, setCanvasKey] = useState(0);
  const [lost, setLost] = useState(false);
  const attempts = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const remount = useCallback(() => {
    window.clearTimeout(timer.current);
    // A frame of delay lets the browser finish tearing the old context down
    // before a fresh canvas asks for a new one.
    timer.current = window.setTimeout(() => {
      setLost(false);
      setCanvasKey((k) => k + 1);
    }, 60);
  }, []);

  const attach = useCallback(
    (canvas: HTMLCanvasElement) => {
      const onLost = (e: Event) => {
        // Without preventDefault the browser will never offer a restore.
        e.preventDefault();
        if (attempts.current < MAX_AUTO_RECOVERIES) {
          attempts.current += 1;
          remount();
        } else {
          setLost(true);
        }
      };
      canvas.addEventListener('webglcontextlost', onLost);
      canvas.addEventListener('webglcontextrestored', remount);
    },
    [remount],
  );

  const retry = useCallback(() => {
    attempts.current = 0;
    setLost(false);
    setCanvasKey((k) => k + 1);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { canvasKey, lost, attach, retry };
}

export function Scene3D() {
  const project = useProject((s) => s.project);
  const selectedId = useProject((s) => s.selectedCabinetId);
  const select = useProject((s) => s.select);
  const selectedApplianceId = useProject((s) => s.selectedApplianceId);
  const selectAppliance = useProject((s) => s.selectAppliance);
  const selectedBarTopId = useProject((s) => s.selectedBarTopId);
  const selectBarTop = useProject((s) => s.selectBarTop);
  const showDoors = useProject((s) => s.showDoors);
  const showDimensions = useProject((s) => s.showDimensions);

  // Frame the camera on whatever has been drawn so far.
  const center = useMemo(() => {
    if (project.cabinets.length === 0) return { cx: 6, cz: 2, span: 14 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const c of project.cabinets) {
      const f = footprint(c);
      minX = Math.min(minX, f.x0);
      maxX = Math.max(maxX, f.x1);
      minZ = Math.min(minZ, f.z0);
      maxZ = Math.max(maxZ, f.z1);
    }
    return {
      cx: ((minX + maxX) / 2) * S,
      cz: ((minZ + maxZ) / 2) * S,
      span: Math.max((maxX - minX) * S, 8),
    };
  }, [project.cabinets]);

  const view = project.view ?? DEFAULT_VIEW;
  const b = view.brightness ?? 1;

  /*
   * Hiding a wall hides what stands on it, so you can look into the room past
   * the near side. Presentation only — everything hidden stays in the cut
   * list and the estimate.
   */
  const anyWallHidden = project.room.walls.some((w) => w.hidden);
  const shownCabinets = useMemo(
    () =>
      project.cabinets.filter(
        (c) => !c.excluded && (!anyWallHidden || isVisibleWithWalls(c, project.room)),
      ),
    [project.cabinets, project.room, anyWallHidden],
  );
  const shownAppliances = useMemo(
    () =>
      (project.appliances ?? []).filter(
        (a) => !anyWallHidden || isVisibleWithWalls(a, project.room),
      ),
    [project.appliances, project.room, anyWallHidden],
  );

  const crownPaths = useMemo(
    () => crownRuns({ ...project, cabinets: shownCabinets }),
    [project, shownCabinets],
  );

  // Derive grid lines from the background so they stay visible on a light
  // backdrop as well as a dark one.
  const { gridCell, gridSection } = useMemo(() => {
    const bg = new THREE.Color(view.background);
    const light = bg.r * 0.299 + bg.g * 0.587 + bg.b * 0.114 > 0.5;
    const shift = (amount: number) =>
      '#' + bg.clone().lerp(new THREE.Color(light ? '#000000' : '#ffffff'), amount).getHexString();
    return { gridCell: shift(0.12), gridSection: shift(0.26) };
  }, [view.background]);

  const { canvasKey, lost, attach, retry } = useContextLossRecovery();

  if (lost) {
    return (
      <div className="empty">
        <h3>The 3D view lost its graphics context</h3>
        <p>
          This usually means the graphics driver reclaimed it. Your project is untouched — the plan view, cut list and
          estimate all still work.
        </p>
        <button className="primary" onClick={retry} style={{ marginTop: 10 }}>
          Restart the 3D view
        </button>
      </div>
    );
  }

  return (
    <Canvas
      key={canvasKey}
      shadows
      // Capped below 2 so a high-DPI display does not quietly quadruple the
      // pixel count on integrated graphics.
      dpr={[1, 1.5]}
      camera={{ position: [center.cx + center.span * 0.7, 6, center.cz + center.span * 1.1], fov: 42 }}
      onPointerMissed={() => select(null)}
      onCreated={(state) => attach(state.gl.domElement)}
    >
      <color attach="background" args={[view.background]} />
      <fog attach="fog" args={[view.background, 30, 95]} />

      {/*
        Plain lights rather than drei's <Environment preset>. A preset pulls an
        HDR from a CDN, which breaks the 3D view on a shop machine with no
        internet, and builds a PMREM cube map that costs real GPU memory. A
        hemisphere light gives the same soft sky-to-floor falloff for free.
      */}
      <ambientLight intensity={0.4 * b} />
      <hemisphereLight args={['#cdd6e4', '#3a3128', 0.85 * b]} />
      <directionalLight
        position={[12, 18, 10]}
        intensity={1.4 * b}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
      />
      <directionalLight position={[-10, 8, -6]} intensity={0.45 * b} />
      <directionalLight position={[0, 4, 14]} intensity={0.3 * b} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={view.floorColor} roughness={0.9} />
      </mesh>

      {view.showGrid && (
        <Grid
          args={[120, 120]}
          cellSize={1}
          cellThickness={0.5}
          cellColor={gridCell}
          sectionSize={4}
          sectionThickness={1}
          sectionColor={gridSection}
          fadeDistance={60}
          infiniteGrid
          position={[0, 0, 0]}
        />
      )}

      {view.showWalls && <Walls project={project} color={view.wallColor} />}
      {view.showCountertops && (
        <Countertop
          cabinets={shownCabinets}
          appliances={shownAppliances}
          counterColor={view.counterColor}
        />
      )}

      {shownCabinets.map((c) => (
        <CabinetMesh
          key={c.id}
          cabinet={c}
          project={project}
          selected={c.id === selectedId}
          showDoors={showDoors}
          onSelect={select}
        />
      ))}

      {shownAppliances.map((a) => (
        <ApplianceMesh
          key={a.id}
          appliance={a}
          selected={a.id === selectedApplianceId}
          onSelect={selectAppliance}
        />
      ))}

      {(project.barTops ?? []).filter((b) => !b.hidden).map((b) => (
        <BarTopMesh
          key={b.id}
          bar={b}
          project={project}
          counterColor={view.counterColor}
          selected={b.id === selectedBarTopId}
          onSelect={selectBarTop}
        />
      ))}

      {crownPaths.map((run, i) => (
        <CrownSweep key={`crown-${i}`} run={run} />
      ))}

      {showDimensions && <Dimensions3D project={project} />}

      <OrbitControls
        makeDefault
        target={[center.cx, 2.5, center.cz]}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={2}
        maxDistance={60}
      />
    </Canvas>
  );
}
