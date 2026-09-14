// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { DimInput, Field, NumInput, PctInput, Select, Toggle } from '../Inputs';

/**
 * These are the primitives every editor is built from, so a fault here shows
 * up everywhere at once. The dimension field in particular has to speak tape
 * measure and never quietly keep a number the user did not type.
 */

afterEach(cleanup);

/** A controlled host, so the field behaves as it does inside a real editor. */
function Host({ start, onValue }: { start: number; onValue?: (n: number) => void }) {
  const [v, setV] = useState(start);
  return (
    <>
      <DimInput
        value={v}
        onChange={(n) => {
          setV(n);
          onValue?.(n);
        }}
      />
      <output>{v}</output>
    </>
  );
}

const field = () => screen.getByRole('textbox') as HTMLInputElement;

describe('DimInput', () => {
  it('shows the value the way a shop writes it', () => {
    render(<DimInput value={34.5} onChange={() => {}} />);
    expect(field().value).toBe('34 1/2');
  });

  it.each([
    ['24 1/2', 24.5],
    ['24-1/2', 24.5],
    ['24.5', 24.5],
    ['2\' 6"', 30],
    ['36', 36],
  ])('accepts %s as %s', (typed, expected) => {
    const onChange = vi.fn();
    render(<DimInput value={0} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: typed } });
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it('takes millimetres and converts them to inches', () => {
    const onChange = vi.fn();
    render(<DimInput value={0} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: '620mm' } });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.lastCall![0]).toBeCloseTo(620 / 25.4, 6);
  });

  it('flags nonsense rather than guessing at it', () => {
    const onChange = vi.fn();
    render(<DimInput value={12} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: 'about yay big' } });

    expect(field().className).toContain('invalid');
    // Never hand the model a number the user did not type.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not flag an empty field the user is still clearing', () => {
    render(<DimInput value={12} onChange={() => {}} />);
    fireEvent.change(field(), { target: { value: '' } });
    expect(field().className).not.toContain('invalid');
  });

  it('puts the last good value back when a bad entry is abandoned', () => {
    render(<DimInput value={18.25} onChange={() => {}} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'qqq' } });
    fireEvent.blur(field());

    expect(field().value).toBe('18 1/4');
    expect(field().className).not.toContain('invalid');
  });

  it('normalises a valid entry to a fraction on the way out', () => {
    render(<Host start={0} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: '24.375' } });
    fireEvent.blur(field());

    expect(field().value).toBe('24 3/8');
  });

  it('leaves a half-typed entry alone while the field has focus', () => {
    const { rerender } = render(<DimInput value={10} onChange={() => {}} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: '12 1/' } });

    // A re-render from elsewhere must not snatch the text mid-keystroke.
    rerender(<DimInput value={99} onChange={() => {}} />);
    expect(field().value).toBe('12 1/');
  });

  it('picks up a value changed elsewhere once the field is idle', () => {
    const { rerender } = render(<DimInput value={10} onChange={() => {}} />);
    rerender(<DimInput value={22.5} onChange={() => {}} />);
    expect(field().value).toBe('22 1/2');
  });

  it('reports each good value as it is typed', () => {
    const seen: number[] = [];
    render(<Host start={0} onValue={(n) => seen.push(n)} />);
    fireEvent.change(field(), { target: { value: '12' } });
    fireEvent.change(field(), { target: { value: '12.5' } });

    expect(seen).toEqual([12, 12.5]);
    expect(screen.getByText('12.5')).toBeTruthy();
  });
});

describe('NumInput', () => {
  const num = () => screen.getByRole('spinbutton') as HTMLInputElement;

  it('carries its step and bounds onto the control', () => {
    render(<NumInput value={3} onChange={() => {}} step={0.5} min={0} max={10} />);
    expect(num().step).toBe('0.5');
    expect(num().min).toBe('0');
    expect(num().max).toBe('10');
  });

  it('reports a number as it is typed', () => {
    const onChange = vi.fn();
    render(<NumInput value={1} onChange={onChange} />);
    fireEvent.change(num(), { target: { value: '7' } });
    expect(onChange).toHaveBeenLastCalledWith(7);
  });

  it('stays quiet while the field is empty', () => {
    const onChange = vi.fn();
    render(<NumInput value={1} onChange={onChange} />);
    fireEvent.change(num(), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('restores the old value when an empty field loses focus', () => {
    render(<NumInput value={4} onChange={() => {}} />);
    fireEvent.focus(num());
    fireEvent.change(num(), { target: { value: '' } });
    fireEvent.blur(num());
    expect(num().value).toBe('4');
  });

  it('shows a unit beside the number when given one', () => {
    render(<NumInput value={2} onChange={() => {}} suffix="hrs" />);
    expect(screen.getByText('hrs')).toBeTruthy();
  });
});

describe('PctInput', () => {
  const num = () => screen.getByRole('spinbutton') as HTMLInputElement;

  it('edits a stored fraction as a whole percent', () => {
    render(<PctInput value={0.15} onChange={() => {}} />);
    expect(num().value).toBe('15');
    expect(screen.getByText('%')).toBeTruthy();
  });

  it('stores a typed percent back as a fraction', () => {
    const onChange = vi.fn();
    render(<PctInput value={0.15} onChange={onChange} />);
    fireEvent.change(num(), { target: { value: '22' } });
    expect(onChange).toHaveBeenLastCalledWith(0.22);
  });

  it('keeps a half percent rather than rounding it away', () => {
    render(<PctInput value={0.155} onChange={() => {}} />);
    expect(num().value).toBe('15.5');
  });
});

describe('Field, Toggle and Select', () => {
  it('labels a control and carries its hint', () => {
    render(
      <Field label="Cabinet width" hint="Face to face">
        <input />
      </Field>,
    );
    expect(screen.getByText('Cabinet width')).toBeTruthy();
    expect(screen.getByText('Face to face')).toBeTruthy();
  });

  it('leaves out the hint when there is none', () => {
    const { container } = render(
      <Field label="Width">
        <input />
      </Field>,
    );
    expect(container.querySelector('.field-hint')).toBeNull();
  });

  it('reports a toggle both ways', () => {
    const onChange = vi.fn();
    render(<Toggle label="Finished back" checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox') as HTMLInputElement;

    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);

    cleanup();
    render(<Toggle label="Finished back" checked onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('offers every option and reports the one chosen', () => {
    const onChange = vi.fn();
    render(
      <Select
        value="frameless"
        onChange={onChange}
        options={[
          { value: 'frameless', label: 'Frameless' },
          { value: 'faceFrame', label: 'Face Frame' },
        ]}
      />,
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;

    expect([...select.options].map((o) => o.textContent)).toEqual(['Frameless', 'Face Frame']);
    expect(select.value).toBe('frameless');

    fireEvent.change(select, { target: { value: 'faceFrame' } });
    expect(onChange).toHaveBeenLastCalledWith('faceFrame');
  });
});
