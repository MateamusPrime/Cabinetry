// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useProject } from '../../store/useProject';
import { NestingView } from '../NestingView';

/**
 * Cut diagrams are cut from. A sheet that reports a yield its own rectangles
 * do not support, or draws two parts over each other, sends someone to the
 * panel saw with a layout that cannot be cut.
 */

function projectWith(...presets: string[]) {
  const st = useProject.getState();
  st.newProject('Nesting test');
  st.setActiveWall(useProject.getState().project.room.walls[0].id);
  for (const key of presets) st.addCabinet(key);
  return useProject.getState().project;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The parts drawn on a sheet. Placement rectangles are the ones wrapped in a
 * <g>; the sheet outline and the usable-area dashes sit directly under <svg>,
 * and the grain marker group holds no rectangle at all.
 */
function placements(svg: SVGElement): Rect[] {
  return [...svg.querySelectorAll('g > rect')].map((r) => ({
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    w: Number(r.getAttribute('width')),
    h: Number(r.getAttribute('height')),
  }));
}

/** The sheet outline itself, which every part has to stay inside. */
function sheetOutline(svg: SVGElement): Rect {
  const r = svg.querySelector('rect')!;
  return {
    x: Number(r.getAttribute('x')),
    y: Number(r.getAttribute('y')),
    w: Number(r.getAttribute('width')),
    h: Number(r.getAttribute('height')),
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  const slop = 1e-6;
  return (
    a.x < b.x + b.w - slop &&
    b.x < a.x + a.w - slop &&
    a.y < b.y + b.h - slop &&
    b.y < a.y + a.h - slop
  );
}

afterEach(cleanup);

describe('NestingView', () => {
  it('says there is nothing to nest before any cabinets exist', () => {
    projectWith();
    render(<NestingView />);
    expect(screen.getByText('Nothing to nest')).toBeTruthy();
    expect(document.querySelector('svg')).toBeNull();
  });

  it('heads the page with the number of sheets it actually drew', () => {
    projectWith('base-2door', 'wall-2door');
    const { container } = render(<NestingView />);

    const drawn = container.querySelectorAll('.sheet-card').length;
    expect(drawn).toBeGreaterThan(0);
    expect(container.querySelector('.field-hint')?.textContent).toContain(`${drawn} sheets`);
  });

  it('draws one rectangle per part and says so on the card', () => {
    projectWith('base-2door', 'wall-2door');
    const { container } = render(<NestingView />);

    for (const card of container.querySelectorAll('.sheet-card')) {
      const svg = card.querySelector('svg')!;
      const claimed = Number(/(\d+) parts/.exec(card.querySelector('.field-hint')!.textContent!)![1]);
      expect(placements(svg)).toHaveLength(claimed);
    }
  });

  it('keeps every part inside the sheet it is drawn on', () => {
    projectWith('base-2door', 'wall-2door', 'base-3drawer');
    const { container } = render(<NestingView />);

    for (const card of container.querySelectorAll('.sheet-card')) {
      const svg = card.querySelector('svg')!;
      const sheet = sheetOutline(svg);
      for (const p of placements(svg)) {
        expect(p.x).toBeGreaterThanOrEqual(sheet.x - 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(sheet.y - 1e-6);
        expect(p.x + p.w).toBeLessThanOrEqual(sheet.x + sheet.w + 1e-6);
        expect(p.y + p.h).toBeLessThanOrEqual(sheet.y + sheet.h + 1e-6);
      }
    }
  });

  it('never draws two parts over each other', () => {
    projectWith('base-2door', 'wall-2door', 'base-3drawer', 'base-4drawer');
    const { container } = render(<NestingView />);

    for (const card of container.querySelectorAll('.sheet-card')) {
      const parts = placements(card.querySelector('svg')!);
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          expect(overlaps(parts[i], parts[j])).toBe(false);
        }
      }
    }
  });

  it('reports a yield the drawn rectangles actually support', () => {
    projectWith('base-2door', 'wall-2door', 'base-3drawer');
    const { container } = render(<NestingView />);

    for (const card of container.querySelectorAll('.sheet-card')) {
      const svg = card.querySelector('svg')!;
      const sheet = sheetOutline(svg);
      const used = placements(svg).reduce((a, p) => a + p.w * p.h, 0);
      const fromDiagram = (used / (sheet.w * sheet.h)) * 100;

      const shown = Number(/(\d+)% used/.exec(card.querySelector('.field-hint')!.textContent!)![1]);
      // The card rounds to a whole percent, so allow that much drift.
      expect(Math.abs(shown - fromDiagram)).toBeLessThan(1);
    }
  });

  it('states the offcut left on each sheet', () => {
    projectWith('base-2door', 'wall-2door');
    const { container } = render(<NestingView />);

    for (const card of container.querySelectorAll('.sheet-card')) {
      const hint = card.querySelector('.field-hint')!.textContent!;
      const offcut = Number(/([\d.]+) sq ft offcut/.exec(hint)![1]);
      const svg = card.querySelector('svg')!;
      const sheet = sheetOutline(svg);
      const full = (sheet.w * sheet.h) / 144;

      expect(offcut).toBeGreaterThanOrEqual(0);
      expect(offcut).toBeLessThanOrEqual(full + 1e-6);
    }
  });

  it('calls out parts too big for the sheet instead of dropping them', () => {
    const st = useProject.getState();
    projectWith('base-2door');
    // A sheet no real supplier stocks, so the carcass parts cannot be cut.
    st.updateMaterial('ply-prefin-maple-34', { sheetWidth: 12, sheetLength: 12 });

    const { container } = render(<NestingView />);

    expect(screen.getByText(/will not fit on a sheet/)).toBeTruthy();

    const reasons = [...container.querySelectorAll('.alert.bad li')].map((l) => l.textContent ?? '');
    expect(reasons.length).toBeGreaterThan(0);
    for (const line of reasons) {
      // Each entry has to identify the part and say why it could not be cut.
      expect(line).toMatch(/^Base 1 — .+ \(.+" × .+"\): .+/);
    }
    // Grain is the blocker here: these would fit turned, but the ply is grained.
    expect(reasons.some((r) => /Does not fit with grain running along/.test(r))).toBe(true);
  });

  it('caps the unplaced list but still counts them all in the heading', () => {
    const st = useProject.getState();
    projectWith('base-2door');
    st.updateMaterial('ply-prefin-maple-34', { sheetWidth: 12, sheetLength: 12 });

    const { container } = render(<NestingView />);
    const heading = screen.getByText(/will not fit on a sheet/).textContent ?? '';
    const counted = Number(/^(\d+) part/.exec(heading)![1]);
    const listed = container.querySelectorAll('.alert.bad li').length;

    expect(listed).toBeLessThanOrEqual(6);
    expect(counted).toBeGreaterThanOrEqual(listed);
  });

  it('counts a single unplaced part in the singular', () => {
    const st = useProject.getState();
    projectWith('base-2door');
    st.updateMaterial('ply-prefin-maple-34', { sheetWidth: 12, sheetLength: 12 });

    render(<NestingView />);
    const heading = screen.getByText(/will not fit on a sheet/).textContent ?? '';
    const count = Number(/^(\d+) part/.exec(heading)![1]);

    expect(heading).toBe(`${count} part${count === 1 ? '' : 's'} will not fit on a sheet`);
  });

  it('plans solid lumber as a board-foot buy rather than a diagram', () => {
    projectWith('base-2door');
    const { container } = render(<NestingView />);

    expect(screen.getByText('Solid Lumber')).toBeTruthy();
    const hint = [...container.querySelectorAll('.field-hint')].find((e) =>
      /bd ft net → buy/.test(e.textContent ?? ''),
    );
    expect(hint).toBeTruthy();

    const [net, gross] = [...hint!.textContent!.matchAll(/([\d.]+) bd ft/g)].map((m) => Number(m[1]));
    // The buy allows for waste, so it can never come in under the net need.
    expect(gross).toBeGreaterThanOrEqual(net);
  });
});
