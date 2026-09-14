// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import type * as THREE from 'three';
import { useProject } from '../../store/useProject';
import { runStatus } from '../../domain/geometry';
import { Dimensions3D } from '../Dimensions3D';

/**
 * The 3D dimensions are read off the screen with a tape measure in hand, so
 * the assertions read the drawn geometry rather than any caption: drei's Html
 * labels need a real canvas parent and do not exist under the test renderer.
 *
 * Scene units are feet, the model is inches, so every span here is /12.
 */

const S = 1 / 12;
const LINE = '#7fa8c9';
const GAP_LINE = '#e0705c';

const project = () => useProject.getState().project;

function projectWith(...presets: string[]) {
  const st = useProject.getState();
  st.newProject('Dimensions test');
  st.setActiveWall(project().room.walls[0].id);
  for (const key of presets) st.addCabinet(key);
  return project();
}

interface DrawnLine {
  colour: string;
  /** Length of every segment in this line, longest first. */
  spans: number[];
  /** Axis the measured span runs along — a width lies along x, a clearance up y. */
  axis: 'x' | 'y' | 'z';
}

/**
 * Every dimension line in the scene, with its colour and segment lengths.
 * A dimension is drawn as one long span plus a short tick at each end, so the
 * longest segment is the measurement itself.
 */
async function draw(p = project()): Promise<DrawnLine[]> {
  const renderer = await ReactThreeTestRenderer.create(<Dimensions3D project={p} />);
  return renderer.scene.findAll((n) => n.type === 'LineSegments').map((node) => {
    const mesh = node.instance as unknown as THREE.LineSegments;
    const pos = mesh.geometry.getAttribute('position');
    const segments: { length: number; axis: 'x' | 'y' | 'z' }[] = [];
    for (let i = 0; i < pos.count; i += 2) {
      const d = {
        x: Math.abs(pos.getX(i + 1) - pos.getX(i)),
        y: Math.abs(pos.getY(i + 1) - pos.getY(i)),
        z: Math.abs(pos.getZ(i + 1) - pos.getZ(i)),
      };
      const axis = (Object.keys(d) as ('x' | 'y' | 'z')[]).reduce((a, b) => (d[a] >= d[b] ? a : b));
      segments.push({ length: Math.hypot(d.x, d.y, d.z), axis });
    }
    segments.sort((a, b) => b.length - a.length);
    const material = mesh.material as THREE.LineBasicMaterial;
    return {
      colour: `#${material.color.getHexString()}`,
      spans: segments.map((seg) => seg.length),
      axis: segments[0].axis,
    };
  });
}

/** The measured length of each dimension line, in inches. */
const measured = (lines: DrawnLine[]) => lines.map((l) => l.spans[0] / S);

beforeAll(() => {
  // r3f measures its container; jsdom has no ResizeObserver.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = RO;
});

describe('Dimensions3D', () => {
  it('draws nothing for an empty room', async () => {
    projectWith();
    expect(await draw()).toHaveLength(0);
  });

  it('measures a cabinet at exactly its width', async () => {
    projectWith('base-2door');
    const cabinet = project().cabinets[0];

    const lines = await draw();
    expect(measured(lines)).toContainEqual(cabinet.width);
  });

  it('follows the cabinet when it is resized', async () => {
    projectWith('base-2door');
    useProject.getState().updateCabinet(project().cabinets[0].id, { width: 33 });

    expect(measured(await draw())).toContainEqual(33);
  });

  it('measures every cabinet in the run', async () => {
    projectWith('base-2door', 'base-3drawer');
    const st = useProject.getState();
    const [a, b] = project().cabinets;
    st.updateCabinet(a.id, { width: 21 });
    st.updateCabinet(b.id, { width: 39 });

    const lengths = measured(await draw());
    expect(lengths).toContainEqual(21);
    expect(lengths).toContainEqual(39);
  });

  it('measures an appliance standing in the run, not just the cabinets', async () => {
    projectWith('base-2door');
    useProject.getState().addAppliance('range-30');
    const appliance = project().appliances[0];

    expect(measured(await draw())).toContainEqual(appliance.width);
  });

  it('stops measuring a cabinet that is excluded from the job', async () => {
    projectWith('base-2door', 'base-3drawer');
    const st = useProject.getState();
    const [a, b] = project().cabinets;
    st.updateCabinet(a.id, { width: 21 });
    st.updateCabinet(b.id, { width: 39 });
    expect(measured(await draw())).toContainEqual(21);

    st.updateCabinet(a.id, { excluded: true });
    const after = measured(await draw());
    expect(after).not.toContainEqual(21);
    expect(after).toContainEqual(39);
  });

  it('takes the dimensions away with a hidden wall', async () => {
    const wallId = projectWith('base-2door').room.walls[0].id;
    expect((await draw()).length).toBeGreaterThan(0);

    useProject.getState().toggleWallHidden(wallId);
    expect(await draw()).toHaveLength(0);
  });
});

describe('Dimensions3D leftover callouts', () => {
  it('calls out the wall a run does not reach, in the warning colour', async () => {
    const wallId = projectWith('base-2door').room.walls[0].id;
    const leftover = runStatus(project(), wallId, false).remaining;
    expect(leftover).toBeGreaterThan(0.5);

    const lines = await draw();
    const gap = lines.find((l) => l.colour === GAP_LINE);

    expect(gap).toBeTruthy();
    expect(gap!.spans[0] / S).toBeCloseTo(leftover, 4);
  });

  it('drops the callout once the run fills the wall', async () => {
    const wallId = projectWith('base-2door').room.walls[0].id;
    expect((await draw()).some((l) => l.colour === GAP_LINE)).toBe(true);

    useProject.getState().stretchLastInRun(wallId, false);
    expect(runStatus(project(), wallId, false).remaining).toBeLessThan(0.5);

    expect((await draw()).some((l) => l.colour === GAP_LINE)).toBe(false);
  });

  it('draws an ordinary measurement in the ordinary colour', async () => {
    projectWith('base-2door');
    const cabinet = project().cabinets[0];

    const lines = await draw();
    const width = lines.find((l) => Math.abs(l.spans[0] / S - cabinet.width) < 1e-6)!;

    expect(width.colour).toBe(LINE);
  });
});

describe('Dimensions3D clearances', () => {
  /**
   * A range on a wall with a cabinet stacked over it, raised to leave `gap`.
   * stackCabinetAbove is the app's own way of putting one above the other, so
   * the two genuinely overlap in plan the way the clearance rule requires.
   */
  function cooktopWithGapOf(gap: number) {
    const st = useProject.getState();
    st.newProject('Clearance test');
    st.setActiveWall(project().room.walls[0].id);
    st.addAppliance('range-30');

    const range = project().appliances[0];
    st.stackCabinetAbove(range.id);

    const above = project().cabinets.find((c) => c.name.startsWith('Cabinet over'))!;
    const rangeTop = range.mountHeight + range.height;
    st.updateCabinet(above.id, { mountHeight: rangeTop + gap });
    return { range, rangeTop };
  }

  /** The vertical dimension line, which is the clearance rather than a width. */
  const clearanceLine = (lines: DrawnLine[]) => lines.find((l) => l.axis === 'y');

  it('measures the clearance over a cooktop', async () => {
    cooktopWithGapOf(30);
    const line = clearanceLine(await draw());

    expect(line).toBeTruthy();
    expect(line!.spans[0] / S).toBeCloseTo(30, 4);
  });

  it('marks a tight cooktop clearance in the warning colour', async () => {
    // Below the 20" a range wants under an overhead unit.
    cooktopWithGapOf(15);
    const line = clearanceLine(await draw());

    expect(line).toBeTruthy();
    expect(line!.spans[0] / S).toBeCloseTo(15, 4);
    expect(line!.colour).toBe(GAP_LINE);
  });

  it('leaves an adequate clearance in the ordinary colour', async () => {
    cooktopWithGapOf(24);
    const line = clearanceLine(await draw());

    expect(line).toBeTruthy();
    expect(line!.colour).toBe(LINE);
  });

  it('says nothing when the cabinet sits straight on top', async () => {
    cooktopWithGapOf(0);
    expect(clearanceLine(await draw())).toBeUndefined();
  });
});
