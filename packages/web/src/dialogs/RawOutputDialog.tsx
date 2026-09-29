import { useEffect, useState } from 'react';
import { Copy, FileQuestion } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { toast } from '../store';
import { Button, Dialog, EmptyState, Spinner } from '../ui';

interface Props {
  conversationId: string;
  graphId: string;
  title: string;
  onClose: () => void;
}

/** The last raw agent answer of a diagram (kept for failed / repaired runs). */
export function RawOutputDialog({ conversationId, graphId, title, onClose }: Props) {
  const [state, setState] = useState<{
    loading: boolean;
    text: string | null;
    error: string | null;
  }>({
    loading: true,
    text: null,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    api
      .getRawOutput(conversationId, graphId)
      .then((res) => alive && setState({ loading: false, text: res.text ?? null, error: null }))
      .catch(
        (err: unknown) =>
          alive && setState({ loading: false, text: null, error: errorMessage(err) }),
      );
    return () => {
      alive = false;
    };
  }, [conversationId, graphId]);

  const copy = async () => {
    if (!state.text) return;
    const ok = await copyText(state.text);
    toast({
      id: 'copied',
      tone: ok ? 'success' : 'error',
      title: ok ? 'Copied' : "Couldn't copy",
      duration: 2000,
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      title="Raw agent output"
      description={title}
      footer={
        <>
          <Button icon={Copy} disabled={!state.text} onClick={() => void copy()}>
            Copy
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {state.loading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      ) : state.error ? (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{state.error}</p>
      ) : state.text ? (
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-fg">
          {state.text}
        </pre>
      ) : (
        <EmptyState
          icon={FileQuestion}
          title="No raw output saved"
          description="Raw answers are only kept for failed or repaired runs."
        />
      )}
    </Dialog>
  );
}
