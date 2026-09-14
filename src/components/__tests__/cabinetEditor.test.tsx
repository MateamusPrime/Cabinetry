// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useProject } from '../../store/useProject';
import { generateProjectParts } from '../../domain/partsGenerator';
import { CabinetEditor, MaterialSummary } from '../CabinetEditor';

/**
 * The cabinet editor is where a box actually gets specified. Every test drives
 * the control and reads the store back, because a field wired to a
 * neighbouring property still looks perfectly reasonable on screen.
 */

const project = () => useProject.getState().project;
const cabinet = () => project().cabinets[0];
let view: ReturnType<typeof render>;

function editing(preset = 'base-2door') {
  const st = useProject.getState();
  st.newProject('Cabinet editor test');
  st.setActiveWall(project().room.walls[0].id);
  st.addCabinet(preset);
  view = render(<CabinetEditor cabinet={cabinet()} project={project()} />);
  return view;
}

/** Re-render against the latest store state, as the app does on every change. */
function reopen() {
  cleanup();
  view = render(<CabinetEditor cabinet={cabinet()} project={project()} />);
  return view;
}

/**
 * Find a labelled row by its own label span. "Width" also appears as a table
 * heading in the elevation, so a plain text lookup is ambiguous.
 */
function row(label: string): HTMLElement {
  const found = [...view.container.querySelectorAll('label.field')].find(
    (l) => l.querySelector('span')?.textContent === label,
  );
  if (!found) throw new Error(`no field labelled "${label}"`);
  return found as HTMLElement;
}

function toggle(label: string): HTMLInputElement {
  const found = [...view.container.querySelectorAll('label.toggle-row')].find(
    (l) => l.querySelector('span')?.textContent === label,
  );
  if (!found) throw new Error(`no toggle labelled "${label}"`);
  return found.querySelector('input') as HTMLInputElement;
}

function setDim(label: string, value: string) {
  const input = row(label).querySelector('input') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function choose(label: string, value: string) {
  fireEvent.change(row(label).querySelector('select')!, { target: { value } });
}

function setNum(label: string, value: string) {
  fireEvent.change(row(label).querySelector('input')!, { target: { value } });
}

afterEach(cleanup);

describe('CabinetEditor', () => {
  it('renames the cabinet', () => {
    editing();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Sink base' } });
    expect(cabinet().name).toBe('Sink base');
  });

  it('resizes the box', () => {
    editing();
    setDim('Width', '30');
    setDim('Height', '36');
    setDim('Depth', '25 1/2');

    expect(cabinet().width).toBe(30);
    expect(cabinet().height).toBe(36);
    expect(cabinet().depth).toBe(25.5);
  });

  it('moves the cabinet along its wall', () => {
    editing();
    setDim('Distance along the wall', '36');
    expect(cabinet().along).toBe(36);
  });

  it('changes the door count and that reaches the parts', () => {
    editing();
    choose('Doors', '1');
    expect(cabinet().doorCount).toBe(1);

    const doors = generateProjectParts(project()).parts.filter((p) => p.name === 'Door');
    expect(doors.reduce((a, p) => a + p.qty, 0)).toBe(1);
  });

  it('changes the shelf count and that reaches the parts', () => {
    editing();
    setNum('Shelves', '3');
    expect(cabinet().shelfCount).toBe(3);

    const shelves = generateProjectParts(project()).parts.filter((p) => /Shelf/.test(p.name));
    expect(shelves.reduce((a, p) => a + p.qty, 0)).toBe(3);
  });

  it('switches construction to a face frame, which brings its own parts', () => {
    editing();
    choose('Style', 'faceFrame');
    expect(cabinet().construction).toBe('faceFrame');

    const names = generateProjectParts(project()).parts.map((p) => p.name);
    expect(names.some((n) => /Stile|Rail/.test(n))).toBe(true);
  });

  it('changes the door mount, which resizes the doors', () => {
    editing();
    const overlayDoor = generateProjectParts(project()).parts.find((p) => p.name === 'Door')!;

    choose('Door mount', 'inset');
    expect(cabinet().doorMount).toBe('inset');

    const insetDoor = generateProjectParts(project()).parts.find((p) => p.name === 'Door')!;
    // An inset door sits inside the opening, so it cannot be the same size.
    expect(insetDoor.width).toBeLessThan(overlayDoor.width);
  });

  it('records a finished end and shows it back', () => {
    editing();
    expect(cabinet().finishedLeft).toBe(false);

    fireEvent.click(toggle('Finished left end'));
    expect(cabinet().finishedLeft).toBe(true);

    reopen();
    expect(toggle('Finished left end').checked).toBe(true);
  });

  it('turns adjustable shelves on and off', () => {
    editing();
    const was = cabinet().adjustableShelves;
    fireEvent.click(toggle('Adjustable shelves (drill pin holes)'));
    expect(cabinet().adjustableShelves).toBe(!was);
  });

  it('excludes the cabinet from the estimate without deleting it', () => {
    editing();
    fireEvent.click(toggle('Exclude from estimate'));

    expect(cabinet().excluded).toBe(true);
    expect(project().cabinets).toHaveLength(1);
  });

  it('duplicates the cabinet', () => {
    editing();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(project().cabinets).toHaveLength(2);
  });

  it('deletes the cabinet', () => {
    editing();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(project().cabinets).toHaveLength(0);
  });

  it('surfaces a problem with this cabinet, stripped of the redundant name', () => {
    editing('base-1door');
    setDim('Width', '34');
    reopen();

    const alert = screen.getByText('Check this cabinet').closest('.alert')!;
    expect(alert.textContent).toMatch(/sag and swing wide/);
    // The heading already says which cabinet it is.
    expect(alert.querySelector('li')!.textContent).not.toContain(`${cabinet().name}:`);
  });
});

describe('CabinetEditor drawers', () => {
  it('adds and removes a drawer front', () => {
    editing('base-3drawer');
    const before = cabinet().drawers.length;

    fireEvent.click(screen.getByRole('button', { name: '+ Drawer' }));
    expect(cabinet().drawers.length).toBe(before + 1);

    reopen();
    fireEvent.click(screen.getAllByRole('button', { name: '×' })[0]);
    expect(cabinet().drawers.length).toBe(before);
  });

  it('splits the face evenly when the stack is balanced', () => {
    editing('base-3drawer');
    const heightsBefore = cabinet().drawers.map((d) => d.frontHeight);
    // They start graduated, so there is something to even out.
    expect(new Set(heightsBefore).size).toBeGreaterThan(1);

    fireEvent.click(screen.getByTitle('Split the available face height evenly'));

    const heights = cabinet().drawers.map((d) => d.frontHeight);
    for (const h of heights) expect(h).toBeCloseTo(heights[0], 6);
  });

  it('resizes one front without disturbing the others', () => {
    editing('base-3drawer');
    const before = cabinet().drawers.map((d) => d.frontHeight);

    setDim('Front 1 height', '8');

    const after = cabinet().drawers.map((d) => d.frontHeight);
    expect(after[0]).toBe(8);
    expect(after[1]).toBeCloseTo(before[1], 6);
    expect(after[2]).toBeCloseTo(before[2], 6);
  });
});

describe('CabinetEditor sink and oven', () => {
  it('puts a sink in the cabinet and offers its bowl dimensions', () => {
    editing('base-2door');
    expect(() => row('Bowl width')).toThrow();

    choose('Sink in this cabinet', 'undermount');
    reopen();

    expect(row('Bowl width')).toBeTruthy();
  });

  it('an apron sink drops the front stretcher', () => {
    editing('base-sink-farmhouse');
    const stretchers = generateProjectParts(project()).parts.filter((p) => /Front Stretcher/.test(p.name));
    expect(stretchers).toHaveLength(0);
  });

  it('opens an oven pocket on a tall cabinet and sizes it', () => {
    editing('tall-oven');
    setDim('Opening width', '28');
    expect(cabinet().oven!.width).toBe(28);

    // The pocket is one object, so the panel has to be looking at the version
    // it just wrote before the next field is touched.
    reopen();
    setDim('Opening height', '24');

    expect(cabinet().oven!.openingHeight).toBe(24);
    expect(cabinet().oven!.width).toBe(28);
  });

  it('splits the face around the pocket, drawers below and doors above', () => {
    editing('tall-oven');
    const names = generateProjectParts(project()).parts.map((p) => p.name);

    expect(names).toContain('Door');
    expect(names.some((n) => /Drawer Front/.test(n))).toBe(true);
  });

  it('keeps the oven pocket out of a base cabinet', () => {
    editing('base-2door');
    expect(() => row('Opening height')).toThrow();
  });
});

describe('MaterialSummary', () => {
  it('names the box and front materials the job defaults to', () => {
    const st = useProject.getState();
    st.newProject('Summary test');

    const { container } = render(<MaterialSummary project={project()} />);
    const shown = container.textContent ?? '';
    const boxName = project().materials.find((m) => m.id === project().defaultBoxMaterialId)!.name;
    const faceName = project().materials.find((m) => m.id === project().defaultFaceMaterialId)!.name;

    expect(shown).toContain(`Box: ${boxName}`);
    expect(shown).toContain(`Fronts: ${faceName}`);
  });

  it('follows a change of default material', () => {
    const st = useProject.getState();
    st.newProject('Summary test');
    const other = project().materials.find(
      (m) => m.kind === 'sheet' && m.id !== project().defaultBoxMaterialId,
    )!;
    st.setProject({ ...project(), defaultBoxMaterialId: other.id });

    const { container } = render(<MaterialSummary project={project()} />);
    expect(container.textContent).toContain(`Box: ${other.name}`);
  });
});
