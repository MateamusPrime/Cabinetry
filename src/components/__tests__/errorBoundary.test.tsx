// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

/**
 * A render fault must never look like the job has been lost. React logs
 * caught errors itself, so console.error is silenced here to keep the run
 * readable — the boundary's own logging is asserted rather than printed.
 */

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

describe('ErrorBoundary', () => {
  it('stays out of the way while everything renders', () => {
    render(
      <ErrorBoundary>
        <p>The drawing</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('The drawing')).toBeTruthy();
  });

  it('explains the break and says the work is still there', () => {
    render(
      <ErrorBoundary>
        <Boom message="cannot read width of undefined" />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something in the drawing broke')).toBeTruthy();
    expect(screen.getByText(/nothing has been lost/)).toBeTruthy();
  });

  it('shows what actually went wrong rather than a generic apology', () => {
    render(
      <ErrorBoundary>
        <Boom message="cannot read width of undefined" />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/cannot read width of undefined/)).toBeTruthy();
  });

  it('keeps the real error in the console for whoever is reading it', () => {
    render(
      <ErrorBoundary>
        <Boom message="kerf is not a number" />
      </ErrorBoundary>,
    );

    const ours = logged.mock.calls.find((c) => c[0] === 'Cabinetry render error:');
    expect(ours).toBeTruthy();
    expect((ours![1] as Error).message).toBe('kerf is not a number');
  });

  it('offers a way back that does not wipe anything', () => {
    render(
      <ErrorBoundary>
        <Boom message="boom" />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save a copy of the project' })).toBeTruthy();
  });

  it('hands back the stored project when asked to save a copy', async () => {
    localStorage.setItem('cabinetry.project.v1', '{"cabinets":[],"name":"Rescued"}');

    let saved: Blob | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (b: Blob) => {
        saved = b;
        return 'blob:rescued';
      },
      revokeObjectURL: () => {},
    });

    render(
      <ErrorBoundary>
        <Boom message="boom" />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy of the project' }));

    expect(saved).toBeTruthy();
    await expect(saved!.text()).resolves.toContain('Rescued');
  });

  it('does nothing rash when there is no stored project to save', () => {
    localStorage.removeItem('cabinetry.project.v1');
    const created = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', { ...URL, createObjectURL: created, revokeObjectURL: () => {} });

    render(
      <ErrorBoundary>
        <Boom message="boom" />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy of the project' }));

    expect(created).not.toHaveBeenCalled();
  });
});
