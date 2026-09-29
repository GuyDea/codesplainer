#!/usr/bin/env node
/**
 * Preflight checks for the dev/build/test scripts. Turns two environment problems that otherwise
 * surface as cryptic stack traces into a clear message with the fix:
 *
 * 1. Missing platform binaries. npm 11.5.0–11.6.x prunes platform-specific optional packages
 *    (@rolldown/binding-*, @esbuild/*, lightningcss-*, ...) when `npm install` runs again in a
 *    workspace (https://github.com/npm/cli/issues/8536). Vite then fails with
 *    "Cannot find native binding".
 * 2. Old npm versions with that bug (warning only).
 *
 * Usage: node scripts/doctor.mjs   (exit code 1 when something must be fixed)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Packages that ship their native code as per-platform optional dependencies. */
const NATIVE_PACKAGES = new Set(['rolldown', 'esbuild', 'lightningcss', '@tailwindcss/oxide']);

const FIX = [
  'Fix: reinstall from scratch, then avoid npm 11.5–11.6 for later installs:',
  '  rm -rf node_modules packages/*/node_modules package-lock.json && npm install',
  '  npm install -g npm@11      # newest 11.x; any npm >= 11.7 is fine',
];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Package directories directly inside a node_modules folder (scoped ones included). */
function packageDirs(nodeModules) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(nodeModules, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(nodeModules, entry.name);
    if (entry.name.startsWith('@')) {
      for (const sub of readdirSync(dir, { withFileTypes: true })) {
        if (sub.isDirectory()) out.push(join(dir, sub.name));
      }
    } else {
      out.push(dir);
    }
  }
  return out;
}

/** Every installed copy of a native package: hoisted ones and copies nested one level deep. */
function nativeInstalls() {
  const found = [];
  const roots = [
    join(ROOT, 'node_modules'),
    ...['shared', 'server', 'web'].map((p) => join(ROOT, 'packages', p, 'node_modules')),
  ];
  for (const root of roots) {
    for (const dir of packageDirs(root)) {
      const pkg = readJson(join(dir, 'package.json'));
      if (pkg && NATIVE_PACKAGES.has(pkg.name)) found.push({ dir, pkg });
      for (const nested of packageDirs(join(dir, 'node_modules'))) {
        const inner = readJson(join(nested, 'package.json'));
        if (inner && NATIVE_PACKAGES.has(inner.name)) found.push({ dir: nested, pkg: inner });
      }
    }
  }
  return found;
}

/** True when `name` can be resolved from `fromDir` (the way Node would load it). */
function isInstalled(name, fromDir) {
  const require = createRequire(join(fromDir, 'package.json'));
  try {
    require.resolve(`${name}/package.json`);
    return true;
  } catch (e) {
    // The package exists but does not export package.json.
    return e?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED';
  }
}

/** Missing platform binaries, e.g. ["@rolldown/binding-linux-x64-gnu (for rolldown 1.2.11)"]. */
export function missingNativeBinaries() {
  const platform = `${process.platform}-${process.arch}`;
  const missing = [];
  for (const { dir, pkg } of nativeInstalls()) {
    const candidates = Object.keys(pkg.optionalDependencies ?? {}).filter((n) =>
      n.includes(platform),
    );
    if (!candidates.length) continue; // this package has no binary for this platform at all
    if (candidates.some((name) => isInstalled(name, dir))) continue;
    missing.push(`${candidates.join(' / ')} (for ${pkg.name} ${pkg.version})`);
  }
  return [...new Set(missing)];
}

/** npm 11.5.0–11.6.x has the pruning bug. Returns a warning or undefined. */
export function npmVersionWarning(userAgent = process.env.npm_config_user_agent ?? '') {
  const match = /\bnpm\/(\d+)\.(\d+)\.(\d+)/.exec(userAgent);
  if (!match) return undefined;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  if (major === 11 && (minor === 5 || minor === 6)) {
    return `npm ${match[1]}.${match[2]}.${match[3]} can drop platform binaries when "npm install" runs again (npm/cli#8536). Upgrade with: npm install -g npm@11`;
  }
  return undefined;
}

/** Run all checks; prints problems. Returns false when the environment must be fixed. */
export function runDoctor({ quiet = false } = {}) {
  if (!existsSync(join(ROOT, 'node_modules'))) {
    console.error('✗ Dependencies are not installed. Run: npm install');
    return false;
  }
  const warning = npmVersionWarning();
  if (warning) console.warn(`! ${warning}`);
  const missing = missingNativeBinaries();
  if (missing.length) {
    console.error('✗ Platform-specific packages are missing from node_modules:');
    for (const m of missing) console.error(`    ${m}`);
    console.error('  npm removed them during a repeated "npm install" (npm/cli#8536).');
    for (const line of FIX) console.error(line);
    return false;
  }
  if (!quiet) console.log('✓ Environment looks good.');
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const quiet = process.argv.includes('--quiet');
  process.exit(runDoctor({ quiet }) ? 0 : 1);
}
