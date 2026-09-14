// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useProject } from '../../store/useProject';
import { runStatus } from '../../domain/geometry';
import { formatFrac } from '../../domain/units';
import { RunStatusBar } from '../RunStatusBar';

/**
 * The run bar is the running total of whether a wall adds up. Its whole value
 * is being trustworthy at a glance, so the figures have to agree with the
 * geometry and the three ways of closing a gap have to actually close it.
 */

function wallWith(...presets: string[]) {
  const st = useProject.getState();
  st.newProject('Run test');
  const wallId = useProject.getState().project.room.walls[0].id;
  st.setActiveWall(wallId);
  for (const key of presets) st.addCabinet(key);
  return wallId;
}

const statusFor = (wallId: string, upper = false) =>
  runStatus(useProject.getState().project, wallId, upper);

const panelText = (container: HTMLElement) => container.textContent ?? '';

afterEach(cleanup);

describe('RunStatusBar', () => {
  it('shows nothing for a wall with no cabinets on it', () => {
    const wallId = wallWith();
    const { container } = render(<RunStatusBar wallId={wallId} />);
    expect(container.textContent).toBe('');
  });

  it('reports the wall length and what the run has used', () => {
    const wallId = wallWith('base-2door', 'base-2door');
    const st = statusFor(wallId);

    const { container } = render(<RunStatusBar wallId={wallId} />);
    const text = panelText(container);

    expect(text).toContain(`${formatFrac(st.wallLength)}"`);
    expect(text).toContain(`${formatFrac(st.used)}"`);
  });

  it('counts a lone cabinet in the singular', () => {
    const wallId = wallWith('base-2door');
    render(<RunStatusBar wallId={wallId} />);
    expect(screen.getByText(/1 unit /)).toBeTruthy();
  });

  it('counts several in the plural', () => {
    const wallId = wallWith('base-2door', 'base-2door');
    render(<RunStatusBar wallId={wallId} />);
    expect(screen.getByText(/2 units /)).toBeTruthy();
  });

  it('offers the three ways of closing a leftover while one remains', () => {
    const wallId = wallWith('base-2door');
    render(<RunStatusBar wallId={wallId} />);

    expect(screen.getByRole('button', { name: 'Add filler' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Share out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stretch last' })).toBeTruthy();
  });

  it('steers a big leftover towards another cabinet rather than a filler', () => {
    const wallId = wallWith('base-2door');
    expect(statusFor(wallId).remaining).toBeGreaterThan(6);

    render(<RunStatusBar wallId={wallId} />);
    expect(screen.getByText(/usually wants another cabinet, not a filler/)).toBeTruthy();
  });

  it('recommends a filler once the leftover is small enough to scribe', () => {
    const wallId = wallWith('base-2door');
    const st = useProject.getState();
    // Widen the cabinet until only a scribe-sized gap is left.
    const status = statusFor(wallId);
    const cab = useProject.getState().project.cabinets[0];
    st.updateCabinet(cab.id, { width: cab.width + status.remaining - 3 });

    expect(statusFor(wallId).remaining).toBeLessThanOrEqual(6);
    render(<RunStatusBar wallId={wallId} />);
    expect(screen.getByText(/A filler is the usual answer at a wall/)).toBeTruthy();
  });

  it('closes the gap with a filler when asked', () => {
    const wallId = wallWith('base-2door');
    const before = useProject.getState().project.cabinets.length;
    expect(statusFor(wallId).remaining).toBeGreaterThan(0);

    render(<RunStatusBar wallId={wallId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add filler' }));

    expect(useProject.getState().project.cabinets.length).toBe(before + 1);
    expect(statusFor(wallId).remaining).toBeLessThan(1 / 16);
  });

  it('shares a leftover across every cabinet in the run', () => {
    const wallId = wallWith('base-2door', 'base-2door');
    const widthsBefore = useProject.getState().project.cabinets.map((c) => c.width);

    render(<RunStatusBar wallId={wallId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share out' }));

    const widthsAfter = useProject.getState().project.cabinets.map((c) => c.width);
    // Both grew, and by the same amount.
    expect(widthsAfter[0]).toBeGreaterThan(widthsBefore[0]);
    expect(widthsAfter[1]).toBeGreaterThan(widthsBefore[1]);
    expect(widthsAfter[0] - widthsBefore[0]).toBeCloseTo(widthsAfter[1] - widthsBefore[1], 3);
    expect(statusFor(wallId).remaining).toBeLessThan(1 / 16);
  });

  it('stretches only the last cabinet when that is what is wanted', () => {
    const wallId = wallWith('base-2door', 'base-2door');
    const widthsBefore = useProject.getState().project.cabinets.map((c) => c.width);

    render(<RunStatusBar wallId={wallId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stretch last' }));

    const widthsAfter = useProject.getState().project.cabinets.map((c) => c.width);
    expect(widthsAfter[0]).toBeCloseTo(widthsBefore[0], 6);
    expect(widthsAfter[1]).toBeGreaterThan(widthsBefore[1]);
    expect(statusFor(wallId).remaining).toBeLessThan(1 / 16);
  });

  it('drops the gap-closing controls once the run fills the wall', () => {
    const wallId = wallWith('base-2door');
    render(<RunStatusBar wallId={wallId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stretch last' }));

    expect(screen.queryByRole('button', { name: 'Add filler' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share out' })).toBeNull();
  });

  it('says plainly when the run has outgrown the wall', () => {
    const wallId = wallWith('base-2door');
    const st = useProject.getState();
    st.updateCabinet(useProject.getState().project.cabinets[0].id, {
      width: statusFor(wallId).wallLength + 12,
    });

    render(<RunStatusBar wallId={wallId} />);
    expect(screen.getByText(/This run is longer than the wall/)).toBeTruthy();
    // Closing a gap makes no sense when there is none.
    expect(screen.queryByRole('button', { name: 'Add filler' })).toBeNull();
  });
});

describe('RunStatusBar breakdown', () => {
  /** Open the per-unit list behind the summary button. */
  function openBreakdown() {
    const toggle = screen.getByRole('button', { name: /unit/ });
    fireEvent.click(toggle);
  }

  it('lists each unit in the run once opened', () => {
    const wallId = wallWith('base-2door', 'base-3drawer');
    render(<RunStatusBar wallId={wallId} />);
    openBreakdown();

    expect(screen.getByText(/Base 1/)).toBeTruthy();
    expect(screen.getByText(/Base 2/)).toBeTruthy();
  });

  it('calls out a gap opened between two units', () => {
    const wallId = wallWith('base-2door', 'base-2door');
    const st = useProject.getState();
    const [, second] = useProject.getState().project.cabinets;
    st.updateCabinet(second.id, { along: (second.along ?? 0) + 5 });

    render(<RunStatusBar wallId={wallId} />);
    openBreakdown();
    expect(screen.getByText(/5" gap/)).toBeTruthy();
  });

  it('calls out two units sitting through each other', () => {
    const wallId = wallWith('base-2door', 'base-2door');
    const st = useProject.getState();
    const [first, second] = useProject.getState().project.cabinets;
    st.updateCabinet(second.id, { along: (second.along ?? 0) - 3, pinned: true });

    render(<RunStatusBar wallId={wallId} />);
    openBreakdown();
    expect(screen.getByText(new RegExp(`3" overlap with ${first.name}`))).toBeTruthy();
  });

  it('selects a unit when its row is clicked', () => {
    const wallId = wallWith('base-2door', 'base-3drawer');
    render(<RunStatusBar wallId={wallId} />);
    openBreakdown();

    const target = useProject.getState().project.cabinets[1];
    fireEvent.click(screen.getByText(new RegExp(target.name)));

    expect(useProject.getState().selectedCabinetId).toBe(target.id);
  });
});
