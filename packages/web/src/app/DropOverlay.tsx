import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileUp } from 'lucide-react';
import { openDialog, toast, useAppStore } from '../store';

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function isJsonFile(file: File): boolean {
  return /\.json$/i.test(file.name) || file.type === 'application/json';
}

/** Drop a Codesplainer .json export anywhere to import it. */
export function DropOverlay() {
  const [active, setActive] = useState(false);
  const online = useAppStore((s) => s.connection === 'online');

  useEffect(() => {
    if (!online) return;
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    // Capture phase: always hide the overlay, even when a drop zone below handles the drop.
    const onDropCapture = () => {
      depth = 0;
      setActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) {
        if (hasFiles(e)) e.preventDefault();
        return;
      }
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!isJsonFile(file)) {
        toast({
          tone: 'error',
          title: 'Not an export',
          description: 'Drop a Codesplainer .json file.',
        });
        return;
      }
      openDialog({ type: 'import', file });
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDropCapture, true);
    window.addEventListener('dragend', onDropCapture, true);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDropCapture, true);
      window.removeEventListener('dragend', onDropCapture, true);
      window.removeEventListener('drop', onDrop);
    };
  }, [online]);

  if (!active) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[960] flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm animate-fade-in">
      <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-surface px-12 py-10 text-center shadow-pop">
        <FileUp size={28} className="text-accent" aria-hidden />
        <div className="text-sm font-semibold text-fg">Drop to import</div>
        <div className="text-xs text-muted">.codesplainer.json</div>
      </div>
    </div>,
    document.body,
  );
}
