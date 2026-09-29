/** Platform helpers (shortcut labels). */

export const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent,
  );

const NAMES: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  escape: 'Esc',
  enter: '↵',
  ' ': 'Space',
};

/** "mod+k" -> "⌘K" on macOS, "Ctrl K" elsewhere. */
export function shortcutLabel(combo: string, mac = isMac): string {
  const parts = combo.split('+').map((p) => p.trim());
  const key = parts.pop() ?? '';
  const mods = parts.map((m) => {
    switch (m.toLowerCase()) {
      case 'mod':
        return mac ? '⌘' : 'Ctrl';
      case 'ctrl':
        return mac ? '⌃' : 'Ctrl';
      case 'meta':
        return mac ? '⌘' : 'Meta';
      case 'alt':
        return mac ? '⌥' : 'Alt';
      case 'shift':
        return mac ? '⇧' : 'Shift';
      default:
        return m;
    }
  });
  const keyLabel = NAMES[key.toLowerCase()] ?? (key.length === 1 ? key.toUpperCase() : key);
  return mac ? [...mods, keyLabel].join('') : [...mods, keyLabel].join(' ');
}
