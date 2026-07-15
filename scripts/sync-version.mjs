import { readFile, writeFile } from 'node:fs/promises';

const write = process.argv.includes('--write');
const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = root.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid root SemVer: ${version}`);
const [major, minor, patch] = version.split(/[.-]/).map(Number);
const androidCode = major * 1_000_000 + minor * 1_000 + patch;
if (!Number.isSafeInteger(androidCode) || androidCode < 1 || androidCode > 2_100_000_000) throw new Error('Version cannot be represented as an Android versionCode');

const jsonFiles = [
  '../clients/shared/package.json',
  '../clients/desktop/package.json',
  '../packages/protocol/package.json',
  '../clients/desktop/src-tauri/tauri.conf.json',
];
const mismatches = [];
for (const relative of jsonFiles) {
  const url = new URL(relative, import.meta.url);
  const document = JSON.parse(await readFile(url, 'utf8'));
  if (document.version !== version) mismatches.push(`${relative}: ${document.version} != ${version}`);
  if (write) { document.version = version; await writeFile(url, `${JSON.stringify(document, null, 2)}\n`); }
}

const lockUrl = new URL('../package-lock.json', import.meta.url);
const lock = JSON.parse(await readFile(lockUrl, 'utf8'));
for (const key of ['', 'clients/shared', 'clients/desktop', 'packages/protocol']) {
  const value = key ? lock.packages?.[key]?.version : lock.version;
  if (value !== version) mismatches.push(`../package-lock.json (${key || 'root'}): ${value} != ${version}`);
  if (key) lock.packages[key].version = version;
  else { lock.version = version; lock.packages[''].version = version; }
}
if (write) await writeFile(lockUrl, `${JSON.stringify(lock, null, 2)}\n`);

const textFiles = [
  ['../clients/desktop/src-tauri/Cargo.toml', /^(version = ")[^"]+("$)/m, `$1${version}$2`, version],
  ['../clients/desktop/src-tauri/Cargo.lock', /(\[\[package\]\]\nname = "triforce-desktop"\nversion = ")[^"]+("$)/m, `$1${version}$2`, version],
  ['../clients/android/app/build.gradle.kts', /^(\s*versionName = ")[^"]+("$)/m, `$1${version}$2`, version],
  ['../clients/android/app/build.gradle.kts', /^(\s*versionCode = )\d+$/m, `$1${androidCode}`, String(androidCode)],
];
for (const [relative, pattern, replacement, expected] of textFiles) {
  const url = new URL(relative, import.meta.url);
  const source = await readFile(url, 'utf8');
  const updated = source.replace(pattern, replacement);
  const marker = source.match(pattern)?.[0];
  if (!marker) mismatches.push(`${relative}: version marker is missing`);
  else if (!marker.includes(expected)) mismatches.push(`${relative}: ${marker.trim()} does not contain ${expected}`);
  if (write) await writeFile(url, updated);
}

if (!write && mismatches.length) throw new Error(`Release versions are not synchronized:\n${mismatches.join('\n')}`);
console.log(`Release version ${version} (Android ${androidCode}) is synchronized.`);
