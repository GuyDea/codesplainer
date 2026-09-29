import { Monitor, Moon, Sun } from 'lucide-react';
import {
  DETAIL_LEVEL_INFO,
  DETAIL_LEVELS,
  formatDuration,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  type DetailLevel,
  type ProviderId,
  type ProviderInfo,
  type Settings,
  type Theme,
} from '@codesplainer/shared';
import { setTheme, updateSettings } from '../../store';
import { Segmented, Select, Switch } from '../../ui';
import { DraftInput, NumberInput, SettingRow } from './fields';

export function GeneralSettings({
  settings,
  providers,
}: {
  settings: Settings;
  providers: ProviderInfo[];
}) {
  const providerOptions = PROVIDER_IDS.map((id) => {
    const info = providers.find((p) => p.id === id);
    const status = !info
      ? ''
      : !info.available
        ? ' — not found'
        : !info.enabled
          ? ' — disabled'
          : '';
    return { value: id, label: `${info?.name ?? PROVIDER_LABELS[id]}${status}` };
  });

  return (
    <div className="flex flex-col">
      <SettingRow
        label="Default provider"
        hint="Used for new questions unless you pick another."
        htmlFor="set-provider"
      >
        <Select
          id="set-provider"
          value={settings.defaultProvider}
          onChange={(e) => updateSettings({ defaultProvider: e.target.value as ProviderId })}
          options={providerOptions}
          className="w-56"
        />
      </SettingRow>
      <SettingRow label="Detail" hint="How many boxes a diagram aims for.">
        <Segmented<DetailLevel>
          aria-label="Detail level"
          value={settings.detail}
          onChange={(detail) => updateSettings({ detail })}
          options={DETAIL_LEVELS.map((level) => ({
            value: level,
            label: DETAIL_LEVEL_INFO[level].label,
            title: `${DETAIL_LEVEL_INFO[level].min}–${DETAIL_LEVEL_INFO[level].max} boxes`,
          }))}
        />
      </SettingRow>
      <SettingRow
        label="Parallel jobs"
        hint="Diagrams generated at the same time (1–8)."
        htmlFor="set-jobs"
      >
        <NumberInput
          id="set-jobs"
          value={settings.maxConcurrentJobs}
          min={1}
          max={8}
          onCommit={(maxConcurrentJobs) => updateSettings({ maxConcurrentJobs })}
        />
      </SettingRow>
      <SettingRow
        label="Timeout"
        hint={`Give up on a diagram after ${formatDuration(settings.timeoutSec * 1000)}.`}
        htmlFor="set-timeout"
      >
        <NumberInput
          id="set-timeout"
          value={settings.timeoutSec}
          min={30}
          max={7200}
          suffix="s"
          onCommit={(timeoutSec) => updateSettings({ timeoutSec })}
        />
      </SettingRow>
      <SettingRow label="Theme">
        <Segmented<Theme>
          aria-label="Theme"
          value={settings.theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'System', icon: Monitor },
            { value: 'light', label: 'Light', icon: Sun },
            { value: 'dark', label: 'Dark', icon: Moon },
          ]}
        />
      </SettingRow>
      <SettingRow
        label="Answer language"
        hint="Language of labels and summaries."
        htmlFor="set-lang"
      >
        <DraftInput
          id="set-lang"
          value={settings.answerLanguage}
          onCommit={(answerLanguage) => updateSettings({ answerLanguage: answerLanguage.trim() })}
          placeholder="Same as the question"
          containerClassName="w-56"
        />
      </SettingRow>
      <SettingRow label="Editor command" hint="Used by “Open in editor”." htmlFor="set-editor">
        <DraftInput
          id="set-editor"
          value={settings.editorCommand}
          onCommit={(editorCommand) => updateSettings({ editorCommand: editorCommand.trim() })}
          placeholder="Auto (code, cursor, idea…)"
          containerClassName="w-56"
          className="font-mono"
          spellCheck={false}
        />
      </SettingRow>
      <SettingRow
        label="Open expansions when ready"
        hint="Jump to a finished expansion of the diagram you are on."
      >
        <Switch
          checked={settings.autoOpenExpansions}
          onChange={(autoOpenExpansions) => updateSettings({ autoOpenExpansions })}
          label={<span className="sr-only">Open expansions when ready</span>}
        />
      </SettingRow>
    </div>
  );
}
