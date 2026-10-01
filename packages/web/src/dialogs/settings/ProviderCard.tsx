import { useState } from 'react';
import {
  ChevronRight,
  CircleCheck,
  CircleX,
  FlaskConical,
  Play,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import {
  formatDuration,
  PROVIDER_RUN_OPTIONS,
  type ProviderInfo,
  type ProviderSettings,
  type ProviderTestResponse,
  type Settings,
} from '@codesplainer/shared';
import { errorMessage } from '../../lib/api';
import { joinArgs, splitArgs } from '../../lib/args';
import { cn } from '../../lib/cn';
import { refreshProviders, testProvider, updateSettings } from '../../store';
import { Badge, Button, Select, Switch } from '../../ui';
import { DraftInput, SettingRow } from './fields';

const CUSTOM = '__custom__';

interface TestState {
  running: boolean;
  result?: ProviderTestResponse;
  error?: string;
}

export function ProviderCard({
  info,
  settings,
  isDefault,
}: {
  info: ProviderInfo;
  settings: Settings;
  isDefault: boolean;
}) {
  const id = info.id;
  const ps = settings.providers[id];
  const [test, setTest] = useState<TestState>({ running: false });
  const [redetecting, setRedetecting] = useState(false);
  const [showOutput, setShowOutput] = useState(false);
  const patch = (p: Partial<ProviderSettings>) => updateSettings({ providers: { [id]: p } });
  const ready = info.available && info.enabled;
  const { efforts, fast } = PROVIDER_RUN_OPTIONS[id];

  const runTest = async () => {
    setTest({ running: true });
    setShowOutput(false);
    try {
      const result = await testProvider(id);
      setTest({ running: false, result });
    } catch (err) {
      setTest({ running: false, error: errorMessage(err) });
    }
  };

  const redetect = async () => {
    setRedetecting(true);
    await refreshProviders();
    setRedetecting(false);
  };

  return (
    <section
      aria-label={info.name}
      className={cn('rounded-xl border border-border bg-surface', !ready && 'bg-surface-2/40')}
    >
      <header className="flex items-start gap-3 px-4 pt-3.5 pb-2">
        <span
          aria-hidden
          className={cn(
            'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
            info.available ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger',
          )}
        >
          {info.available ? <CircleCheck size={14} /> : <CircleX size={14} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[13px] font-semibold text-fg">{info.name}</h3>
            {info.version ? (
              <span className="font-mono text-[11px] text-subtle">{info.version}</span>
            ) : null}
            {isDefault ? <Badge tone="accent">Default</Badge> : null}
            {info.experimental ? (
              <Badge tone="warn" icon={FlaskConical}>
                Experimental
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted">
            {info.available ? info.description : (info.reason ?? 'Not found on this machine.')}
          </p>
          {info.command ? (
            <p className="mt-0.5 truncate font-mono text-[11px] text-subtle" title={info.command}>
              {info.command}
            </p>
          ) : null}
        </div>
        <Switch
          checked={ps.enabled}
          onChange={(enabled) => patch({ enabled })}
          label={<span className="sr-only">Enable {info.name}</span>}
        />
      </header>

      {info.warnings.length ? (
        <ul className="mx-4 mb-2 flex flex-col gap-1 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
          {info.warnings.map((w) => (
            <li key={w} className="flex gap-1.5">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {id !== 'mock' ? (
        <div className="px-4">
          {id === 'acp' ? (
            <AcpFields settings={settings} />
          ) : (
            <SettingRow label="Command" hint="Leave empty to auto-detect.">
              <DraftInput
                aria-label={`${info.name} command`}
                value={ps.command}
                onCommit={(command) => patch({ command: command.trim() })}
                placeholder={info.command ?? 'auto'}
                containerClassName="w-60"
                className="font-mono"
                spellCheck={false}
              />
            </SettingRow>
          )}
          <SettingRow label="Model">
            <ModelPicker info={info} value={ps.model} onChange={(model) => patch({ model })} />
          </SettingRow>
          {efforts.length ? (
            <SettingRow label="Effort" hint="Reasoning effort. The ask bar can override it.">
              <Select
                aria-label={`${info.name} effort`}
                value={ps.effort}
                onChange={(e) => patch({ effort: e.target.value })}
                options={[
                  { value: '', label: 'Default' },
                  ...efforts.map((e) => ({ value: e, label: e })),
                ]}
                className="w-40"
              />
            </SettingRow>
          ) : null}
          {fast ? (
            <SettingRow
              label="Fast mode"
              hint={
                id === 'claude'
                  ? 'Faster answers at a higher price; needs usage credits on your account.'
                  : 'Faster answers at a higher price.'
              }
            >
              <Switch
                checked={ps.fast}
                onChange={(on) => patch({ fast: on })}
                label={<span className="sr-only">Fast mode</span>}
              />
            </SettingRow>
          ) : null}
          {info.capabilities.fork ? (
            <SettingRow
              label="Reuse sessions"
              hint="Follow-ups continue the agent session (faster, more context)."
            >
              <Switch
                checked={ps.reuseSessions}
                onChange={(reuseSessions) => patch({ reuseSessions })}
                label={<span className="sr-only">Reuse sessions</span>}
              />
            </SettingRow>
          ) : null}
          {info.capabilities.structuredOutput ? (
            <SettingRow
              label="Structured output"
              hint="Let the CLI enforce the diagram JSON schema."
            >
              <Switch
                checked={ps.structuredOutput}
                onChange={(structuredOutput) => patch({ structuredOutput })}
                label={<span className="sr-only">Structured output</span>}
              />
            </SettingRow>
          ) : null}
          {id === 'codex' ? (
            <div className="border-b border-border py-3">
              <Switch
                checked={ps.unsafeNoSandbox}
                onChange={(unsafeNoSandbox) => patch({ unsafeNoSandbox })}
                label="Run without sandbox"
                description="Only for Linux hosts where the Codex sandbox cannot start."
              />
              <p
                role={ps.unsafeNoSandbox ? 'alert' : undefined}
                className={cn(
                  'mt-2 flex gap-2 rounded-lg px-3 py-2 text-xs text-danger',
                  ps.unsafeNoSandbox
                    ? 'border border-danger/40 bg-danger-soft font-medium'
                    : 'bg-danger-soft/50',
                )}
              >
                <ShieldAlert size={14} className="mt-px shrink-0" aria-hidden />
                <span>
                  {ps.unsafeNoSandbox ? 'On: ' : ''}Codex then runs with full access to your
                  machine. It is told to stay read-only, but nothing enforces it.
                </span>
              </p>
            </div>
          ) : null}
          <SettingRow label="Extra arguments" hint="Appended to the command line.">
            <DraftInput
              aria-label={`${info.name} extra arguments`}
              value={joinArgs(ps.extraArgs)}
              onCommit={(value) => patch({ extraArgs: splitArgs(value) })}
              placeholder="none"
              containerClassName="w-60"
              className="font-mono"
              spellCheck={false}
            />
          </SettingRow>
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Button
          size="xs"
          icon={Play}
          loading={test.running}
          disabled={!info.available || !ps.enabled}
          onClick={() => void runTest()}
        >
          Test
        </Button>
        <Button
          size="xs"
          variant="ghost"
          icon={RefreshCw}
          loading={redetecting}
          onClick={() => void redetect()}
        >
          Re-detect
        </Button>
        <TestResult
          test={test}
          showOutput={showOutput}
          onToggleOutput={() => setShowOutput((v) => !v)}
        />
      </footer>
    </section>
  );
}

function TestResult({
  test,
  showOutput,
  onToggleOutput,
}: {
  test: TestState;
  showOutput: boolean;
  onToggleOutput: () => void;
}) {
  if (test.running) return <span className="text-xs text-muted">Running a tiny prompt…</span>;
  if (test.error) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-danger">
        <CircleX size={13} className="shrink-0" aria-hidden />
        <span className="truncate" title={test.error}>
          {test.error}
        </span>
      </span>
    );
  }
  const result = test.result;
  if (!result) return null;
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5 sm:w-auto sm:flex-1">
      <span
        className={cn(
          'flex min-w-0 items-center gap-1.5 text-xs',
          result.ok ? 'text-ok' : 'text-danger',
        )}
      >
        {result.ok ? (
          <CircleCheck size={13} className="shrink-0" />
        ) : (
          <CircleX size={13} className="shrink-0" />
        )}
        <span className="truncate" title={result.message}>
          {result.message}
        </span>
        <span className="shrink-0 text-subtle">· {formatDuration(result.durationMs)}</span>
        {result.output ? (
          <button
            type="button"
            onClick={onToggleOutput}
            aria-expanded={showOutput}
            className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-muted hover:text-fg"
          >
            <ChevronRight
              size={12}
              className={cn('transition-transform', showOutput && 'rotate-90')}
            />
            Output
          </button>
        ) : null}
      </span>
      {showOutput && result.output ? (
        <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap text-fg">
          {result.output}
        </pre>
      ) : null}
    </div>
  );
}

function ModelPicker({
  info,
  value,
  onChange,
}: {
  info: ProviderInfo;
  value: string;
  onChange: (model: string) => void;
}) {
  const known = value === '' || info.models.some((m) => m.id === value);
  const [custom, setCustom] = useState(!known);
  const defaultLabel = info.defaultModel ? `Default (${info.defaultModel})` : 'Default';

  if (!info.models.length) {
    return (
      <DraftInput
        aria-label={`${info.name} model`}
        value={value}
        onCommit={(model) => onChange(model.trim())}
        placeholder={defaultLabel}
        containerClassName="w-60"
        className="font-mono"
        spellCheck={false}
      />
    );
  }
  return (
    <div className="flex flex-col items-end gap-1.5">
      <Select
        aria-label={`${info.name} model`}
        value={custom ? CUSTOM : value}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(e.target.value);
        }}
        options={[
          { value: '', label: defaultLabel },
          ...info.models.map((m) => ({ value: m.id, label: m.label })),
          { value: CUSTOM, label: 'Custom…' },
        ]}
        className="w-60"
      />
      {custom ? (
        <DraftInput
          aria-label={`${info.name} custom model id`}
          value={known ? '' : value}
          onCommit={(model) => onChange(model.trim())}
          placeholder="model id"
          containerClassName="w-60"
          className="font-mono"
          spellCheck={false}
          autoFocus
        />
      ) : null}
    </div>
  );
}

function AcpFields({ settings }: { settings: Settings }) {
  const acp = settings.acp;
  const patch = (p: Partial<Settings['acp']>) => updateSettings({ acp: p });
  return (
    <>
      <SettingRow label="Name">
        <DraftInput
          aria-label="ACP agent name"
          value={acp.name}
          onCommit={(name) => patch({ name: name.trim() || 'Custom ACP agent' })}
          containerClassName="w-60"
        />
      </SettingRow>
      <SettingRow label="Command" hint="Speaks the Agent Client Protocol over stdio.">
        <DraftInput
          aria-label="ACP agent command"
          value={acp.command}
          onCommit={(command) => patch({ command: command.trim() })}
          placeholder="e.g. opencode"
          containerClassName="w-60"
          className="font-mono"
          spellCheck={false}
        />
      </SettingRow>
      <SettingRow label="Arguments" hint="Space separated.">
        <DraftInput
          aria-label="ACP agent arguments"
          value={joinArgs(acp.args)}
          onCommit={(value) => patch({ args: splitArgs(value) })}
          placeholder="e.g. acp"
          containerClassName="w-60"
          className="font-mono"
          spellCheck={false}
        />
      </SettingRow>
      <SettingRow
        label="Allow shell tools"
        hint="Approve “execute” permission requests. Off = read and search only."
      >
        <Switch
          checked={acp.allowExecute}
          onChange={(allowExecute) => patch({ allowExecute })}
          label={<span className="sr-only">Allow shell tools</span>}
        />
      </SettingRow>
    </>
  );
}
