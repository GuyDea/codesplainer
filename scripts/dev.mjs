#!/usr/bin/env node
/**
 * `npm run dev`: API server (tsx watch, port 4777) + Vite UI (5173 or the next free port).
 *
 * Before starting it checks the environment (scripts/doctor.mjs) and whether the OS still has file
 * watchers to spare. When it does not (inotify limits reached: EMFILE / ENOSPC), both watchers
 * switch to polling instead of crashing with "EMFILE: too many open files, watch".
 */
import { watch } from 'node:fs';
import { tmpdir } from 'node:os';
import concurrently from 'concurrently';
import { runDoctor } from './doctor.mjs';

/** Can this process create one more native file watcher? */
function nativeWatchersAvailable() {
  try {
    watch(tmpdir()).close();
    return true;
  } catch (e) {
    if (e?.code === 'EMFILE' || e?.code === 'ENOSPC') return false;
    throw e;
  }
}

if (!runDoctor({ quiet: true })) process.exit(1);

const env = { ...process.env };
if (!env.CHOKIDAR_USEPOLLING && !nativeWatchersAvailable()) {
  env.CHOKIDAR_USEPOLLING = '1';
  env.CHOKIDAR_INTERVAL ??= '300';
  console.warn(
    [
      '! The system is out of file watchers (inotify), so file changes are polled instead.',
      '  To raise the limit permanently (Linux):',
      '    echo fs.inotify.max_user_instances=512 | sudo tee /etc/sysctl.d/60-inotify.conf && sudo sysctl --system',
    ].join('\n'),
  );
}

const { result } = concurrently(
  [
    { command: 'npm run dev -w @codesplainer/server', name: 'server', prefixColor: 'blue', env },
    { command: 'npm run dev -w @codesplainer/web', name: 'web', prefixColor: 'magenta', env },
  ],
  { killOthersOn: ['failure', 'success'], prefix: 'name' },
);

result.then(
  () => process.exit(0),
  () => process.exit(1),
);
