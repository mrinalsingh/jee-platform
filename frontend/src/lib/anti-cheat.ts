/**
 * Anti-cheat detection layer (PRD US-9, architecture §8.1).
 *
 * Installs handlers at the runtime root mount; tears them all down at unmount
 * via the returned `dispose` function. Each detection calls `onViolation` with
 * the canonical `ViolationType`; the RuntimeProvider owns the counter +
 * progressive-banner state-machine (lock #6).
 *
 * Honest limits (PRD §5.9 / arch §8.5):
 *   - cannot prevent devtools opened via browser menu;
 *   - cannot prevent screenshots / second device;
 *   - on iOS Safari < 16 there's no fullscreen API — runtime hard-blocks
 *     viewports < 768 px so this is rare in practice.
 */

import type { ViolationType } from './runtime-types';

export interface AntiCheatOptions {
  onViolation: (type: ViolationType, wasActive: boolean) => void;
  /** if the focus lands inside a node matching this selector, paste is allowed */
  numericInputSelector?: string;
}

// [UPDATED v2 — M7] — adds Mac Safari/Chrome canonical DevTools shortcuts
// (Cmd+Opt+I open DevTools, Cmd+Opt+J open Console, Cmd+Opt+C Inspect Element)
// alongside the existing Win/Linux Ctrl+Shift+I / J and F12 / Ctrl+U combos.
const DEVTOOLS_KEY_COMBOS: Array<(e: KeyboardEvent) => boolean> = [
  (e) => e.key === 'F12',
  // Windows / Linux: Ctrl+Shift+I / J  •  also fires if a Mac user happens to
  // hold the Ctrl key explicitly.
  (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i',
  (e) => (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'j',
  // Mac canonical: Cmd+Opt+I (DevTools), Cmd+Opt+J (Console),
  // Cmd+Opt+C (Inspect Element). The `altKey` is the Opt key.
  (e) => (e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'i',
  (e) => (e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'j',
  (e) => (e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'c',
  // View Source (both platforms): Ctrl/Cmd+U
  (e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u',
];

function isInsideSelector(
  el: EventTarget | null,
  selector: string | undefined,
): boolean {
  if (!selector || !el || !(el instanceof Element)) return false;
  return Boolean(el.closest(selector));
}

export function installAntiCheat(opts: AntiCheatOptions): () => void {
  if (typeof document === 'undefined') return () => {};

  const fire = (type: ViolationType): void => {
    opts.onViolation(type, !document.hidden);
  };

  const onVisibility = (): void => {
    if (document.hidden) fire('TAB_SWITCH');
  };

  const onBlur = (): void => {
    // Defer one tick so the visibilitychange event (if any) fires first
    setTimeout(() => {
      if (!document.hasFocus()) fire('WINDOW_BLUR');
    }, 0);
  };

  const onFullscreenChange = (): void => {
    if (document.fullscreenElement === null) fire('FULLSCREEN_EXIT');
  };

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    fire('RIGHT_CLICK');
  };

  const onCopy = (e: ClipboardEvent): void => {
    if (isInsideSelector(e.target, opts.numericInputSelector)) return;
    e.preventDefault();
    fire('COPY');
  };
  const onCut = (e: ClipboardEvent): void => {
    if (isInsideSelector(e.target, opts.numericInputSelector)) return;
    e.preventDefault();
    fire('CUT');
  };
  const onPaste = (e: ClipboardEvent): void => {
    if (isInsideSelector(e.target, opts.numericInputSelector)) return;
    e.preventDefault();
    fire('PASTE');
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (DEVTOOLS_KEY_COMBOS.some((m) => m(e))) {
      e.preventDefault();
      fire('DEVTOOLS_KEYSTROKE');
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCut);
  document.addEventListener('paste', onPaste);
  document.addEventListener('keydown', onKeyDown);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCut);
    document.removeEventListener('paste', onPaste);
    document.removeEventListener('keydown', onKeyDown);
  };
}

export function requestRuntimeFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const el = document.documentElement;
  if (!el.requestFullscreen) return Promise.resolve();
  // Fullscreen requires a user-activation context — caller MUST invoke
  // this from a click handler.
  return el.requestFullscreen().catch(() => {
    // E4 — browser denied fullscreen: not a violation, just audited.
  });
}

export function violationLabel(type: ViolationType): string {
  switch (type) {
    case 'TAB_SWITCH':
      return 'tab switch';
    case 'WINDOW_BLUR':
      return 'window focus loss';
    case 'FULLSCREEN_EXIT':
      return 'fullscreen exited';
    case 'RIGHT_CLICK':
      return 'right-click attempt';
    case 'COPY':
      return 'copy attempt';
    case 'CUT':
      return 'cut attempt';
    case 'PASTE':
      return 'paste attempt';
    case 'DEVTOOLS_KEYSTROKE':
      return 'devtools shortcut';
  }
}
