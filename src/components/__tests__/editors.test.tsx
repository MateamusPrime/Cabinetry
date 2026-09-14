// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useProject } from '../../store/useProject';
import { ApplianceEditor } from '../ApplianceEditor';
import { BarTopEditor } from '../BarTopEditor';
import { WindowEditor } from '../WindowEditor';

/**
 * The side-panel editors are how the model actually gets changed. Each test
 * drives the control a user would touch and then reads the store back, so a
 * field wired to the wrong property cannot pass.
 */

function freshProject(name = 'Editor test') {
  const st = useProject.getState();
  st.newProject(name);
  st.setActiveWall(useProject.getState().project.room.walls[0].id);
  return useProject.getState().project;
}

const project = () => useProject.getState().project;

/** Type into the dimension field belonging to a labelled row. */
function setField(label: string, value: string) {
  const row = screen.getByText(label).closest('label')!;
  const input = within(row).getByRole('textbox') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

afterEach(cleanup);

describe('WindowEditor', () => {
  function openWindowEditor() {
    freshProject();
    useProject.getState().addWindow();
    const win = project().windows[0];
    const view = render(<WindowEditor window={win} project={project()} />);
    return { win, view };
  }

  it('renames the opening', () => {
    const { win } = openWindowEditor();
    const nameBox = screen.getAllByRole('textbox')[0];
    fireEvent.change(nameBox, { target: { value: 'Sink window' } });

    expect(project().windows.find((w) => w.id === win.id)!.name).toBe('Sink window');
  });

  it('resizes the rough opening', () => {
    const { win } = openWindowEditor();
    setField('Width', '36');
    setField('Height', '48');

    const after = project().windows.find((w) => w.id === win.id)!;
    expect(after.width).toBe(36);
    expect(after.height).toBe(48);
  });

  it('refuses a nonsensical size rather than storing it', () => {
    const { win } = openWindowEditor();
    setField('Width', '0');

    // The editor floors the opening at an inch.
    expect(project().windows.find((w) => w.id === win.id)!.width).toBe(1);
  });

  it('centres the opening on its wall', () => {
    const { win } = openWindowEditor();
    const wall = project().room.walls.find((w) => w.id === win.wallId)!;
    const wallLength = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);

    fireEvent.click(screen.getByRole('button', { name: 'Centre on wall' }));

    const after = project().windows.find((w) => w.id === win.id)!;
    expect(after.along).toBeCloseTo((wallLength - after.width) / 2, 6);
  });

  it('drops the sill to a height that clears a counter', () => {
    const { win } = openWindowEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Sill at 42"' }));
    expect(project().windows.find((w) => w.id === win.id)!.sillHeight).toBe(42);
  });

  it('warns when the opening runs off the end of the wall', () => {
    const { win } = openWindowEditor();
    const wall = project().room.walls.find((w) => w.id === win.wallId)!;
    const wallLength = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1);

    useProject.getState().updateWindow(win.id, { along: wallLength - 6, width: 36 });
    cleanup();
    render(<WindowEditor window={project().windows[0]} project={project()} />);

    expect(screen.getByText(/past the end of the wall/)).toBeTruthy();
  });

  it('warns when the head stands above the top of the wall', () => {
    const { win } = openWindowEditor();
    useProject.getState().updateWindow(win.id, { sillHeight: 90, height: 60 });
    cleanup();
    render(<WindowEditor window={project().windows[0]} project={project()} />);

    expect(screen.getByText(/above the top of the wall/)).toBeTruthy();
  });

  it('hides the opening without touching the cut list', () => {
    const { win } = openWindowEditor();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(project().windows.find((w) => w.id === win.id)!.hidden).toBe(true);
  });

  it('deletes the opening', () => {
    openWindowEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Delete window' }));
    expect(project().windows).toHaveLength(0);
  });
});

describe('ApplianceEditor', () => {
  function openApplianceEditor(preset = 'range-30') {
    freshProject();
    useProject.getState().addAppliance(preset);
    const appliance = project().appliances[0];
    render(<ApplianceEditor appliance={appliance} project={project()} />);
    return appliance;
  }

  it('resizes the appliance', () => {
    const appliance = openApplianceEditor();
    setField('Width', '36');
    setField('Depth', '25');

    const after = project().appliances.find((a) => a.id === appliance.id)!;
    expect(after.width).toBe(36);
    expect(after.depth).toBe(25);
  });

  it('moves it along the wall it belongs to', () => {
    const appliance = openApplianceEditor();
    setField('Along wall', '48');
    expect(project().appliances.find((a) => a.id === appliance.id)!.along).toBe(48);
  });

  it('sits it back on the floor', () => {
    const appliance = openApplianceEditor();
    useProject.getState().updateAppliance(appliance.id, { mountHeight: 54 });
    cleanup();
    render(<ApplianceEditor appliance={project().appliances[0]} project={project()} />);

    fireEvent.click(screen.getByTitle('Sit it on the floor'));
    expect(project().appliances.find((a) => a.id === appliance.id)!.mountHeight).toBe(0);
  });

  it('removes it from the job', () => {
    openApplianceEditor();
    const remove = screen.getAllByRole('button').find((b) => /delete|remove/i.test(b.textContent ?? ''));
    expect(remove).toBeTruthy();
    fireEvent.click(remove!);
    expect(project().appliances).toHaveLength(0);
  });
});

describe('BarTopEditor', () => {
  function openBarEditor() {
    freshProject();
    useProject.getState().addBarTop();
    const bar = project().barTops![0];
    render(<BarTopEditor bar={bar} project={project()} />);
    return bar;
  }

  it('sets the pony wall to standard bar height', () => {
    const bar = openBarEditor();
    fireEvent.click(screen.getByTitle('Standard bar height'));
    expect(project().barTops!.find((b) => b.id === bar.id)!.wallHeight).toBe(42);
  });

  it('drops the pony wall flush with the counter', () => {
    const bar = openBarEditor();
    fireEvent.click(screen.getByTitle('Flush with the counter'));
    expect(project().barTops!.find((b) => b.id === bar.id)!.wallHeight).toBe(36);
  });

  it('sets the knee-room overhang', () => {
    const bar = openBarEditor();
    setField('Front (knee room)', '15');
    expect(project().barTops!.find((b) => b.id === bar.id)!.overhangFront).toBe(15);
  });

  it('squares both ends flush at once', () => {
    const bar = openBarEditor();
    useProject.getState().updateBarTop(bar.id, { overhangLeft: 6, overhangRight: 6 });
    cleanup();
    render(<BarTopEditor bar={project().barTops![0]} project={project()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Flush ends' }));

    const after = project().barTops!.find((b) => b.id === bar.id)!;
    expect(after.overhangLeft).toBe(0);
    expect(after.overhangRight).toBe(0);
  });

  it('returns the slab past both ends', () => {
    const bar = openBarEditor();
    fireEvent.click(screen.getByTitle('Return the slab past both ends of the wall'));

    const after = project().barTops!.find((b) => b.id === bar.id)!;
    expect(after.overhangLeft).toBe(1.5);
    expect(after.overhangRight).toBe(1.5);
  });
});
