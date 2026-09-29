import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '../ui';

interface Props {
  children: ReactNode;
  /** Changing the key resets the boundary (e.g. the route or diagram id). */
  resetKey?: string;
  /** Compact fallback for a pane instead of the whole screen. */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

/** Keeps a crash in one pane (e.g. a diagram that fails to render) from blanking the app. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Codesplainer UI error', error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        className={
          this.props.compact
            ? 'flex h-full flex-col items-center justify-center gap-2 p-6 text-center'
            : 'flex h-full flex-col items-center justify-center gap-3 p-8 text-center'
        }
      >
        <TriangleAlert size={this.props.compact ? 18 : 24} className="text-warn" aria-hidden />
        <div className="text-sm font-semibold text-fg">Something broke here</div>
        <div className="max-w-md font-mono text-[11px] break-words text-subtle">
          {error.message}
        </div>
        <Button size="sm" icon={RotateCcw} onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
