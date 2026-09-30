import { Fragment } from 'react';
import { shortcutLabel } from '../lib/platform';
import { Dialog, Kbd } from '../ui';

interface Shortcut {
  /** Alternatives, each a combo ("mod+k", "alt+ArrowLeft"). */
  keys: string[];
  label: string;
  /** Show the alternatives as "A / B" (pair) instead of "A or B". */
  pair?: boolean;
}

export const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Diagram',
    items: [
      { keys: ['e'], label: 'Explain & expand the selected box' },
      { keys: ['shift+e'], label: 'Expand it again (new expansion)' },
      { keys: ['a'], label: 'Ask about the selected box' },
      { keys: ['p'], label: 'Step through the numbered arrows' },
      { keys: [',', '.'], label: 'Previous / next step', pair: true },
      { keys: ['f'], label: 'Fit view' },
      { keys: ['Escape'], label: 'Close panel / clear selection' },
    ],
  },
  {
    title: 'Navigate',
    items: [
      { keys: ['u', 'alt+ArrowLeft'], label: 'Parent diagram' },
      { keys: ['[', ']'], label: 'Previous / next sibling diagram', pair: true },
      { keys: ['m'], label: 'Toggle conversation map' },
      { keys: ['mod+b'], label: 'Toggle sidebar' },
    ],
  },
  {
    title: 'General',
    items: [
      { keys: ['/'], label: 'Ask a question' },
      { keys: ['mod+k'], label: 'Command palette' },
      { keys: ['?'], label: 'Keyboard shortcuts' },
    ],
  },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Keyboard shortcuts" size="md">
      <div className="grid gap-5 pt-1 sm:grid-cols-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section
            key={group.title}
            className={group.title === 'General' ? 'sm:col-span-2' : undefined}
          >
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-subtle uppercase">
              {group.title}
            </h3>
            <ul className="flex flex-col">
              {group.items.map((item) => (
                <li
                  key={item.label}
                  className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 text-[13px] last:border-b-0"
                >
                  <span className="text-fg">{item.label}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-subtle">
                    {item.keys.map((combo, index) => (
                      <Fragment key={combo}>
                        {index > 0 ? <span>{item.pair ? '/' : 'or'}</span> : null}
                        <Kbd>{shortcutLabel(combo)}</Kbd>
                      </Fragment>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
