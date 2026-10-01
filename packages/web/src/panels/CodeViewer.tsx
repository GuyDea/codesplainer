import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import {
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from '@codemirror/search';
import { selectAll } from '@codemirror/commands';
import {
  Check,
  CircleAlert,
  CodeXml,
  Copy,
  FileCode,
  FileX,
  Search,
  SquareArrowOutUpRight,
  WrapText,
  X,
} from 'lucide-react';
import { formatBytes, formatRef } from '@codesplainer/shared';
import { cn } from '../lib/cn';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Menu,
  Spinner,
  Tooltip,
  type MenuItem,
} from '../ui';
import { clampRange, codeTheme, lineRangeField, loadLanguage, showLineRange } from './codemirror';
import { dirName, fileIcon, fileName, lineRangeLabel, modKeyLabel } from './helpers';
import { useCopy } from './hooks';
import { ACTIVE_ICON_BUTTON } from './parts';
import type { CodeViewerProps } from './types';

interface CodeSelection {
  startLine: number;
  endLine: number;
  text: string;
  from: number;
  to: number;
}

/**
 * Where the floating "Ask about lines" button goes: next to the selection head, or (null) the
 * bottom-right corner when the head is off-screen / not measurable.
 */
type Anchor = { top: number; left: number } | null;

const MEASURE_KEY = {};
const SKELETON = [62, 48, 71, 35, 80, 56, 22, 67, 44, 73, 38, 58, 26, 64, 51, 30];

function describeSelection(state: EditorState): CodeSelection | null {
  const sel = state.selection.main;
  if (sel.empty) return null;
  const doc = state.doc;
  const startLine = doc.lineAt(sel.from).number;
  let endLine = doc.lineAt(sel.to).number;
  // A selection ending at the start of a line does not include that line.
  if (endLine > startLine && doc.line(endLine).from === sel.to) endLine -= 1;
  return {
    startLine,
    endLine,
    text: doc.sliceString(sel.from, sel.to),
    from: sel.from,
    to: sel.to,
  };
}

function linesLabel(start: number, end: number): string {
  return start === end ? `line ${start}` : `lines ${start}–${end}`;
}

function CodeSkeleton() {
  return (
    <div role="status" aria-label="Loading file" className="flex flex-col gap-[9px] px-4 py-3.5">
      {SKELETON.map((width, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-2.5 w-5 shrink-0 rounded bg-surface-2" />
          <div
            className="h-2.5 animate-pulse-soft rounded bg-surface-2 motion-reduce:animate-none"
            style={{ width: `${width}%`, animationDelay: `${(i % 5) * 120}ms` }}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Read-only CodeMirror 6 viewer with a highlighted line range. Fills its parent: give it a
 * bounded height (h-full / flex-1 min-h-0). One EditorView lives for the component's lifetime;
 * file changes swap the state, range/theme changes are dispatched.
 */
export function CodeViewer({
  file,
  loading,
  error,
  range,
  multiFolder,
  theme,
  onAskSelection,
  onOpenInEditor,
  onClose,
  className,
}: CodeViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [themeSlot] = useState(() => new Compartment());
  const [languageSlot] = useState(() => new Compartment());
  const [wrapSlot] = useState(() => new Compartment());
  const [wrap, setWrap] = useState(false);
  const [selection, setSelection] = useState<CodeSelection | null>(null);
  const [anchor, setAnchor] = useState<Anchor>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, copy] = useCopy();
  const mod = modKeyLabel();

  // Latest props for CodeMirror callbacks (set before any effect below runs).
  const latest = useRef({ theme, wrap, range, onAskSelection });
  useLayoutEffect(() => {
    latest.current = { theme, wrap, range, onAskSelection };
  });

  /** Position the floating button next to the selection head (after CodeMirror's layout). */
  const measure = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.empty) return;
    view.requestMeasure<Anchor>({
      key: MEASURE_KEY,
      read: (v) => {
        const box = area.current?.getBoundingClientRect();
        const backward = sel.head < sel.anchor;
        const coords = v.coordsAtPos(sel.head, backward ? 1 : -1);
        if (!box || !coords || !box.width) return null;
        const scroller = v.scrollDOM.getBoundingClientRect();
        if (coords.bottom < scroller.top || coords.top > scroller.bottom) return null;
        const top = backward ? coords.top - box.top - 32 : coords.bottom - box.top + 6;
        const left = Math.min(
          Math.max(8, coords.left - box.left - 12),
          Math.max(8, box.width - 200),
        );
        return { top: Math.min(Math.max(4, top), Math.max(4, box.height - 32)), left };
      },
      write: (value) => setAnchor(value),
    });
  }, []);

  const extensionsFor = useCallback(
    (path: string): Extension[] => {
      const ask = (view: EditorView) => {
        const s = describeSelection(view.state);
        if (!s) return false;
        latest.current.onAskSelection({ startLine: s.startLine, endLine: s.endLine, text: s.text });
        return true;
      };
      const collapse = (view: EditorView) => {
        const sel = view.state.selection.main;
        if (sel.empty) return false;
        view.dispatch({ selection: { anchor: sel.head } });
        return true;
      };
      return [
        lineNumbers(),
        highlightSpecialChars(),
        drawSelection(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.contentAttributes.of({
          tabindex: '0',
          'aria-readonly': 'true',
          'aria-label': path ? `Code: ${path}` : 'Code',
        }),
        search({ top: true }),
        highlightSelectionMatches(),
        keymap.of([
          { key: 'Mod-Enter', run: ask },
          { key: 'Escape', run: collapse },
          { key: 'Mod-a', run: selectAll },
          ...searchKeymap,
        ]),
        lineRangeField,
        themeSlot.of(codeTheme(latest.current.theme)),
        wrapSlot.of(latest.current.wrap ? EditorView.lineWrapping : []),
        languageSlot.of([]),
        EditorView.updateListener.of((update) => {
          if (!update.selectionSet && !update.docChanged) return;
          const next = describeSelection(update.state);
          setSelection((prev) =>
            prev && next && prev.from === next.from && prev.to === next.to ? prev : next,
          );
          if (next) measure();
        }),
        EditorView.domEventHandlers({
          mousedown: (event) => {
            if (event.button === 0) setDragging(true);
            return false;
          },
        }),
      ];
    },
    [themeSlot, wrapSlot, languageSlot, measure],
  );

  // One view for the component's lifetime.
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: '', extensions: extensionsFor('') }),
    });
    viewRef.current = view;
    const onScroll = () => measure();
    const onMouseUp = () => {
      setDragging(false);
      measure();
    };
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScroll);
      window.removeEventListener('mouseup', onMouseUp);
      view.destroy();
      viewRef.current = null;
    };
  }, [extensionsFor, measure]);

  // New file: swap the whole state, then load its language asynchronously.
  const shown = file && !file.binary ? file : null;
  const content = shown?.content;
  const path = shown?.path;
  const language = shown?.language;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || content === undefined || path === undefined) return;
    view.setState(EditorState.create({ doc: content, extensions: extensionsFor(path) }));
    setSelection(null);
    setAnchor(null);
    showLineRange(view, clampRange(latest.current.range, view.state.doc.lines), true);
    let cancelled = false;
    void loadLanguage(path, language).then((support) => {
      if (cancelled || !support || viewRef.current !== view) return;
      view.dispatch({ effects: languageSlot.reconfigure(support) });
    });
    return () => {
      cancelled = true;
    };
  }, [content, path, language, extensionsFor, languageSlot]);

  // Range changes on the same file: re-highlight and scroll.
  const hasDoc = content !== undefined;
  const startLine = range?.startLine;
  const endLine = range?.endLine;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !hasDoc) return;
    const next = startLine === undefined ? null : { startLine, endLine };
    showLineRange(view, clampRange(next, view.state.doc.lines), true);
  }, [startLine, endLine, hasDoc]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeSlot.reconfigure(codeTheme(theme)) });
  }, [theme, themeSlot]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapSlot.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap, wrapSlot]);

  const scrollToRange = () => {
    const view = viewRef.current;
    if (!view || !range) return;
    showLineRange(view, clampRange(range, view.state.doc.lines), true);
  };

  const openFind = () => {
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    openSearchPanel(view);
  };

  const ask = () => {
    if (!selection) return;
    onAskSelection({
      startLine: selection.startLine,
      endLine: selection.endLine,
      text: selection.text,
    });
  };

  // ---- header ----
  const editorLine = range?.startLine ?? selection?.startLine;
  const rangeLabel = range ? lineRangeLabel(range) : '';
  const copyItems: MenuItem[] = file
    ? [
        {
          id: 'path',
          label: 'Copy path',
          icon: Copy,
          onSelect: () => copy(formatRef({ folder: file.folder, path: file.path }, multiFolder)),
        },
        {
          id: 'absolute',
          label: 'Copy absolute path',
          icon: Copy,
          onSelect: () => copy(file.absolutePath),
        },
        ...(range
          ? [
              {
                id: 'ref',
                label: `Copy reference (${rangeLabel})`,
                icon: CodeXml,
                onSelect: () =>
                  copy(
                    formatRef(
                      {
                        folder: file.folder,
                        path: file.path,
                        startLine: range.startLine,
                        endLine: range.endLine,
                      },
                      multiFolder,
                    ),
                  ),
              } satisfies MenuItem,
            ]
          : []),
      ]
    : [];

  const name = file ? fileName(file.path) : '';
  const dir = file ? dirName(file.path) : '';
  const TypeIcon = file ? fileIcon(name) : FileCode;
  const showEditor = Boolean(shown) && !error;

  const header = (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
      {file ? (
        <>
          <TypeIcon size={14} aria-hidden className="shrink-0 text-subtle" />
          <Tooltip label={file.absolutePath} delay={500} className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5 font-mono text-[12.5px]">
              {multiFolder && file.folder ? (
                <span className="shrink-0 rounded bg-surface-2 px-1.5 py-px text-[11px] text-muted">
                  {file.folder}
                </span>
              ) : null}
              {/* The directory gives way first; a long file name is cut too rather than overflow. */}
              <span className="flex min-w-0 items-baseline overflow-hidden">
                {dir ? (
                  <span className="min-w-0 shrink-[999] truncate text-subtle">{dir}/</span>
                ) : null}
                <span className="min-w-0 truncate font-medium text-fg">{name}</span>
              </span>
            </div>
          </Tooltip>
          <span className="hidden shrink-0 text-xs whitespace-nowrap text-subtle tabular-nums @md:inline">
            {formatBytes(file.size)} · {file.lineCount.toLocaleString()}{' '}
            {file.lineCount === 1 ? 'line' : 'lines'}
          </span>
          {file.truncated ? (
            <Tooltip label="Cut at the size limit">
              <Badge tone="warn" tabIndex={0}>
                Truncated
              </Badge>
            </Tooltip>
          ) : null}
          {file.binary ? <Badge>Binary</Badge> : null}
          {range && shown ? (
            <Tooltip label="Scroll to highlighted lines">
              <button
                type="button"
                onClick={scrollToRange}
                aria-label={`Scroll to ${linesLabel(range.startLine, range.endLine ?? range.startLine)}`}
                className="inline-flex h-5 shrink-0 items-center rounded-full bg-accent-soft px-2 font-mono text-[11px] font-medium text-accent hover:ring-1 hover:ring-accent/40 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
              >
                L{rangeLabel}
              </button>
            </Tooltip>
          ) : null}
          {loading ? <Spinner size={13} className="shrink-0" /> : null}
        </>
      ) : loading ? (
        <div className="h-2.5 w-48 animate-pulse-soft rounded bg-surface-2 motion-reduce:animate-none" />
      ) : (
        <span className="text-[13px] text-muted">Code</span>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {shown ? (
          <>
            <IconButton
              icon={WrapText}
              label="Wrap lines"
              active={wrap}
              onClick={() => setWrap((v) => !v)}
              className={cn(wrap && ACTIVE_ICON_BUTTON)}
            />
            <IconButton icon={Search} label="Find" shortcut={`${mod} F`} onClick={openFind} />
          </>
        ) : null}
        {file ? (
          <>
            <IconButton
              icon={SquareArrowOutUpRight}
              label={editorLine ? `Open in editor at line ${editorLine}` : 'Open in editor'}
              onClick={() => onOpenInEditor(editorLine)}
            />
            <Menu items={copyItems} align="end">
              <IconButton icon={copied ? Check : Copy} label={copied ? 'Copied' : 'Copy path'} />
            </Menu>
          </>
        ) : null}
        <IconButton icon={X} label="Close" onClick={onClose} />
      </div>
    </div>
  );

  let overlay = null;
  if (error && !loading) {
    overlay = (
      <EmptyState
        icon={CircleAlert}
        title="Couldn’t open file"
        description={<span className="font-mono text-xs break-words">{error}</span>}
        className="h-full"
      />
    );
  } else if (!file && loading) {
    overlay = <CodeSkeleton />;
  } else if (!file) {
    overlay = <EmptyState icon={FileCode} title="No file open" className="h-full" />;
  } else if (file.binary) {
    overlay = (
      <EmptyState
        icon={FileX}
        title="Binary file"
        description={formatBytes(file.size)}
        action={
          <Button icon={SquareArrowOutUpRight} onClick={() => onOpenInEditor()}>
            Open in editor
          </Button>
        }
        className="h-full"
      />
    );
  }

  const pill =
    showEditor && selection && !dragging ? (
      <div
        className="absolute z-10 animate-pop-in"
        style={anchor ? { top: anchor.top, left: anchor.left } : { bottom: 12, right: 16 }}
      >
        <Tooltip label="Ask about the selection" shortcut={`${mod} Enter`}>
          <Button
            size="xs"
            variant="primary"
            icon={CodeXml}
            onMouseDown={(e) => e.preventDefault()}
            onClick={ask}
            className="shadow-pop"
          >
            Ask about {linesLabel(selection.startLine, selection.endLine)}
          </Button>
        </Tooltip>
      </div>
    ) : null;

  return (
    <section
      aria-label="Code viewer"
      className={cn('@container flex h-full min-h-0 flex-col bg-surface', className)}
    >
      {header}
      <div ref={area} className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={host} className={cn('absolute inset-0 font-mono', !showEditor && 'hidden')} />
        {overlay}
        {pill}
      </div>
    </section>
  );
}
