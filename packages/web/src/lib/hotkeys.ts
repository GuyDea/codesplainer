/**
 * Global keyboard shortcuts. Combos look like "mod+k", "alt+ArrowLeft", "shift+e", "?", "[".
 * `mod` = Ctrl or Cmd. Plain shortcuts are ignored while typing (inputs, textareas, selects,
 * contenteditable / code editors) and while a modal dialog or menu is open, unless opted in.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';

export interface HotkeyBinding {
  combo: string | string[];
  handler: (event: KeyboardEvent) => void;
  /** Also fire while focus is in a text field / editor. */
  allowInInputs?: boolean;
  /** Also fire while a modal dialog, the command palette or a menu is open. */
  allowInOverlays?: boolean;
  /** Default true. */
  preventDefault?: boolean;
  enabled?: boolean;
}

export interface ParsedCombo {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  space: ' ',
  plus: '+',
};

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

export function parseCombo(combo: string): ParsedCombo {
  const parsed: ParsedCombo = {
    key: '',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  };
  // "+" itself may be the key ("mod++"), so split carefully.
  const parts = combo === '+' ? ['+'] : combo.split(/\+(?!$)/);
  for (const raw of parts) {
    const part = raw.trim().toLowerCase();
    if (part === 'mod') parsed.mod = true;
    else if (part === 'ctrl' || part === 'control') parsed.ctrl = true;
    else if (part === 'meta' || part === 'cmd') parsed.meta = true;
    else if (part === 'alt' || part === 'option') parsed.alt = true;
    else if (part === 'shift') parsed.shift = true;
    else parsed.key = normalizeKey(raw.trim() || raw);
  }
  return parsed;
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function matchCombo(event: KeyLike, combo: string | ParsedCombo): boolean {
  const c = typeof combo === 'string' ? parseCombo(combo) : combo;
  if (!event.key || normalizeKey(event.key) !== c.key) return false;
  if (c.mod) {
    if (!event.ctrlKey && !event.metaKey) return false;
  } else {
    if (event.ctrlKey !== c.ctrl || event.metaKey !== c.meta) return false;
  }
  if (event.altKey !== c.alt) return false;
  if (c.shift) return event.shiftKey;
  // Shift is part of how symbols like "?" are typed; only letters/named keys must not be shifted.
  const isSymbol = c.key.length === 1 && !/[a-z0-9]/.test(c.key);
  return isSymbol || !event.shiftKey;
}

const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
]);

/** True when the event target is a place where the user types. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT')
    return !NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || '').toLowerCase());
  if (el.isContentEditable) return true;
  return Boolean(el.closest('[contenteditable]:not([contenteditable="false"]), .cm-editor'));
}

/** True while a modal dialog, the palette or a dropdown menu is open. */
export function isOverlayOpen(doc: Document = document): boolean {
  return doc.querySelector('[aria-modal="true"], [role="menu"]') !== null;
}

export interface HotkeyEnvironment {
  editable: boolean;
  overlay: boolean;
}

/** Run the first binding that matches. Returns true when one fired. */
export function dispatchHotkey(
  event: KeyboardEvent,
  bindings: HotkeyBinding[],
  env: HotkeyEnvironment = {
    editable: isEditableTarget(event.target),
    overlay: isOverlayOpen(),
  },
): boolean {
  if (event.defaultPrevented || event.isComposing || event.key === 'Process') return false;
  for (const binding of bindings) {
    if (binding.enabled === false) continue;
    const combos = Array.isArray(binding.combo) ? binding.combo : [binding.combo];
    if (!combos.some((combo) => matchCombo(event, combo))) continue;
    if (env.editable && !binding.allowInInputs) continue;
    if (env.overlay && !binding.allowInOverlays) continue;
    if (binding.preventDefault !== false) event.preventDefault();
    binding.handler(event);
    return true;
  }
  return false;
}

/** Register window-level shortcuts for the lifetime of the component (latest handlers win). */
export function useHotkeys(bindings: HotkeyBinding[]): void {
  const ref = useRef(bindings);
  useLayoutEffect(() => {
    ref.current = bindings;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      dispatchHotkey(event, ref.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
