import { useEffect, useState } from 'react';
import { Bot, SlidersHorizontal } from 'lucide-react';
import { PROVIDER_IDS } from '@codesplainer/shared';
import {
  flushSettings,
  loadSettings,
  reportError,
  useAppStore,
  type SettingsTab,
} from '../../store';
import { Dialog, EmptyState, Spinner, Tabs } from '../../ui';
import { GeneralSettings } from './GeneralSettings';
import { ProviderCard } from './ProviderCard';

/** Settings; every change is saved right away (debounced PUT /api/settings). */
export function SettingsDialog({
  tab: initialTab,
  onClose,
}: {
  tab: SettingsTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const settings = useAppStore((s) => s.settings);
  const providers = useAppStore((s) => s.providers);
  const providersLoaded = useAppStore((s) => s.providersLoaded);

  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => {
    if (!settings)
      loadSettings().catch((err: unknown) => reportError(err, "Couldn't load settings"));
  }, [settings]);

  const close = () => {
    void flushSettings();
    onClose();
  };

  const ordered = PROVIDER_IDS.map((id) => providers.find((p) => p.id === id)).filter(
    (p): p is NonNullable<typeof p> => Boolean(p),
  );

  return (
    <Dialog open onClose={close} size="lg" title="Settings">
      <Tabs<SettingsTab>
        aria-label="Settings sections"
        value={tab}
        onChange={setTab}
        idPrefix="settings"
        className="-mx-5 mb-1 border-b border-border px-4"
        items={[
          { value: 'general', label: 'General', icon: SlidersHorizontal },
          { value: 'providers', label: 'Providers', icon: Bot },
        ]}
      />
      <div
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
        className="-mx-5 max-h-[calc(84vh-9rem)] overflow-y-auto px-5"
      >
        {!settings ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : tab === 'general' ? (
          <GeneralSettings settings={settings} providers={providers} />
        ) : !providersLoaded ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : ordered.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No providers reported"
            description="Try Re-detect from the command palette."
          />
        ) : (
          <div className="flex flex-col gap-3 py-3">
            {ordered.map((info) => (
              <ProviderCard
                key={info.id}
                info={info}
                settings={settings}
                isDefault={settings.defaultProvider === info.id}
              />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
