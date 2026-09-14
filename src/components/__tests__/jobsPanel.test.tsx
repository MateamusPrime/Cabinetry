// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useProject } from '../../store/useProject';
import { JobsPanel } from '../JobsPanel';

/**
 * The job library is the difference between a design toy and something a shop
 * runs a business on. Work that looks filed away but is not is the failure
 * that matters here, so the storage-refused path is covered as carefully as
 * the happy one.
 */

function newJobNamed(name: string, ...presets: string[]) {
  const st = useProject.getState();
  st.newProject(name);
  st.setActiveWall(useProject.getState().project.room.walls[0].id);
  for (const key of presets) st.addCabinet(key);
}

/** Rows of the saved-jobs table, as arrays of cell text. */
function jobRows(container: HTMLElement): string[][] {
  return [...container.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent ?? ''),
  );
}

const refuseWrites = () =>
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    const err = new Error('exceeded the quota');
    err.name = 'QuotaExceededError';
    throw err;
  });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('JobsPanel', () => {
  it('starts with an empty library and says so', () => {
    newJobNamed('First');
    render(<JobsPanel onClose={() => {}} />);

    expect(screen.getByText(/Nothing saved yet/)).toBeTruthy();
    expect(screen.getByText('Saved Jobs (0)')).toBeTruthy();
  });

  it('files the open job and lists it with its measurements', () => {
    newJobNamed('Miller Kitchen', 'base-2door', 'wall-2door');
    const { container } = render(<JobsPanel onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save open job to library' }));

    const rows = jobRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toContain('Miller Kitchen');
    // Two 24" cabinets on the wall is four linear feet.
    expect(rows[0][2]).toBe('2');
    expect(rows[0][3]).toBe('4.0');
  });

  it('marks the job that is currently open', () => {
    newJobNamed('Open one', 'base-2door');
    const { container } = render(<JobsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save open job to library' }));

    expect(jobRows(container)[0][0]).toContain('open');
    // You cannot open or delete the job you are already in.
    const buttons = [...container.querySelectorAll('tbody button')] as HTMLButtonElement[];
    expect(buttons.find((b) => b.textContent === 'Open')!.disabled).toBe(true);
    expect(buttons.find((b) => b.textContent === 'Delete')!.disabled).toBe(true);
  });

  it('will not create a job without a name', () => {
    newJobNamed('First');
    render(<JobsPanel onClose={() => {}} />);

    const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Miller Kitchen'), { target: { value: 'Second' } });
    expect(create.disabled).toBe(false);
  });

  it('files the open job before starting a new one, so nothing is lost', () => {
    newJobNamed('Has work', 'base-2door');
    const onClose = vi.fn();
    render(<JobsPanel onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('Miller Kitchen'), { target: { value: 'Fresh' } });
    fireEvent.change(screen.getByPlaceholderText('Dave Miller'), { target: { value: 'Dave' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(useProject.getState().project.name).toBe('Fresh');
    expect(useProject.getState().project.client).toBe('Dave');
    // The old job went to the library on the way past.
    expect(useProject.getState().listJobs().some((j) => j.name === 'Has work')).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('asks before deleting and only then removes the job', () => {
    newJobNamed('Doomed', 'base-2door');
    useProject.getState().saveJob();
    // Move off it, since the open job cannot be deleted.
    newJobNamed('Elsewhere');
    const { container } = render(<JobsPanel onClose={() => {}} />);

    expect(jobRows(container)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    // Nothing is gone yet — it wants confirming.
    expect(jobRows(container)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Really delete?' }));
    expect(jobRows(container)).toHaveLength(0);
  });

  it('copies a job under its own name', () => {
    newJobNamed('Original', 'base-2door');
    const { container } = render(<JobsPanel onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save open job to library' }));

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    const names = jobRows(container).map((r) => r[0]);
    expect(names).toHaveLength(2);
    expect(names.some((n) => n.includes('Original (copy)'))).toBe(true);
  });

  it('opens a saved job in place of the one on screen', () => {
    newJobNamed('Job A', 'base-2door');
    const idA = useProject.getState().project.id;
    useProject.getState().saveJob();

    newJobNamed('Job B');
    const onClose = vi.fn();
    render(<JobsPanel onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(useProject.getState().project.id).toBe(idA);
    expect(useProject.getState().project.name).toBe('Job A');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('JobsPanel when storage refuses the write', () => {
  it('says the save failed instead of looking like it worked', () => {
    newJobNamed('Too big', 'base-2door');
    const { container } = render(<JobsPanel onClose={() => {}} />);
    refuseWrites();

    fireEvent.click(screen.getByRole('button', { name: 'Save open job to library' }));

    const alert = container.querySelector('.alert.bad');
    expect(alert).toBeTruthy();
    expect(alert!.textContent).toMatch(/storage is full/i);
  });

  it('stays put rather than switching away over unsaved work', () => {
    newJobNamed('Job A', 'base-2door');
    useProject.getState().saveJob();
    newJobNamed('Job B');
    const idB = useProject.getState().project.id;

    const onClose = vi.fn();
    const { container } = render(<JobsPanel onClose={onClose} />);
    refuseWrites();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(useProject.getState().project.id).toBe(idB);
    expect(container.querySelector('.alert.bad')).toBeTruthy();
    // The panel stays open so the message is actually seen.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the new-job form filled in when the job could not be created', () => {
    newJobNamed('Has work', 'base-2door');
    const onClose = vi.fn();
    render(<JobsPanel onClose={onClose} />);
    refuseWrites();

    const nameBox = screen.getByPlaceholderText('Miller Kitchen') as HTMLInputElement;
    fireEvent.change(nameBox, { target: { value: 'Fresh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(useProject.getState().project.name).toBe('Has work');
    expect(nameBox.value).toBe('Fresh');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reports a refused delete', () => {
    newJobNamed('Doomed', 'base-2door');
    useProject.getState().saveJob();
    newJobNamed('Elsewhere');

    const { container } = render(<JobsPanel onClose={() => {}} />);
    refuseWrites();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Really delete?' }));

    expect(container.querySelector('.alert.bad')).toBeTruthy();
  });
});
