import { useState } from 'react';
import type { ConfirmRequest, PromptRequest } from '../store';
import { useAppStore } from '../store';
import { Button, Dialog, Input } from '../ui';

/** Renders the promise-based confirmation / prompt requested through the store. */
export function ModalHost() {
  const modal = useAppStore((s) => s.modal);
  if (!modal) return null;
  return modal.kind === 'confirm' ? (
    <ConfirmDialog key={modal.id} request={modal} />
  ) : (
    <PromptDialog key={modal.id} request={modal} />
  );
}

function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  return (
    <Dialog
      open
      size="sm"
      onClose={() => request.resolve(false)}
      title={request.title}
      description={request.message}
      initialFocus="[data-autofocus]"
      footer={
        <>
          <Button variant="ghost" onClick={() => request.resolve(false)}>
            Cancel
          </Button>
          <Button
            data-autofocus
            variant={request.danger ? 'danger' : 'primary'}
            onClick={() => request.resolve(true)}
          >
            {request.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    />
  );
}

function PromptDialog({ request }: { request: PromptRequest }) {
  const [value, setValue] = useState(request.initialValue ?? '');
  const clean = value.trim();
  const submit = () => {
    if (clean) request.resolve(clean);
  };
  return (
    <Dialog
      open
      size="sm"
      onClose={() => request.resolve(null)}
      title={request.title}
      footer={
        <>
          <Button variant="ghost" onClick={() => request.resolve(null)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!clean} onClick={submit}>
            {request.submitLabel ?? 'Save'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1">
          {request.label ? (
            <span className="text-xs font-medium text-muted">{request.label}</span>
          ) : null}
          <Input
            aria-label={request.label ?? request.title}
            value={value}
            placeholder={request.placeholder}
            maxLength={request.maxLength}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      </form>
    </Dialog>
  );
}
