// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useProject } from '../../store/useProject';
import { generateProjectParts, rollupCutList } from '../../domain/partsGenerator';
import { CutListView } from '../CutListView';

/**
 * The cut list is what goes out to the saw. These tests hold the view to the
 * numbers the domain worked out — a part that renders at the wrong size, or
 * quietly fails to render at all, is plywood in the bin.
 */

/** Build a project on the first wall and hand back what the store now holds. */
function projectWith(...presets: string[]) {
  const st = useProject.getState();
  st.newProject('Cut list test');
  st.setActiveWall(useProject.getState().project.room.walls[0].id);
  for (const key of presets) st.addCabinet(key);
  return useProject.getState().project;
}

/**
 * Cut-list rows only, as arrays of cell text. The edgebanding summary at the
 * foot of the page has its own table and is not part of the cut list.
 */
function bodyRows(container: HTMLElement): string[][] {
  const cards = [...container.querySelectorAll('.card')].filter(
    (c) => c.querySelector('h4')?.textContent !== 'Edgebanding',
  );
  return cards.flatMap((card) =>
    [...card.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''),
    ),
  );
}

afterEach(cleanup);

describe('CutListView', () => {
  it('says there is nothing to cut before any cabinets exist', () => {
    projectWith();
    render(<CutListView />);
    expect(screen.getByText('No parts yet')).toBeTruthy();
    expect(document.querySelector('table')).toBeNull();
  });

  it('summarises the same totals the domain computed', () => {
    const project = projectWith('base-2door', 'wall-2door');
    const { parts } = generateProjectParts(project);
    const rows = rollupCutList(parts);
    const pieces = parts.reduce((a, p) => a + p.qty, 0);

    const { container } = render(<CutListView />);

    expect(container.querySelector('.field-hint')?.textContent).toBe(
      `${pieces} pieces across ${rows.length} unique sizes · 2 cabinets`,
    );
  });

  it('gives every unique size a row rather than dropping any', () => {
    const project = projectWith('base-2door', 'wall-2door', 'base-3drawer');
    const rows = rollupCutList(generateProjectParts(project).parts);

    const { container } = render(<CutListView />);

    expect(bodyRows(container)).toHaveLength(rows.length);
  });

  it('renders a part at the size the domain gave it, not a rounded-off one', () => {
    const project = projectWith('base-2door');
    const rows = rollupCutList(generateProjectParts(project).parts);
    // Sides are 34 1/2 x 24 on a standard base — an exact eighth either way.
    const side = rows.find((r) => r.name === 'Side');
    expect(side).toBeTruthy();

    const { container } = render(<CutListView />);
    const rendered = bodyRows(container).find((cells) => cells[0] === 'Side');

    expect(rendered).toBeTruthy();
    expect(rendered![1]).toBe(String(side!.qty));
    expect(rendered![2]).toBe('34 1/2');
    expect(rendered![3]).toBe('24');
  });

  it('groups by material under each material heading by default', () => {
    const project = projectWith('base-2door', 'wall-2door');
    const rows = rollupCutList(generateProjectParts(project).parts);
    const materialNames = [...new Set(rows.map((r) => project.materials.find((m) => m.id === r.materialId)?.name))];

    const { container } = render(<CutListView />);
    const headings = [...container.querySelectorAll('h3')].map((h) => h.textContent);

    expect(headings).toEqual(materialNames);
  });

  it('regroups under cabinet headings when asked, without losing pieces', () => {
    projectWith('base-2door', 'wall-2door');
    const { container } = render(<CutListView />);
    const beforeRows = bodyRows(container).length;

    fireEvent.click(screen.getByText('By cabinet'));

    const headings = [...container.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Base 1', 'Wall 1']);
    // Grouping by cabinet lists every part, so it can only ever show more.
    expect(bodyRows(container).length).toBeGreaterThanOrEqual(beforeRows);
  });

  it('switches between shop fractions and decimals', () => {
    projectWith('base-2door');
    const { container } = render(<CutListView />);

    const fractional = bodyRows(container).find((c) => c[0] === 'Side');
    expect(fractional![2]).toBe('34 1/2');

    fireEvent.click(screen.getByText('Decimals'));

    const decimal = bodyRows(container).find((c) => c[0] === 'Side');
    expect(decimal![2]).toBe('34.500');
    // The button now offers the way back.
    expect(screen.getByText('Fractions')).toBeTruthy();
  });

  it('warns about a door wide enough to sag before it reaches the saw', () => {
    const st = useProject.getState();
    projectWith('base-1door');
    const cab = useProject.getState().project.cabinets[0];
    st.updateCabinet(cab.id, { width: 34 });

    const { warnings } = generateProjectParts(useProject.getState().project);
    expect(warnings.some((w) => /sag/.test(w))).toBe(true);

    render(<CutListView />);
    expect(screen.getByText(/issues? to resolve before cutting/)).toBeTruthy();
    expect(screen.getByText(/sag and swing wide/)).toBeTruthy();
  });

  it('counts one issue in the singular', () => {
    const st = useProject.getState();
    projectWith('base-1door');
    st.updateCabinet(useProject.getState().project.cabinets[0].id, { width: 34 });

    const { warnings } = generateProjectParts(useProject.getState().project);
    render(<CutListView />);

    const heading = screen.getByText(/to resolve before cutting/).textContent ?? '';
    expect(heading).toBe(
      `${warnings.length} issue${warnings.length === 1 ? '' : 's'} to resolve before cutting`,
    );
  });
});

describe('CutListView CSV export', () => {
  let captured: Blob | null = null;

  beforeEach(() => {
    captured = null;
    // The download anchor is clicked for real, which jsdom reports as an
    // unimplemented navigation. The Blob is already captured by then.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    // jsdom implements Blob but not the object-URL plumbing the download uses.
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (b: Blob) => {
        captured = b;
        return 'blob:captured';
      },
      revokeObjectURL: () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanup();
  });

  async function exportedCsv(): Promise<string[]> {
    fireEvent.click(screen.getByText('Export CSV'));
    expect(captured).toBeTruthy();
    const text = await captured!.text();
    return text.split('\n');
  }

  it('writes a header and one line per unique size', async () => {
    const project = projectWith('base-2door', 'wall-2door');
    const rows = rollupCutList(generateProjectParts(project).parts);

    render(<CutListView />);
    const lines = await exportedCsv();

    expect(lines[0]).toBe('Material,Part,Qty,Length,Width,Thickness,Grain,Edgeband,Cabinets');
    expect(lines).toHaveLength(rows.length + 1);
  });

  it('separates shared cabinets with a semicolon so the column cannot split', async () => {
    projectWith('base-2door', 'wall-2door');
    render(<CutListView />);
    const lines = await exportedCsv();

    const shared = lines.find((l) => l.includes('Base 1; Wall 1'));
    expect(shared).toBeTruthy();
    for (const line of lines) {
      expect(splitCsv(line)).toHaveLength(9);
    }
  });

  it('quotes a field that does contain a comma', async () => {
    const st = useProject.getState();
    projectWith('base-2door');
    st.updateCabinet(useProject.getState().project.cabinets[0].id, { name: 'Island, north run' });

    render(<CutListView />);
    const lines = await exportedCsv();

    const quoted = lines.find((l) => l.includes('"Island, north run"'));
    expect(quoted).toBeTruthy();
    // The comma is inside the quotes, so the row still has its nine columns.
    expect(splitCsv(quoted!)).toHaveLength(9);
    expect(splitCsv(quoted!)[8]).toBe('Island, north run');
  });

  it('follows the fraction and decimal toggle into the file', async () => {
    projectWith('base-2door');
    render(<CutListView />);

    const asFractions = await exportedCsv();
    expect(asFractions.some((l) => l.includes('34 1/2'))).toBe(true);

    fireEvent.click(screen.getByText('Decimals'));
    const asDecimals = await exportedCsv();
    expect(asDecimals.some((l) => l.includes('34.500'))).toBe(true);
  });
});

/** Minimal RFC-4180 split, good enough to count a line's columns. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
