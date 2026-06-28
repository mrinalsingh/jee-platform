'use client';

import { useCallback, useRef, useState } from 'react';

import {
  applyKey,
  applyPaste,
  type NumericInputConfig,
} from '@/lib/numeric-input';

export interface NumericInputBaseProps {
  value: string;
  onChange: (next: string) => void;
  config: NumericInputConfig;
  disabled: boolean;
  helperText: string;
  ariaLabel: string;
}

/**
 * Numeric input with virtual keypad + physical keyboard. Used by NUM-INT and
 * NUM-DEC. The precision cap is enforced at keystroke time (PRD US-3 Blocker 1).
 */
export function NumericInputBase(
  props: NumericInputBaseProps,
): React.ReactElement {
  const { value, onChange, config, disabled, helperText, ariaLabel } = props;
  const [ghost, setGhost] = useState<string | null>(null);
  const ghostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const flashGhost = useCallback((msg: string) => {
    setGhost(msg);
    if (ghostTimer.current) clearTimeout(ghostTimer.current);
    ghostTimer.current = setTimeout(() => setGhost(null), 2000);
  }, []);

  const press = useCallback(
    (key: string) => {
      if (disabled) return;
      const { value: next, rejected } = applyKey(value, key, config);
      if (rejected) {
        if (config.kind === 'NUM-DEC' && /[0-9]/.test(key)) {
          flashGhost(
            `This problem allows ${config.precision} decimal place${
              config.precision === 1 ? '' : 's'
            }`,
          );
        } else if (key === '-' && value.length > 0) {
          flashGhost('Minus sign is allowed only at the start');
        } else if (key === '.' && config.kind === 'NUM-INT') {
          flashGhost('This is an integer answer');
        }
        return;
      }
      onChange(next);
    },
    [value, config, disabled, onChange, flashGhost],
  );

  const onPhysicalKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // let copy/paste handlers fire
    if (e.key === 'Tab') return; // allow focus traversal
    e.preventDefault();
    press(e.key);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>): void => {
    if (disabled) return;
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    const { value: next, truncated } = applyPaste(pasted, config);
    onChange(next);
    if (truncated) {
      flashGhost('Pasted value was trimmed to fit');
    }
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className="numeric-input w-full h-10 px-3 rounded-lg border border-border-subtle bg-surface-0 text-text-primary text-lg font-mono focus:outline-2 focus:outline-accent disabled:opacity-50"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={() => {
          /* controlled — physical keys go via onKeyDown */
        }}
        onKeyDown={onPhysicalKey}
        onPaste={onPaste}
      />
      <div className="flex items-center justify-between">
        <p className="text-caption text-text-secondary text-sm">{helperText}</p>
        {ghost && (
          <p className="text-caption text-sm text-amber-600 transition-opacity">
            {ghost}
          </p>
        )}
      </div>

      <div
        className="grid grid-cols-4 gap-2 max-w-xs"
        role="group"
        aria-label="Virtual keypad"
      >
        {['7', '8', '9', 'Backspace'].map((k) => (
          <KeypadButton key={k} k={k} onPress={press} disabled={disabled} />
        ))}
        {['4', '5', '6', 'Clear'].map((k) => (
          <KeypadButton key={k} k={k} onPress={press} disabled={disabled} />
        ))}
        {['1', '2', '3', '-'].map((k) => (
          <KeypadButton key={k} k={k} onPress={press} disabled={disabled} />
        ))}
        <KeypadButton k="0" onPress={press} disabled={disabled} />
        {config.kind === 'NUM-DEC' && config.precision > 0 ? (
          <KeypadButton k="." onPress={press} disabled={disabled} />
        ) : (
          <div />
        )}
        <div />
        <div />
      </div>
    </div>
  );
}

function KeypadButton({
  k,
  onPress,
  disabled,
}: {
  k: string;
  onPress: (k: string) => void;
  disabled: boolean;
}): React.ReactElement {
  const label = k === 'Backspace' ? '←' : k === 'Clear' ? 'Clr' : k;
  return (
    <button
      type="button"
      onClick={() => onPress(k)}
      disabled={disabled}
      className="h-10 rounded-lg border border-border-subtle bg-surface-0 hover:bg-surface-2 transition-colors text-text-primary font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label={`Keypad ${k}`}
    >
      {label}
    </button>
  );
}
