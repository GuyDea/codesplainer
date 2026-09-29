import { cn } from '../lib/cn';

/** App mark: three boxes, one expanded into the next (matches public/favicon.svg). */
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('shrink-0', className)}
    >
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <rect x="5" y="6" width="9" height="7" rx="2" className="fill-accent-fg" />
      <rect x="18" y="6" width="9" height="7" rx="2" className="fill-accent-fg" opacity="0.75" />
      <rect x="11.5" y="19" width="9" height="7" rx="2" className="fill-accent-fg" />
      <path
        d="M9.5 13v3.5h13V13M16 16.5V19"
        className="stroke-accent-fg"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
