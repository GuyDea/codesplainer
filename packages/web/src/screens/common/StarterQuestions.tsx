import { Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';

export const STARTER_QUESTIONS = [
  'What is the high-level architecture?',
  'How does a request flow end to end?',
  'What are the core data models?',
  'How is it built, tested and run?',
  'Where are the entry points?',
  'Which external services does it use?',
];

/** One-click starter questions. */
export function StarterQuestions({
  onPick,
  disabled,
  className,
}: {
  onPick: (question: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ul
      aria-label="Starter questions"
      className={cn('flex flex-wrap justify-center gap-1.5', className)}
    >
      {STARTER_QUESTIONS.map((q) => (
        <li key={q}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(q)}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-xs text-muted shadow-card transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50"
          >
            <Sparkles size={12} className="text-accent" aria-hidden />
            {q}
          </button>
        </li>
      ))}
    </ul>
  );
}
