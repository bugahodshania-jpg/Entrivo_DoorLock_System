import { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

// Phones only open a picker for <input type="date">, so on touch screens this
// shows a text field that accepts typed dates (MM/DD/YYYY) plus a calendar
// button for the native picker. Desktop keeps the native date input, which
// already accepts typing. Value and onChange match a native date input:
// value is "YYYY-MM-DD" (or ""), and onChange receives { target: { value } }.

const TOUCH_QUERY = '(pointer: coarse)';

function isTouchScreen() {
  try {
    return window.matchMedia(TOUCH_QUERY).matches;
  } catch {
    return false;
  }
}

function useTouchScreen() {
  const [touch, setTouch] = useState(isTouchScreen);

  useEffect(() => {
    let media;
    try {
      media = window.matchMedia(TOUCH_QUERY);
    } catch {
      return undefined;
    }
    const update = () => setTouch(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  return touch;
}

function isoToText(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? `${match[2]}/${match[3]}/${match[1]}` : '';
}

function textToIso(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) return null;
  const [, month, day, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  const valid = date.getFullYear() === Number(year)
    && date.getMonth() === Number(month) - 1
    && date.getDate() === Number(day);
  return valid ? `${year}-${month}-${day}` : null;
}

// Digits only, with slashes added as the user types: 0315 -> 03/15.
function maskDigits(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export default function DateInput({
  value = '',
  onChange,
  onBlur,
  name,
  min,
  max,
  disabled,
  className,
  style,
  title,
  ...rest
}) {
  const touch = useTouchScreen();
  const [text, setText] = useState(() => isoToText(value));
  const [invalid, setInvalid] = useState(false);
  const lastEmitted = useRef(value);

  // Follow changes made outside the field, such as a "Clear filters" button.
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(isoToText(value));
      setInvalid(false);
    }
  }, [value]);

  const emit = (next) => {
    lastEmitted.current = next;
    onChange?.({ target: { value: next, name }, currentTarget: { value: next, name } });
  };

  if (!touch) {
    return (
      <input
        type="date"
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        name={name}
        min={min}
        max={max}
        disabled={disabled}
        className={className}
        style={style}
        title={title}
        {...rest}
      />
    );
  }

  const outOfRange = (iso) => (min && iso < min) || (max && iso > max);

  return (
    <span className="date-input" style={style}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM/DD/YYYY"
        maxLength={10}
        value={text}
        name={name}
        disabled={disabled}
        className={className}
        title={title}
        {...rest}
        aria-invalid={rest['aria-invalid'] || invalid || undefined}
        onChange={(event) => {
          const masked = maskDigits(event.target.value);
          setText(masked);
          if (masked === '') {
            setInvalid(false);
            if (value !== '') emit('');
            return;
          }
          const iso = textToIso(masked);
          if (iso && !outOfRange(iso)) {
            setInvalid(false);
            if (iso !== value) emit(iso);
          }
        }}
        onBlur={(event) => {
          const iso = textToIso(text);
          // An unfinished or impossible date is flagged instead of guessed.
          setInvalid(text !== '' && (!iso || Boolean(outOfRange(iso))));
          onBlur?.(event);
        }}
      />
      <span className="date-input-picker">
        <CalendarDays size={16} aria-hidden="true" />
        <input
          type="date"
          tabIndex={-1}
          aria-label="Open calendar"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => {
            setText(isoToText(event.target.value));
            setInvalid(false);
            emit(event.target.value);
          }}
        />
      </span>
    </span>
  );
}
