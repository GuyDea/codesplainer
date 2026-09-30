/**
 * CodeMirror 6 building blocks for the read-only CodeViewer: range highlight (line decorations +
 * gutter marker), themes built from the app's CSS variables, and lazy language loading.
 */
import {
  EditorSelection,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutterLineClass } from '@codemirror/view';
import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
  type TagStyle,
} from '@codemirror/language';
import { color as oneDarkColor, oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

// ---- highlighted line range -------------------------------------------------------------------

export interface LineRange {
  start: number;
  end: number;
}

export const setLineRange = StateEffect.define<LineRange | null>();

class RangeGutterMarker extends GutterMarker {
  override elementClass = 'cm-range-gutter';
}
const rangeGutterMarker = new RangeGutterMarker();
const rangeLine = Decoration.line({ class: 'cm-range-line' });

/** Clamp a 1-based inclusive range to the document. */
export function clampRange(
  range: { startLine: number; endLine?: number } | null | undefined,
  lines: number,
): LineRange | null {
  if (!range || !Number.isFinite(range.startLine) || lines < 1) return null;
  const start = Math.min(Math.max(1, Math.floor(range.startLine)), lines);
  const endRaw = range.endLine ?? start;
  const end = Math.min(Math.max(start, Math.floor(endRaw)), lines);
  return { start, end };
}

function lineStarts(state: EditorState, range: LineRange): number[] {
  const out: number[] = [];
  for (let n = range.start; n <= range.end; n++) out.push(state.doc.line(n).from);
  return out;
}

export const lineRangeField = StateField.define<LineRange | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setLineRange)) return effect.value;
    return value;
  },
  provide: (field) => [
    EditorView.decorations.compute([field], (state) => {
      const range = state.field(field);
      if (!range) return Decoration.none;
      const builder = new RangeSetBuilder<Decoration>();
      for (const from of lineStarts(state, range)) builder.add(from, from, rangeLine);
      return builder.finish();
    }),
    gutterLineClass.compute([field], (state) => {
      const range = state.field(field);
      if (!range) return RangeSet.empty;
      const builder = new RangeSetBuilder<GutterMarker>();
      for (const from of lineStarts(state, range)) builder.add(from, from, rangeGutterMarker);
      return builder.finish();
    }),
  ],
});

/** Highlight `range` and (optionally) scroll it into view, centered when it fits. */
export function showLineRange(view: EditorView, range: LineRange | null, scroll: boolean): void {
  const effects: StateEffect<unknown>[] = [setLineRange.of(range)];
  if (range && scroll) {
    const doc = view.state.doc;
    const from = doc.line(range.start).from;
    const to = doc.line(range.end).to;
    const lineHeight = view.defaultLineHeight || 20;
    const visible = Math.floor(view.scrollDOM.clientHeight / lineHeight);
    const fits = visible <= 0 || range.end - range.start + 1 <= visible - 4;
    // The range's head is its start: centered vertically, and horizontally scrolled to the first
    // column rather than to the end of the (possibly long) last line.
    effects.push(
      fits
        ? EditorView.scrollIntoView(EditorSelection.range(to, from), { y: 'center' })
        : EditorView.scrollIntoView(from, { y: 'start', yMargin: 3 * lineHeight }),
    );
  }
  view.dispatch({ effects });
}

// ---- themes -----------------------------------------------------------------------------------

const MIX = (varName: string, pct: number) =>
  `color-mix(in oklab, var(${varName}) ${pct}%, transparent)`;

/** Editor chrome from the app's design tokens (the tokens switch with the `.dark` class). */
function chrome(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': {
        height: '100%',
        color: 'var(--fg)',
        backgroundColor: 'var(--surface)',
        fontSize: '12.5px',
      },
      '&.cm-focused': { outline: 'none' },
      // Keyboard focus: an inset ring on the editor instead of the global outline on the content.
      '.cm-content:focus-visible': { outline: 'none' },
      '&:has(.cm-content:focus-visible)': {
        outline: `2px solid ${MIX('--accent', 45)}`,
        outlineOffset: '-2px',
      },
      '.cm-scroller': { fontFamily: 'inherit', lineHeight: '20px' },
      '.cm-content': { padding: '8px 0 24px', caretColor: 'transparent' },
      '.cm-line': { padding: '0 16px 0 10px' },
      '.cm-gutters': {
        backgroundColor: 'var(--surface)',
        color: 'var(--subtle)',
        border: 'none',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        minWidth: '40px',
        padding: '0 10px 0 12px',
        fontSize: '11.5px',
        lineHeight: '20px',
        fontVariantNumeric: 'tabular-nums',
      },
      '.cm-gutterElement.cm-range-gutter': {
        color: 'var(--accent)',
        fontWeight: '600',
        boxShadow: 'inset -2px 0 0 var(--accent)',
      },
      '.cm-range-line': { backgroundColor: MIX('--accent', dark ? 14 : 8) },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: MIX('--accent', dark ? 34 : 24) },
      '.cm-selectionMatch': { backgroundColor: MIX('--accent', dark ? 20 : 13) },
      '.cm-searchMatch': {
        backgroundColor: MIX('--warn', dark ? 26 : 22),
        outline: `1px solid ${MIX('--warn', 60)}`,
        borderRadius: '2px',
      },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: MIX('--warn', dark ? 48 : 42) },
      '.cm-specialChar': { color: 'var(--danger)' },
      '.cm-panels': {
        backgroundColor: 'var(--surface-2)',
        color: 'var(--fg)',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
      '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
      '.cm-panel.cm-search, .cm-panel.cm-gotoLine': {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 32px 6px 8px',
        fontSize: '12px',
      },
      '.cm-panel.cm-search br': { display: 'none' },
      '.cm-panel input, .cm-panel button, .cm-panel label': { margin: '0' },
      '.cm-textfield': {
        height: '26px',
        padding: '0 8px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        color: 'var(--fg)',
        fontSize: '12px',
        outline: 'none',
      },
      '.cm-textfield:focus': {
        borderColor: 'var(--accent)',
        boxShadow: `0 0 0 2px ${MIX('--accent', 25)}`,
      },
      '.cm-button': {
        height: '26px',
        padding: '0 10px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        backgroundImage: 'none',
        backgroundColor: 'var(--surface)',
        color: 'var(--fg)',
        fontSize: '12px',
        textTransform: 'capitalize',
        cursor: 'pointer',
      },
      '.cm-button:hover': { backgroundColor: 'var(--surface-3)' },
      '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--surface-3)' },
      '.cm-panel.cm-search label': {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '12px',
        color: 'var(--muted)',
        textTransform: 'capitalize',
      },
      '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--accent)' },
      '.cm-panel.cm-search [name=close]': {
        top: '50%',
        right: '8px',
        transform: 'translateY(-50%)',
        color: 'var(--muted)',
        fontSize: '18px',
      },
      '.cm-tooltip': {
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        color: 'var(--fg)',
        borderRadius: '8px',
      },
    },
    { dark },
  );
}

/**
 * Syntax palettes. Dark = One Dark with the base text color taken from the app; light = a
 * One Light style palette with AA-leaning contrast on white. Both style exactly the same tags.
 */
const DARK_COLORS: Record<string, string> = {
  [oneDarkColor.ivory]: 'var(--fg)',
  [oneDarkColor.invalid]: 'var(--danger)',
};
const LIGHT_COLORS: Record<string, string> = {
  [oneDarkColor.violet]: '#a626a4',
  [oneDarkColor.coral]: '#c4402f',
  [oneDarkColor.malibu]: '#3b67d6',
  [oneDarkColor.whiskey]: '#946200',
  [oneDarkColor.chalky]: '#a86b00',
  [oneDarkColor.cyan]: '#0b7fa8',
  [oneDarkColor.sage]: '#3f8a3e',
  [oneDarkColor.stone]: 'var(--subtle)',
  [oneDarkColor.ivory]: 'var(--fg)',
  [oneDarkColor.invalid]: 'var(--danger)',
};

function remap(style: HighlightStyle, colors: Record<string, string>): HighlightStyle {
  return HighlightStyle.define(
    style.specs.map((spec): TagStyle => {
      const next: TagStyle = { ...spec };
      if (typeof spec.color === 'string') next.color = colors[spec.color] ?? spec.color;
      return next;
    }),
  );
}

const darkHighlight = remap(oneDarkHighlightStyle, DARK_COLORS);
const lightHighlight = remap(oneDarkHighlightStyle, LIGHT_COLORS);

const lightTheme: Extension = [chrome(false), syntaxHighlighting(lightHighlight)];
const darkTheme: Extension = [chrome(true), syntaxHighlighting(darkHighlight)];

export function codeTheme(theme: 'light' | 'dark'): Extension {
  return theme === 'dark' ? darkTheme : lightTheme;
}

// ---- languages --------------------------------------------------------------------------------

let languageList: Promise<readonly LanguageDescription[]> | null = null;

/** @codemirror/language-data is imported lazily so it stays out of the main chunk. */
function languageDescriptions(): Promise<readonly LanguageDescription[]> {
  languageList ??= import('@codemirror/language-data').then((m) => m.languages);
  return languageList;
}

/** Find and load the language support for a file (null when unknown or failing to load). */
export async function loadLanguage(path: string, hint?: string): Promise<Extension | null> {
  try {
    const languages = await languageDescriptions();
    const name = path.split('/').pop() ?? path;
    const desc =
      LanguageDescription.matchFilename(languages, name) ??
      LanguageDescription.matchFilename(languages, name.toLowerCase()) ??
      (hint ? LanguageDescription.matchLanguageName(languages, hint, true) : null);
    if (!desc) return null;
    return desc.support ?? (await desc.load());
  } catch {
    return null;
  }
}
