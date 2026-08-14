import { useEffect, useState } from 'react';
import { formatFrac, parseDim } from '../domain/units';

/**
 * Dimension input that speaks tape-measure. Accepts `24 1/2`, `24-1/2`,
 * `24.5`, `2' 6"`, or `620mm`, and echoes the parsed value back as a
 * fraction so the user can see what the app understood.
 */
export function DimInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => formatFrac(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatFrac(value));
  }, [value, focused]);

  const parsed = parseDim(text);
  const invalid = text.trim() !== '' && parsed === null;

  return (
    <input
      className={`dim${invalid ? ' invalid' : ''}`}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseDim(e.target.value);
        if (n !== null) onChange(n);
      }}
      onBlur={() => {
        setFocused(false);
        const n = parseDim(text);
        if (n === null) setText(formatFrac(value));
        else {
          onChange(n);
          setText(formatFrac(n));
        }
      }}
    />
  );
}

export function NumInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="num"
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const n = Number(text);
          if (Number.isFinite(n)) onChange(n);
          else setText(String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) onChange(n);
        }}
        style={suffix ? { paddingRight: 26 } : undefined}
      />
      {suffix && (
        <span
          style={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 11,
            color: 'var(--text-3)',
            pointerEvents: 'none',
          }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}

/** Percentage stored as a 0–1 fraction but edited as a whole number. */
export function PctInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return <NumInput value={Math.round(value * 1000) / 10} onChange={(n) => onChange(n / 100)} step={0.5} suffix="%" />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </label>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
