import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchHotkey,
  isEditableTarget,
  isOverlayOpen,
  matchCombo,
  parseCombo,
  type HotkeyBinding,
} from '../src/lib/hotkeys';
import { shortcutLabel } from '../src/lib/platform';

function key(init: KeyboardEventInit & { key: string }, target?: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('combos', () => {
  it('parses modifiers and keys', () => {
    expect(parseCombo('mod+k')).toMatchObject({ key: 'k', mod: true });
    expect(parseCombo('alt+ArrowLeft')).toMatchObject({ key: 'arrowleft', alt: true });
    expect(parseCombo('shift+e')).toMatchObject({ key: 'e', shift: true });
    expect(parseCombo('?').key).toBe('?');
    expect(parseCombo('Esc').key).toBe('escape');
  });

  it('matches exactly', () => {
    expect(matchCombo(key({ key: 'k', ctrlKey: true }), 'mod+k')).toBe(true);
    expect(matchCombo(key({ key: 'k', metaKey: true }), 'mod+k')).toBe(true);
    expect(matchCombo(key({ key: 'k' }), 'mod+k')).toBe(false);
    expect(matchCombo(key({ key: 'e' }), 'e')).toBe(true);
    expect(matchCombo(key({ key: 'E', shiftKey: true }), 'e')).toBe(false);
    expect(matchCombo(key({ key: 'E', shiftKey: true }), 'shift+e')).toBe(true);
    expect(matchCombo(key({ key: 'e', ctrlKey: true }), 'e')).toBe(false);
    expect(matchCombo(key({ key: '?', shiftKey: true }), '?')).toBe(true);
    expect(matchCombo(key({ key: 'ArrowLeft', altKey: true }), 'alt+ArrowLeft')).toBe(true);
    expect(matchCombo(key({ key: 'ArrowLeft' }), 'alt+ArrowLeft')).toBe(false);
  });

  it('formats labels per platform', () => {
    expect(shortcutLabel('mod+k', true)).toBe('⌘K');
    expect(shortcutLabel('mod+k', false)).toBe('Ctrl K');
    expect(shortcutLabel('alt+ArrowLeft', false)).toBe('Alt ←');
    expect(shortcutLabel('?', false)).toBe('?');
  });
});

describe('input filtering', () => {
  it('detects places where the user types', () => {
    const text = document.createElement('input');
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const area = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    editable.appendChild(inner);
    const cm = document.createElement('div');
    cm.className = 'cm-editor';
    const cmLine = document.createElement('div');
    cm.appendChild(cmLine);
    const button = document.createElement('button');
    document.body.append(text, checkbox, area, select, editable, cm, button);

    expect(isEditableTarget(text)).toBe(true);
    expect(isEditableTarget(area)).toBe(true);
    expect(isEditableTarget(select)).toBe(true);
    expect(isEditableTarget(inner)).toBe(true);
    expect(isEditableTarget(cmLine)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(button)).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('skips plain shortcuts while typing unless allowed', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const plain = vi.fn();
    const palette = vi.fn();
    const bindings: HotkeyBinding[] = [
      { combo: 'e', handler: plain },
      { combo: 'mod+k', handler: palette, allowInInputs: true },
    ];
    expect(dispatchHotkey(key({ key: 'e' }, input), bindings)).toBe(false);
    expect(plain).not.toHaveBeenCalled();
    const event = key({ key: 'k', ctrlKey: true }, input);
    expect(dispatchHotkey(event, bindings)).toBe(true);
    expect(palette).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(dispatchHotkey(key({ key: 'e' }, document.body), bindings)).toBe(true);
    expect(plain).toHaveBeenCalledOnce();
  });

  it('skips shortcuts while a dialog or menu is open', () => {
    const handler = vi.fn();
    const overlayHandler = vi.fn();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    expect(isOverlayOpen()).toBe(true);
    const bindings: HotkeyBinding[] = [
      { combo: 'm', handler },
      { combo: 'mod+k', handler: overlayHandler, allowInOverlays: true },
    ];
    dispatchHotkey(key({ key: 'm' }, document.body), bindings);
    dispatchHotkey(key({ key: 'k', metaKey: true }, document.body), bindings);
    expect(handler).not.toHaveBeenCalled();
    expect(overlayHandler).toHaveBeenCalledOnce();
    dialog.remove();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    expect(isOverlayOpen()).toBe(true);
    menu.remove();
    expect(isOverlayOpen()).toBe(false);
  });

  it('ignores handled, composing and disabled events', () => {
    const handler = vi.fn();
    const handled = key({ key: 'f' }, document.body);
    handled.preventDefault();
    expect(dispatchHotkey(handled, [{ combo: 'f', handler }])).toBe(false);
    expect(
      dispatchHotkey(key({ key: 'f', isComposing: true }, document.body), [
        { combo: 'f', handler },
      ]),
    ).toBe(false);
    expect(
      dispatchHotkey(key({ key: 'f' }, document.body), [{ combo: 'f', handler, enabled: false }]),
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
