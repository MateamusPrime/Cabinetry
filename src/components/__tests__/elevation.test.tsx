// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useProject } from '../../store/useProject';
import { buildCabinetGeometry } from '../../domain/geometry';
import { formatFrac } from '../../domain/units';
import { CabinetElevation, PlanView } from '../Elevation';

/**
 * Both of these are drawings, so the assertions read geometry back off the
 * rendered SVG rather than trusting a caption. An elevation that draws a door
 * outside its own carcass is wrong however good the numbers beside it look.
 */

const project = () => useProject.getState().project;

function projectWith(...presets: string[]) {
  const st = useProject.getState();
  st.newProject('Elevation test');
  st.setActiveWall(project().room.walls[0].id);
  for (const key of presets) st.addCabinet(key);
  return project();
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const rects = (svg: SVGElement): Box[] =>
  [...svg.querySelectorAll('rect')].map((r) => ({
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    w: Number(r.getAttribute('width')),
    h: Number(r.getAttribute('height')),
  }));

const texts = (svg: SVGElement): string[] =>
  [...svg.querySelectorAll('text')].map((t) => t.textContent ?? '');

afterEach(cleanup);

describe('CabinetElevation', () => {
  it('draws the cabinet at the width it was asked for', () => {
    projectWith('base-2door');
    const { container } = render(
      <CabinetElevation cabinet={project().cabinets[0]} project={project()} width={300} />,
    );

    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 300 /);
  });

  it('draws one shape per piece of geometry, plus the backing panel', () => {
    projectWith('base-2door');
    const cabinet = project().cabinets[0];
    const boxes = buildCabinetGeometry(cabinet, project(), { showDoors: true });

    const { container } = render(<CabinetElevation cabinet={cabinet} project={project()} />);
    const drawn = rects(container.querySelector('svg')!);

    // Every part is drawn, and the panel background sits behind them all.
    expect(drawn.length).toBeGreaterThanOrEqual(boxes.length);
  });

  it('keeps everything it draws inside the panel', () => {
    projectWith('base-3drawer');
    const { container } = render(
      <CabinetElevation cabinet={project().cabinets[0]} project={project()} width={300} />,
    );
    const svg = container.querySelector('svg')!;
    const [, ...height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const panelH = height[2];

    for (const r of rects(svg)) {
      expect(r.x).toBeGreaterThanOrEqual(-0.001);
      expect(r.y).toBeGreaterThanOrEqual(-0.001);
      expect(r.x + r.w).toBeLessThanOrEqual(300.001);
      expect(r.y + r.h).toBeLessThanOrEqual(panelH + 0.001);
    }
  });

  it('calls out the width and height on the dimension lines', () => {
    projectWith('base-2door');
    const cabinet = project().cabinets[0];
    const { container } = render(<CabinetElevation cabinet={cabinet} project={project()} />);

    const shown = texts(container.querySelector('svg')!).join(' ');
    expect(shown).toContain(formatFrac(cabinet.width));
    expect(shown).toContain(formatFrac(cabinet.height));
  });

  it('drops the dimensions when they are not wanted', () => {
    projectWith('base-2door');
    const cabinet = project().cabinets[0];
    const { container } = render(
      <CabinetElevation cabinet={cabinet} project={project()} showDims={false} />,
    );

    const shown = texts(container.querySelector('svg')!).join(' ');
    expect(shown).not.toContain(`${formatFrac(cabinet.width)}"`);
  });

  it('draws a taller cabinet on a taller panel', () => {
    projectWith('base-2door', 'tall-oven');
    const [base, tall] = project().cabinets;

    const a = render(<CabinetElevation cabinet={base} project={project()} width={300} />);
    const shortH = Number(a.container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[3]);
    cleanup();
    const b = render(<CabinetElevation cabinet={tall} project={project()} width={300} />);
    const tallH = Number(b.container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[3]);

    expect(tall.height).toBeGreaterThan(base.height);
    expect(tallH).toBeGreaterThan(shortH);
  });

  it('redraws when the cabinet is resized', () => {
    projectWith('base-2door');
    const before = render(
      <CabinetElevation cabinet={project().cabinets[0]} project={project()} />,
    );
    const beforeText = texts(before.container.querySelector('svg')!).join(' ');
    cleanup();

    useProject.getState().updateCabinet(project().cabinets[0].id, { width: 42 });
    const after = render(<CabinetElevation cabinet={project().cabinets[0]} project={project()} />);

    expect(texts(after.container.querySelector('svg')!).join(' ')).not.toBe(beforeText);
    expect(texts(after.container.querySelector('svg')!).join(' ')).toContain('42');
  });
});

/**
 * jsdom implements no SVG geometry, so createSVGPoint and getScreenCTM are
 * absent and the plan's screen-to-model mapping bails out. A 1:1 identity
 * mapping is enough to let the pointer handlers run.
 */
function giveJsdomSvgGeometry() {
  const proto = SVGSVGElement.prototype as unknown as Record<string, unknown>;
  proto.createSVGPoint = function createSVGPoint() {
    return {
      x: 0,
      y: 0,
      matrixTransform(this: { x: number; y: number }) {
        return { x: this.x, y: this.y };
      },
    };
  };
  proto.getScreenCTM = function getScreenCTM() {
    return { inverse: () => ({}) };
  };
}

describe('PlanView', () => {
  function plan(selectedId: string | null = null, onSelect = vi.fn()) {
    const view = render(
      <PlanView project={project()} selectedId={selectedId} onSelect={onSelect} />,
    );
    return { view, onSelect, svg: view.container.querySelector('svg')! };
  }

  it('draws the room even with nothing in it', () => {
    projectWith();
    const { svg } = plan();
    expect(svg).toBeTruthy();
    expect(svg.querySelectorAll('rect').length).toBeGreaterThan(0);
  });

  it('labels every cabinet on the plan with its width', () => {
    projectWith('base-2door', 'base-3drawer');
    const st = useProject.getState();
    const [a, b] = project().cabinets;
    st.updateCabinet(a.id, { width: 24 });
    st.updateCabinet(b.id, { width: 36 });

    const { svg } = plan();
    const labels = texts(svg);

    expect(labels).toContain('24');
    expect(labels).toContain('36');
  });

  it('leaves an excluded cabinet off the drawing', () => {
    projectWith('base-2door', 'base-3drawer');
    const st = useProject.getState();
    const [first, second] = project().cabinets;
    st.updateCabinet(first.id, { width: 24 });
    st.updateCabinet(second.id, { width: 36 });

    // Both are on the plan to begin with.
    expect(texts(plan().svg)).toContain('24');
    cleanup();

    st.updateCabinet(first.id, { excluded: true });
    const labels = texts(plan().svg);
    expect(labels).not.toContain('24');
    expect(labels).toContain('36');
  });

  it('draws appliances alongside the cabinets', () => {
    projectWith('base-2door');
    useProject.getState().addAppliance('range-30');
    const name = project().appliances[0].name;

    const { svg } = plan();
    // The plan shortens a long name to fit the box, so it is a prefix.
    expect(texts(svg).some((t) => t.length > 0 && name.startsWith(t))).toBe(true);
  });

  it('reports which cabinet was clicked', () => {
    giveJsdomSvgGeometry();
    projectWith('base-2door', 'base-3drawer');
    const st = useProject.getState();
    const [a, b] = project().cabinets;
    st.updateCabinet(a.id, { width: 24 });
    st.updateCabinet(b.id, { width: 36 });

    const { svg, onSelect } = plan();
    const label = [...svg.querySelectorAll('text')].find((t) => t.textContent === '36')!;
    fireEvent.pointerDown(label.closest('g')!, { clientX: 10, clientY: 10 });

    expect(onSelect).toHaveBeenCalledWith(b.id);
  });

  it('marks the selected cabinet differently from the rest', () => {
    projectWith('base-2door', 'base-3drawer');
    const [, second] = project().cabinets;

    const plain = plan().svg.innerHTML;
    cleanup();
    const highlighted = plan(second.id).svg.innerHTML;

    expect(highlighted).not.toBe(plain);
  });

  it('dimensions the run and calls out what is left over', () => {
    projectWith('base-2door');
    const { svg } = plan();
    const cabinet = project().cabinets[0];

    const shown = texts(svg);
    // The run itself, and the leftover the run does not reach.
    expect(shown).toContain(`${formatFrac(cabinet.width)}"`);
    expect(shown.some((t) => /^\d.*" gap$/.test(t))).toBe(true);
  });

  it('drops the dimension annotations when they are not wanted', () => {
    projectWith('base-2door');
    expect(texts(plan().svg).some((t) => /"/.test(t))).toBe(true);
    cleanup();

    const { container } = render(
      <PlanView project={project()} selectedId={null} onSelect={() => {}} showDims={false} />,
    );
    const bare = container.querySelector('svg')!;

    expect(texts(bare).some((t) => /"/.test(t))).toBe(false);
    // The cabinets themselves are still drawn.
    expect(texts(bare)).toContain(String(project().cabinets[0].width));
  });
});
