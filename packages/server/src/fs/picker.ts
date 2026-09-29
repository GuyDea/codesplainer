/**
 * Native "choose folder" dialogs (POST /api/fs/pick-folder):
 * - Linux: zenity (multiple) or kdialog, only with a graphical session (DISPLAY / WAYLAND_DISPLAY)
 * - macOS: osascript `choose folder ... with multiple selections allowed`
 * - Windows: PowerShell FolderBrowserDialog
 * Cancelled or unsupported -> [] (the web UI falls back to its own folder browser).
 */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { findOnPath } from '../agents/detect';
import { conflict } from '../errors';

/** The user may take their time choosing; the dialog is killed after this. */
const PICKER_TIMEOUT_MS = 10 * 60 * 1000;

type Picker = { command: string; args: string[]; parse: (stdout: string) => string[] };

const lines = (stdout: string) =>
  stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

const TITLE = 'Choose folders for Codesplainer';

const MAC_SCRIPT = [
  `set chosen to choose folder with prompt "${TITLE}" with multiple selections allowed`,
  'set out to ""',
  'repeat with f in chosen',
  'set out to out & POSIX path of f & linefeed',
  'end repeat',
  'return out',
];

const WINDOWS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  `$d.Description = '${TITLE}'`,
  '$d.ShowNewFolderButton = $false',
  'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }',
].join('; ');

async function detectPicker(env: NodeJS.ProcessEnv = process.env): Promise<Picker | undefined> {
  switch (process.platform) {
    case 'darwin': {
      const osascript = (await findOnPath('osascript', env)) ?? '/usr/bin/osascript';
      return {
        command: osascript,
        args: MAC_SCRIPT.flatMap((line) => ['-e', line]),
        parse: lines,
      };
    }
    case 'win32': {
      const ps = (await findOnPath('powershell', env)) ?? (await findOnPath('pwsh', env));
      if (!ps) return undefined;
      return {
        command: ps,
        args: ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS_SCRIPT],
        parse: lines,
      };
    }
    default: {
      if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return undefined;
      const zenity = await findOnPath('zenity', env);
      if (zenity) {
        return {
          command: zenity,
          args: [
            '--file-selection',
            '--directory',
            '--multiple',
            '--separator=\n',
            `--title=${TITLE}`,
          ],
          parse: lines,
        };
      }
      const kdialog = await findOnPath('kdialog', env);
      if (kdialog) {
        return {
          command: kdialog,
          args: ['--getexistingdirectory', homedir(), '--title', TITLE],
          parse: lines,
        };
      }
      return undefined;
    }
  }
}

let cached: Promise<Picker | undefined> | undefined;

function picker(): Promise<Picker | undefined> {
  cached ??= detectPicker().catch(() => undefined);
  return cached;
}

/** Whether a native folder dialog can be shown (detected once). */
export async function nativePickerAvailable(): Promise<boolean> {
  return (await picker()) !== undefined;
}

let open = false;

/** Show the native dialog; resolves with the chosen absolute paths ([] when cancelled). */
export async function pickFolders(): Promise<string[]> {
  const p = await picker();
  if (!p) return [];
  if (open) throw conflict('A folder dialog is already open.');
  open = true;
  try {
    return await new Promise<string[]>((resolve) => {
      execFile(
        p.command,
        p.args,
        { timeout: PICKER_TIMEOUT_MS, windowsHide: false, maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          // Exit code 1 = cancelled (zenity, kdialog, osascript "User canceled").
          if (error) return resolve([]);
          resolve(p.parse(String(stdout)));
        },
      );
    });
  } finally {
    open = false;
  }
}
