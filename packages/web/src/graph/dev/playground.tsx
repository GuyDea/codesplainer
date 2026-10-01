/**
 * Dev playground for the graph module (not part of the app build). Open /playground.html on the
 * Vite dev server. URL params: ?sample=architecture|flow|sequence|big|state|map&theme=dark
 * `vite build --mode pages` turns it into the public demo on GitHub Pages: the developer controls
 * are hidden and the header links back to the download page.
 */
import '../../styles.css';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, Map as MapIcon, Moon, Sun } from 'lucide-react';
import type { CodeRef, GraphDirection, GraphSpec } from '@codesplainer/shared';
import { Button, IconButton } from '../../ui';
import {
  ConversationMap,
  GraphCanvas,
  Legend,
  type ConversationMapHandle,
  type GraphCanvasHandle,
  type NodeChildInfo,
} from '../index';
import { refTitle } from '../refs';
import {
  architectureSpec,
  bigSpec,
  flowSpec,
  sampleConversation,
  sequenceSpec,
  stateSpec,
} from './samples';

const SAMPLES: Record<string, { label: string; spec?: GraphSpec }> = {
  architecture: { label: 'Architecture', spec: architectureSpec },
  flow: { label: 'Flow', spec: flowSpec },
  sequence: { label: 'Sequence', spec: sequenceSpec },
  big: { label: '20 boxes', spec: bigSpec },
  state: { label: 'States', spec: stateSpec },
  map: { label: 'Map' },
};

const CHILDREN: Record<string, Record<string, NodeChildInfo[]>> = {
  architecture: {
    runner: [
      { graphId: 'g2', type: 'expand', status: 'done', title: 'Inside the agent runner' },
      {
        graphId: 'g8',
        type: 'ask-code',
        status: 'error',
        title: 'Why is the output parsed twice?',
      },
      { graphId: 'gx', type: 'ask-node', status: 'running', title: 'How are retries scheduled?' },
    ],
    store: [
      { graphId: 'g3', type: 'expand', status: 'done', title: 'Conversation store internals' },
    ],
    api: [
      { graphId: 'g4', type: 'ask-node', status: 'done', title: 'Asking a question, step by step' },
    ],
  },
  flow: {
    normalize: [
      { graphId: 'g5', type: 'expand', status: 'running', title: 'Expand: normalizeGraphSpec()' },
    ],
  },
};

/** Built as the public demo (see the file comment). */
const DEMO = import.meta.env.MODE === 'pages';
if (DEMO) document.title = 'Codesplainer demo: sample diagrams';

function param(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}

function setParam(name: string, value: string | null) {
  const url = new URL(location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  history.replaceState(null, '', url);
}

function Playground() {
  const [sample, setSample] = useState(() =>
    param('sample') && SAMPLES[param('sample') as string]
      ? (param('sample') as string)
      : 'architecture',
  );
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [direction, setDirection] = useState<GraphDirection | 'auto'>(
    () => (param('dir') as GraphDirection) ?? 'auto',
  );
  const [minimap, setMinimap] = useState(() => param('minimap') === '1');
  const [legend, setLegend] = useState(() => param('legend') !== '0');
  const [multiFolder, setMultiFolder] = useState(() => param('multi') === '1');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [current, setCurrent] = useState<string>('g2');
  const [query, setQuery] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [image, setImage] = useState<string | null>(null);
  const canvas = useRef<GraphCanvasHandle>(null);
  const map = useRef<ConversationMapHandle>(null);
  useEffect(() => {
    // Handles for scripted checks (Playwright): window.__cs.canvas.current.focusNode('api')
    (window as unknown as { __cs?: unknown }).__cs = { canvas, map };
  }, []);

  const push = useCallback((line: string) => setLog((l) => [line, ...l].slice(0, 6)), []);
  const spec = SAMPLES[sample]?.spec;
  const children = useMemo(() => CHILDREN[sample] ?? {}, [sample]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('codesplainer.playground.theme', next ? 'dark' : 'light');
    setParam('theme', next ? 'dark' : 'light');
  };

  const exportImage = async (format: 'png' | 'svg') => {
    const url =
      sample === 'map' ? await map.current?.toImage(format) : await canvas.current?.toImage(format);
    if (url) {
      setImage(url);
      push(`exported ${format} (${Math.round(url.length / 1024)} kB)`);
    }
  };

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
        <span className="mr-2 text-sm font-semibold whitespace-nowrap">
          {DEMO ? 'Codesplainer demo' : 'Graph playground'}
        </span>
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5" role="tablist">
          {Object.entries(SAMPLES).map(([id, s]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={sample === id}
              className={
                sample === id
                  ? 'h-7 rounded-md bg-surface px-2.5 text-[13px] font-medium whitespace-nowrap text-fg shadow-card'
                  : 'h-7 rounded-md px-2.5 text-[13px] whitespace-nowrap text-muted hover:text-fg'
              }
              onClick={() => {
                setSample(id);
                setSelectedNode(null);
                setSelectedEdge(null);
                setParam('sample', id);
              }}
            >
              {id === 'map' ? <MapIcon size={13} className="mr-1 inline" /> : null}
              {s.label}
            </button>
          ))}
        </div>
        <div className={DEMO ? 'hidden' : 'ml-2 flex items-center gap-1 text-[12px] text-muted'}>
          <select
            className="h-7 rounded-md border border-border bg-surface px-1.5 text-[12px]"
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value as GraphDirection | 'auto');
              setParam('dir', e.target.value === 'auto' ? null : e.target.value);
            }}
            aria-label="Direction"
          >
            <option value="auto">auto</option>
            <option value="LR">LR</option>
            <option value="TB">TB</option>
          </select>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={minimap}
              onChange={(e) => setMinimap(e.target.checked)}
            />{' '}
            minimap
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={legend} onChange={(e) => setLegend(e.target.checked)} />{' '}
            legend
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={multiFolder}
              onChange={(e) => setMultiFolder(e.target.checked)}
            />{' '}
            multi-folder
          </label>
          {sample === 'map' ? (
            <input
              className="h-7 w-40 rounded-md border border-border bg-surface px-2 text-[12px]"
              placeholder="Highlight…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : null}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {DEMO ? (
            <a
              href="../#download"
              target="_top"
              className="mr-1 text-[13px] font-medium whitespace-nowrap text-accent hover:underline"
            >
              Get Codesplainer
            </a>
          ) : (
            <>
              <span className="max-w-[360px] truncate text-[12px] text-subtle" data-testid="log">
                {log[0] ?? ''}
              </span>
              <Button size="sm" icon={Download} onClick={() => void exportImage('png')}>
                PNG
              </Button>
              <Button size="sm" onClick={() => void exportImage('svg')}>
                SVG
              </Button>
            </>
          )}
          <IconButton icon={dark ? Sun : Moon} label="Toggle theme" onClick={toggleTheme} />
        </div>
      </header>
      <main className="relative min-h-0 flex-1">
        {spec ? (
          <>
            <GraphCanvas
              ref={canvas}
              graphId={sample}
              spec={spec}
              direction={direction === 'auto' ? undefined : direction}
              selectedNodeId={selectedNode}
              selectedEdgeId={selectedEdge}
              onSelectNode={(id) => {
                setSelectedNode(id);
                push(`select node ${id}`);
              }}
              onSelectEdge={(id) => {
                setSelectedEdge(id);
                push(`select edge ${id}`);
              }}
              // The demo has no agent and no code to show: leave out actions that would do nothing.
              {...(DEMO
                ? {}
                : {
                    onExpandNode: (id: string) => push(`expand ${id}`),
                    onAskNode: (id: string) => push(`ask ${id}`),
                    onOpenRef: (ref: CodeRef) => push(`open ${refTitle(ref)}`),
                    onOpenChild: (id: string) => push(`open child ${id}`),
                  })}
              nodeChildren={children}
              showMinimap={minimap}
              multiFolder={multiFolder}
            />
            {legend ? <Legend spec={spec} className="absolute top-3 left-3" /> : null}
          </>
        ) : (
          <ConversationMap
            ref={map}
            conversation={sampleConversation}
            currentGraphId={current}
            highlightQuery={query}
            onOpenGraph={(id) => {
              setCurrent(id);
              push(`open graph ${id}`);
            }}
          />
        )}
        {image ? (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center bg-bg/80 p-8 backdrop-blur-sm"
            onClick={() => setImage(null)}
          >
            <img
              src={image}
              alt="Export preview"
              className="max-h-full max-w-full rounded-lg border border-border shadow-pop"
              data-testid="export-preview"
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Playground />
    </StrictMode>,
  );
}
