import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProcessTracker, runProcess, startProcess } from '../../src/agents/process';
import { removeDir, tempDir } from './helpers';

const node = process.execPath;
const isWindows = process.platform === 'win32';

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

let dir: string;
beforeAll(async () => {
  dir = await tempDir('cs-proc-');
});
afterAll(async () => {
  await removeDir(dir);
});

describe('runProcess', () => {
  it('splits stdout into lines (CRLF, partial chunks, no trailing newline) and passes stdin', async () => {
    const lines: string[] = [];
    const script =
      "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{process.stdout.write('a\\r\\nb');setTimeout(()=>{process.stdout.write('c\\n'+s.toUpperCase());},20)})";
    const res = await runProcess({
      command: node,
      args: ['-e', script],
      stdin: 'hello',
      onStdoutLine: (l) => lines.push(l),
    });
    expect(res.code).toBe(0);
    expect(lines).toEqual(['a', 'bc', 'HELLO']);
    expect(res.stdout).toBe('a\nbc\nHELLO\n');
  });

  it('keeps only the stderr tail', async () => {
    const res = await runProcess({
      command: node,
      args: ['-e', "process.stderr.write('x'.repeat(20000) + '\\nLAST LINE\\n'); process.exit(4)"],
    });
    expect(res.code).toBe(4);
    expect(res.stderrTail.length).toBeLessThanOrEqual(8 * 1024);
    expect(res.stderrTail).toContain('LAST LINE');
  });

  it('reports spawn errors', async () => {
    const res = await runProcess({ command: join(dir, 'does-not-exist'), args: [] });
    expect(res.spawnError).toBeTruthy();
    expect(res.code).toBeNull();
  });

  it('kills on timeout', async () => {
    const started = Date.now();
    const res = await runProcess({
      command: node,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      timeoutMs: 300,
    });
    expect(res.timedOut).toBe(true);
    expect(res.cancelled).toBe(false);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const script =
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('ready')";
    let ready = false;
    const proc = startProcess({
      command: node,
      args: ['-e', script],
      killGraceMs: 300,
      onStdoutLine: () => (ready = true),
    });
    await waitFor(() => ready);
    const res = await proc.kill('cancelled');
    expect(res.cancelled).toBe(true);
    expect(isWindows || res.signal === 'SIGKILL').toBe(true);
  });

  it('kills the whole process tree on abort', async () => {
    const pidFile = join(dir, 'grandchild.pid');
    const script = [
      "const { spawn } = require('child_process');",
      "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const controller = new AbortController();
    const proc = startProcess({ command: node, args: ['-e', script], signal: controller.signal });
    const gotPid = await waitFor(async () =>
      Boolean(await readFile(pidFile, 'utf8').catch(() => '')),
    );
    expect(gotPid).toBe(true);
    const grandchild = Number(await readFile(pidFile, 'utf8'));
    expect(alive(grandchild)).toBe(true);
    controller.abort();
    const res = await proc.done;
    expect(res.cancelled).toBe(true);
    expect(await waitFor(() => !alive(grandchild), 6000)).toBe(true);
  });

  it('does not start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await runProcess({ command: node, args: ['-e', ''], signal: controller.signal });
    expect(res.cancelled).toBe(true);
  });
});

describe.skipIf(isWindows)('process group leftovers', () => {
  it('killAll() SIGKILLs group members that outlive their leader', async () => {
    const pidFile = join(dir, 'stubborn.pid');
    const script = [
      "const { spawn } = require('child_process');",
      "const g = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' });",
      `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`,
      'setInterval(() => {}, 1000);',
    ].join('\n');
    const tracker = new ProcessTracker();
    const proc = startProcess({
      command: node,
      args: ['-e', script],
      tracker,
      killGraceMs: 60_000,
    });
    expect(
      await waitFor(async () => Boolean(await readFile(pidFile, 'utf8').catch(() => ''))),
    ).toBe(true);
    const stubborn = Number(await readFile(pidFile, 'utf8'));
    await new Promise((r) => setTimeout(r, 200)); // let the grandchild install its SIGTERM handler
    await tracker.killAll();
    expect((await proc.done).cancelled).toBe(true);
    // Well before the 60 s grace period: dispose does not leave the group behind.
    expect(await waitFor(() => !alive(stubborn), 2000)).toBe(true);
  });
});

describe('ProcessTracker', () => {
  it('tracks live processes and kills them all', async () => {
    const tracker = new ProcessTracker();
    const a = startProcess({ command: node, args: ['-e', 'setInterval(() => {}, 1000)'], tracker });
    const b = startProcess({ command: node, args: ['-e', 'setInterval(() => {}, 1000)'], tracker });
    expect(tracker.size).toBe(2);
    await tracker.killAll();
    expect((await a.done).cancelled).toBe(true);
    expect((await b.done).cancelled).toBe(true);
    expect(tracker.size).toBe(0);
    // Closed trackers refuse new processes.
    const c = await runProcess({ command: node, args: ['-e', ''], tracker });
    expect(c.cancelled).toBe(true);
  });
});
