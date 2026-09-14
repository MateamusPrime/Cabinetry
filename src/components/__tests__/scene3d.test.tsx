// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useProject } from '../../store/useProject';
import { Scene3D } from '../Scene3D';

/**
 * Scene3D owns its own <Canvas>, and jsdom has no WebGL, so react-three-fiber
 * never builds a renderer here: onCreated does not fire, no __r3f handle is
 * attached, and the scene graph cannot be inspected. What that leaves is a
 * mount-level suite, and it is worth having on its own terms — every case
 * below is a project shape whose geometry has somewhere to go wrong, and a
 * throw during render is exactly what puts the app into the ErrorBoundary.
 *
 * What is NOT covered, to be plain about it: what is actually drawn, the
 * camera framing, and the WebGL context-loss recovery branch, which needs the
 * onCreated that never fires. Dimensions3D carries the real geometry
 * assertions, and the geometry helpers underneath both are covered by the
 * domain suite.
 */

const project = () => useProject.getState().project;

function setup(name = 'Scene test') {
  const st = useProject.getState();
  st.newProject(name);
  st.setActiveWall(project().room.walls[0].id);
  return st;
}

/** Mount the view and report whether it survived, plus the canvas it made. */
function mount() {
  const { container, unmount } = render(<Scene3D />);
  return { canvas: container.querySelector('canvas'), unmount };
}

beforeAll(() => {
  // react-three-fiber measures its container; jsdom has no ResizeObserver.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).ResizeObserver = RO;
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('Scene3D', () => {
  it('puts up a canvas for an empty room', () => {
    setup();
    expect(mount().canvas).toBeTruthy();
  });

  it('comes down again without complaint', () => {
    setup();
    const { unmount } = mount();
    expect(() => unmount()).not.toThrow();
  });

  it.each([
    ['base cabinets', ['base-2door', 'base-3drawer', 'base-sink']],
    ['wall and tall units', ['wall-2door', 'wall-open', 'tall-oven']],
    ['diagonal corners', ['base-corner-diagonal', 'wall-corner-diagonal']],
    ['blind corners', ['base-corner-blind', 'wall-corner-blind']],
    ['fillers', ['filler-base', 'filler-wall']],
    ['an apron sink', ['base-sink-farmhouse']],
    ['a mixed run', ['base-2door', 'wall-2door', 'tall-oven', 'base-corner-blind']],
  ])('draws %s without falling over', (_label, presets) => {
    const st = setup();
    for (const key of presets) st.addCabinet(key);

    expect(mount().canvas).toBeTruthy();
  });

  it('draws appliances alongside the cabinets', () => {
    const st = setup();
    st.addCabinet('base-2door');
    st.addAppliance('range-30');
    st.addAppliance('fridge-36');

    expect(mount().canvas).toBeTruthy();
  });

  it('draws a bar top', () => {
    const st = setup();
    st.addCabinet('base-2door');
    st.addBarTop();

    expect(mount().canvas).toBeTruthy();
  });

  it('draws a window cut through a wall', () => {
    const st = setup();
    st.addCabinet('base-2door');
    st.addWindow();

    expect(mount().canvas).toBeTruthy();
  });

  it('draws a cabinet stacked over an appliance', () => {
    const st = setup();
    st.addAppliance('range-30');
    st.stackCabinetAbove(project().appliances[0].id);

    expect(mount().canvas).toBeTruthy();
  });

  it('copes with a wall hidden out of the way', () => {
    const st = setup();
    st.addCabinet('base-2door');
    st.addCabinet('wall-2door');
    st.toggleWallHidden(project().room.walls[0].id);

    expect(mount().canvas).toBeTruthy();
  });

  it('copes with every cabinet excluded from the job', () => {
    const st = setup();
    st.addCabinet('base-2door');
    for (const c of project().cabinets) st.updateCabinet(c.id, { excluded: true });

    expect(mount().canvas).toBeTruthy();
  });

  it.each(['singleWall', 'lShape', 'uShape', 'galley', 'closed'] as const)(
    'draws a %s room',
    (shape) => {
      const st = setup();
      st.applyRoomShape(shape, 168, 144);
      st.setActiveWall(project().room.walls[0].id);
      st.addCabinet('base-2door');

      expect(mount().canvas).toBeTruthy();
    },
  );

  it('draws crown and light rail when they are turned on', () => {
    const st = setup();
    st.addCabinet('wall-2door');
    st.updateCrown({ enabled: true });
    st.updateLightRail({ enabled: true });

    expect(mount().canvas).toBeTruthy();
  });

  it('redraws with the doors and dimensions turned off', () => {
    const st = setup();
    st.addCabinet('base-2door');
    st.toggleDoors();
    st.toggleDimensions();

    expect(useProject.getState().showDoors).toBe(false);
    expect(useProject.getState().showDimensions).toBe(false);
    expect(mount().canvas).toBeTruthy();
  });

  it('survives a project loaded straight from a file', () => {
    setup();
    const saved = useProject.getState().exportJson();
    useProject.getState().newProject('Elsewhere');

    expect(useProject.getState().importJson(saved)).toBeNull();
    expect(mount().canvas).toBeTruthy();
  });
});
