/**
 * Tests for the anti-cheat install layer.
 *
 * [UPDATED v2 — M7] — verifies the Mac DevTools combos (Cmd+Opt+I, Cmd+Opt+J,
 * Cmd+Opt+C) are detected in addition to the v1 Windows/Linux combos.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installAntiCheat } from './anti-cheat';
import type { ViolationType } from './runtime-types';

type OnViolation = (type: ViolationType, wasActive: boolean) => void;

function fireKey(opts: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): KeyboardEvent {
  const evt = new KeyboardEvent('keydown', {
    key: opts.key,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(evt);
  return evt;
}

describe('installAntiCheat — devtools shortcuts', () => {
  let onViolation: ReturnType<typeof vi.fn>;
  let dispose: () => void;

  beforeEach(() => {
    onViolation = vi.fn();
    dispose = installAntiCheat({ onViolation: onViolation as OnViolation });
  });

  afterEach(() => {
    dispose();
  });

  it('detects F12', () => {
    fireKey({ key: 'F12' });
    expect(onViolation).toHaveBeenCalledWith(
      'DEVTOOLS_KEYSTROKE',
      expect.any(Boolean),
    );
  });

  it('detects Windows Ctrl+Shift+I', () => {
    fireKey({ key: 'I', ctrlKey: true, shiftKey: true });
    expect(onViolation).toHaveBeenCalled();
    expect(onViolation.mock.calls[0][0]).toBe(
      'DEVTOOLS_KEYSTROKE' satisfies ViolationType,
    );
  });

  // [UPDATED v2 — M7]
  it('detects Mac Cmd+Opt+I', () => {
    fireKey({ key: 'i', metaKey: true, altKey: true });
    expect(onViolation).toHaveBeenCalled();
    expect(onViolation.mock.calls[0][0]).toBe('DEVTOOLS_KEYSTROKE');
  });

  // [UPDATED v2 — M7]
  it('detects Mac Cmd+Opt+J', () => {
    fireKey({ key: 'j', metaKey: true, altKey: true });
    expect(onViolation).toHaveBeenCalled();
  });

  // [UPDATED v2 — M7]
  it('detects Mac Cmd+Opt+C (Inspect Element)', () => {
    fireKey({ key: 'c', metaKey: true, altKey: true });
    expect(onViolation).toHaveBeenCalled();
  });

  it('does NOT fire on plain typing keys', () => {
    fireKey({ key: 'a' });
    fireKey({ key: 'Enter' });
    fireKey({ key: 'i' }); // no modifiers
    expect(onViolation).not.toHaveBeenCalled();
  });

  it('does NOT fire on Cmd+C alone (legitimate paste-allowed-elsewhere copy on Mac)', () => {
    // Cmd+C without altKey/shiftKey is NOT a devtools combo. The clipboard
    // detector handles copy separately.
    fireKey({ key: 'c', metaKey: true });
    expect(onViolation).not.toHaveBeenCalled();
  });
});
