import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fsb from '../fs-browser.js';

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'triforce-fsb-'));
  const root = join(base, 'root');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'left-pad'), { recursive: true });
  await mkdir(join(root, '.git'), { recursive: true });
  await mkdir(join(root, '.ssh'), { recursive: true });
  await writeFile(join(root, 'src', 'index.js'), 'export const x = 1;\n');
  await writeFile(join(root, 'README.md'), '# hi\n');
  await writeFile(join(root, '.env'), 'SECRET=zzz\n');
  await writeFile(join(root, '.ssh', 'id_rsa'), 'PRIVATE KEY\n');
  await writeFile(join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
  // an outside dir + a symlink into it
  const outside = join(base, 'outside');
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, 'secret.txt'), 'exfiltrate me\n');
  await symlink(outside, join(root, 'escape-link'), 'dir');
  return { base, root, outside };
}

test('roots() resolves configured colon-separated roots', () => {
  const r = fsb.roots('/tmp:/var');
  assert.ok(r.includes('/tmp'));
  assert.equal(fsb.roots('').length >= 1, true); // falls back to $HOME
});

test('list() hides dotfiles, .git, node_modules stays but secrets are denied', async () => {
  const { base, root } = await fixture();
  try {
    const { entries } = await fsb.list(root, { roots: [root] });
    const names = entries.map(e => e.name);
    assert.ok(names.includes('src'));
    assert.ok(names.includes('README.md'));
    assert.ok(!names.includes('.env'), '.env hidden');
    assert.ok(!names.includes('.ssh'), '.ssh denied');
    assert.ok(!names.includes('.git'), 'dotfiles hidden by default');
    // directories sort before files
    assert.equal(entries[0].type, 'dir');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('confinePath rejects traversal, out-of-root absolutes, and denylisted segments', async () => {
  const { base, root } = await fixture();
  try {
    await assert.rejects(() => fsb.confinePath(join(root, '..', '..', 'etc'), [root]), /outside the allowed roots/);
    await assert.rejects(() => fsb.confinePath('/etc/passwd', [root]), /outside the allowed roots/);
    await assert.rejects(() => fsb.confinePath(join(root, '.ssh', 'id_rsa'), [root]), /not accessible|denylisted/);
    const ok = await fsb.confinePath(join(root, 'src'), [root]);
    assert.equal(ok, join(root, 'src'));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('confinePath follows symlinks and rejects one that escapes the root', async () => {
  const { base, root } = await fixture();
  try {
    await assert.rejects(() => fsb.confinePath(join(root, 'escape-link'), [root]), /escapes the allowed roots|outside the allowed roots/);
    await assert.rejects(() => fsb.list(join(root, 'escape-link'), { roots: [root] }), /escapes|outside/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('readBudgeted returns a text bundle and skips vendored dirs + secrets', async () => {
  const { base, root } = await fixture();
  try {
    const bundle = await fsb.readBudgeted(root, { roots: [root] });
    assert.match(bundle, /=== src\/index\.js ===/);
    assert.match(bundle, /=== README\.md ===/);
    assert.doesNotMatch(bundle, /SECRET=zzz/);
    assert.doesNotMatch(bundle, /left-pad/);
    assert.doesNotMatch(bundle, /PRIVATE KEY/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('readBudgeted honours the byte budget', async () => {
  const { base, root } = await fixture();
  try {
    const full = await fsb.readBudgeted(root, { roots: [root] });
    const tiny = await fsb.readBudgeted(root, { roots: [root], maxBytes: 8 });
    assert.ok(tiny.length < full.length, 'a tight byte budget yields far less content');
    assert.ok(tiny.length <= 40, `budget respected (got ${tiny.length} bytes)`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
