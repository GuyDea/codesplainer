/** Command-line argument helpers for settings fields ("space-separated -> array"). */

/** Split on whitespace, honoring "double" and 'single' quotes and backslash escapes. */
export function splitArgs(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] as string;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < input.length) current += input[++i];
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (ch === '\\' && i + 1 < input.length) {
      current += input[++i];
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken) out.push(current);
      current = '';
      hasToken = false;
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (hasToken) out.push(current);
  return out;
}

/** Inverse of splitArgs: quote arguments that contain whitespace or quotes. */
export function joinArgs(args: readonly string[]): string {
  return args
    .map((arg) => {
      if (arg === '') return '""';
      if (!/[\s"'\\]/.test(arg)) return arg;
      return `"${arg.replace(/(["\\])/g, '\\$1')}"`;
    })
    .join(' ');
}
