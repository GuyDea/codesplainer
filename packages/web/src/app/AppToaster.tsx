import { dismissToast, useAppStore } from '../store';
import { Toaster } from '../ui';

export function AppToaster() {
  const toasts = useAppStore((s) => s.toasts);
  return <Toaster toasts={toasts} onDismiss={dismissToast} />;
}
