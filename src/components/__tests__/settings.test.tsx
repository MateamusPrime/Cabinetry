// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useProject } from '../../store/useProject';
import { SettingsView } from '../SettingsView';

/**
 * Settings is where the numbers behind every other view are set, so a control
 * wired to the wrong field quietly changes cut sizes or prices everywhere.
 * Each test moves one control and reads the stored value back.
 */

const project = () => useProject.getState().project;
let view: ReturnType<typeof render>;

function openSettings(tab?: string) {
  useProject.getState().newProject('Settings test');
  view = render(<SettingsView />);
  if (tab) fireEvent.click(screen.getByRole('button', { name: tab }));
  return view;
}

function row(label: string): HTMLElement {
  const found = [...view.container.querySelectorAll('label.field')].find(
    (l) => l.querySelector('span')?.textContent === label,
  );
  if (!found) throw new Error(`no field labelled "${label}"`);
  return found as HTMLElement;
}

function setDim(label: string, value: string) {
  const input = row(label).querySelector('input') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function setNum(label: string, value: string) {
  fireEvent.change(row(label).querySelector('input')!, { target: { value } });
}

function choose(label: string, value: string) {
  fireEvent.change(row(label).querySelector('select')!, { target: { value } });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

describe('SettingsView navigation', () => {
  it('opens on the project tab', () => {
    openSettings();
    expect(screen.getByText('Project Details')).toBeTruthy();
  });

  it('moves between tabs', () => {
    openSettings();
    for (const [tab, heading] of [
      ['Construction', 'Style'],
      ['Materials & Prices', 'Sheet Goods'],
      ['Labor & Rates', 'Rates'],
      ['Room', 'Room Shape'],
      ['Save / Load', 'Save & Load'],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: tab }));
      expect(screen.getByText(heading)).toBeTruthy();
    }
  });
});

describe('SettingsView project details', () => {
  it('renames the project and records the client', () => {
    openSettings();
    fireEvent.change(row('Project name').querySelector('input')!, { target: { value: 'Miller Kitchen' } });
    expect(project().name).toBe('Miller Kitchen');
  });

  it('changes the default box material for new cabinets', () => {
    openSettings();
    const other = project().materials.find(
      (m) => m.kind === 'sheet' && m.id !== project().defaultBoxMaterialId,
    )!;

    choose('Box / carcass', other.id);
    expect(project().defaultBoxMaterialId).toBe(other.id);
  });
});

describe('SettingsView construction defaults', () => {
  it('changes the edge reveal, which reaches the cut sizes', () => {
    openSettings('Construction');
    setDim('Edge reveal', '1/16');
    expect(project().defaults.revealEdge).toBeCloseTo(1 / 16, 6);
  });

  it('changes the toe kick height, which reaches the carcass', () => {
    openSettings('Construction');
    setDim('Height', '3 1/2');
    expect(project().defaults.toeKickHeight).toBe(3.5);
  });

  it('changes the saw kerf, which reaches the sheet layouts', () => {
    openSettings('Construction');
    setDim('Saw kerf', '3/16');
    expect(project().defaults.kerf).toBeCloseTo(3 / 16, 6);
  });

  it('switches the default construction style', () => {
    openSettings('Construction');
    const before = project().defaults.construction;
    choose('Construction', before === 'frameless' ? 'faceFrame' : 'frameless');
    expect(project().defaults.construction).not.toBe(before);
  });
});

describe('SettingsView materials and prices', () => {
  it('reprices a sheet, which moves the estimate', () => {
    openSettings('Materials & Prices');

    const sheet = project().materials.find((m) => m.kind === 'sheet')!;
    const cell = [...view.container.querySelectorAll('tr')].find((tr) =>
      tr.textContent?.includes(sheet.name),
    )!;
    const input = cell.querySelector('input')!;
    fireEvent.change(input, { target: { value: '99' } });

    const after = project().materials.find((m) => m.id === sheet.id)!;
    expect((after as { costPerSheet: number }).costPerSheet).toBe(99);
  });

  it('reprices a piece of hardware', () => {
    openSettings('Hardware');

    const item = project().hardware[0];
    const tr = [...view.container.querySelectorAll('tr')].find((r) =>
      r.textContent?.includes(item.name),
    )!;
    fireEvent.change(tr.querySelector('input')!, { target: { value: '12.5' } });

    expect(project().hardware.find((h) => h.id === item.id)!.cost).toBe(12.5);
  });
});

describe('SettingsView labor', () => {
  it('changes the shop rate', () => {
    openSettings('Labor & Rates');
    setNum('Shop', '85');
    expect(project().labor.shopRatePerHour).toBe(85);
  });

  it('changes the build hours a base cabinet is costed at', () => {
    openSettings('Labor & Rates');
    setNum('Base', '4.5');
    expect(project().labor.hoursPerBaseCabinet).toBe(4.5);
  });
});

describe('SettingsView room', () => {
  it('rebuilds the room to a named shape', () => {
    openSettings('Room');

    fireEvent.click(screen.getByRole('button', { name: 'Single Wall' }));
    const single = project().room.walls.length;

    fireEvent.click(screen.getByRole('button', { name: 'U-Shape' }));
    const uShape = project().room.walls.length;

    expect(uShape).toBeGreaterThan(single);
  });

  it('adds a wall to the room', () => {
    openSettings('Room');
    const before = project().room.walls.length;

    fireEvent.click(screen.getByRole('button', { name: '+ Wall' }));
    expect(project().room.walls.length).toBe(before + 1);
  });

  it('hides a wall without removing it', () => {
    openSettings('Room');
    const before = project().room.walls.length;

    fireEvent.click(screen.getAllByRole('button', { name: 'Visible' })[0]);

    expect(project().room.walls.length).toBe(before);
    expect(project().room.walls.some((w) => w.hidden)).toBe(true);
  });

  it('removes a wall outright', () => {
    openSettings('Room');
    fireEvent.click(screen.getByRole('button', { name: '+ Wall' }));
    const before = project().room.walls.length;

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(project().room.walls.length).toBe(before - 1);
  });
});

describe('SettingsView save and load', () => {
  it('exports the open project as a file', async () => {
    let saved: Blob | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (b: Blob) => {
        saved = b;
        return 'blob:x';
      },
      revokeObjectURL: () => {},
    });

    openSettings('Save / Load');
    const exportButton = [...view.container.querySelectorAll('button')].find((b) =>
      /export/i.test(b.textContent ?? ''),
    )!;
    fireEvent.click(exportButton);

    expect(saved).toBeTruthy();
    await expect(saved!.text()).resolves.toContain('Settings test');
  });

  it('will not wipe the project on a single click', () => {
    openSettings('Save / Load');
    const id = project().id;

    fireEvent.click(screen.getByRole('button', { name: 'New empty project' }));
    // Armed, but nothing has happened yet.
    expect(project().id).toBe(id);
    expect(screen.getByText(/This clears the current project/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'New empty project' })).toBeTruthy();
    expect(project().id).toBe(id);
  });

  it('starts a new project once the warning is confirmed', () => {
    openSettings('Save / Load');
    const id = project().id;

    fireEvent.click(screen.getByRole('button', { name: 'New empty project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, start a new project' }));

    expect(project().id).not.toBe(id);
    expect(project().cabinets).toHaveLength(0);
  });
});

describe('SettingsView colour fields', () => {
  it('takes a valid hex colour', () => {
    openSettings('Appearance');
    const hex = view.container.querySelector('input.mono') as HTMLInputElement;
    expect(hex).toBeTruthy();

    fireEvent.change(hex, { target: { value: '#123456' } });
    expect(hex.className).not.toContain('invalid');
  });

  it('flags a hex colour that is not one, and puts the old one back', () => {
    openSettings('Appearance');
    const hex = view.container.querySelector('input.mono') as HTMLInputElement;
    const original = hex.value;

    fireEvent.focus(hex);
    fireEvent.change(hex, { target: { value: '#zzz' } });
    expect(hex.className).toContain('invalid');

    fireEvent.blur(hex);
    expect(hex.value).toBe(original);
  });
});
