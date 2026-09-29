/** App-level lifecycle hooks: theme, connection, startup redirect, global shortcuts. */
import { useEffect } from 'react';
import { useHotkeys } from '../lib/hotkeys';
import { navigate, routes, type Route } from '../lib/router';
import {
  bootstrap,
  flushSettings,
  flushSettingsOnExit,
  focusAsk,
  getState,
  openDialog,
  reconnectEventsNow,
  setPaletteOpen,
  setResolvedTheme,
  stopEvents,
  useAppStore,
} from '../store';

/** settings.theme (+ localStorage + OS preference) -> `dark` class on <html>. */
export function useThemeSync(): void {
  const theme = useAppStore((s) => s.theme);
  useEffect(() => {
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && Boolean(media?.matches));
      document.documentElement.classList.toggle('dark', dark);
      setResolvedTheme(dark ? 'dark' : 'light');
    };
    apply();
    if (theme !== 'system' || !media) return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}

/** Health check + live events for the lifetime of the app; reconnect on focus / network. */
export function useConnectionLifecycle(): void {
  useEffect(() => {
    void bootstrap();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (getState().connection === 'offline') void bootstrap();
        else reconnectEventsNow();
      } else {
        void flushSettings();
      }
    };
    const onOnline = () => {
      if (getState().connection === 'offline') void bootstrap();
      else reconnectEventsNow();
    };
    const onPageHide = () => flushSettingsOnExit();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onPageHide);
      stopEvents();
    };
  }, []);
}

let startupHandled = false;

/** Folders passed on the command line: open that workspace on the first load of "#/". */
export function useStartupRedirect(route: Route): void {
  const health = useAppStore((s) => s.health);
  useEffect(() => {
    if (startupHandled || !health) return;
    startupHandled = true;
    if (route.name === 'home' && health.startupWorkspaceId) {
      navigate(routes.workspace(health.startupWorkspaceId), { replace: true });
    }
  }, [health, route.name]);
}

/** Unknown hashes go home. */
export function useUnknownRouteRedirect(route: Route): void {
  useEffect(() => {
    if (route.name === 'unknown') navigate(routes.home(), { replace: true });
  }, [route]);
}

function modalDialogOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]:not([data-palette])') !== null;
}

/** Shortcuts available on every screen. */
export function useGlobalHotkeys(): void {
  useHotkeys([
    {
      combo: 'mod+k',
      allowInInputs: true,
      allowInOverlays: true,
      handler: () => {
        if (getState().paletteOpen) setPaletteOpen(false);
        else if (!modalDialogOpen()) setPaletteOpen(true);
      },
    },
    { combo: '?', handler: () => openDialog({ type: 'shortcuts' }) },
    { combo: '/', handler: () => focusAsk() },
  ]);
}
