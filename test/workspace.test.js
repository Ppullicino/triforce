import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace, gcWorkspaces, parseWorkspaceManifest, runWorkspaceTest } from '../workspace.js';

test('parses and materializes a multi-file workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'triforce-workspaces-test-'));
  try {
    const manifest = parseWorkspaceManifest(JSON.stringify({
      files: [
        { path: 'src/app.js', content: 'export const answer = 42;\n' },
        { path: 'test.js', content: "console.log('ok');\n" },
      ],
      testFile: 'test.js',
    }));
    const workspace = await createWorkspace(manifest, root);
    assert.equal(await readFile(join(workspace.directory, 'src/app.js'), 'utf8'), 'export const answer = 42;\n');
    assert.deepEqual(workspace.files, ['src/app.js', 'test.js']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const path of ['../escape.js', '/tmp/escape.js', '.git/config', 'node_modules/evil.js', 'src/../../escape.js']) {
  test(`rejects unsafe workspace path ${path}`, () => {
    assert.throws(() => parseWorkspaceManifest(JSON.stringify({
      files: [{ path, content: 'bad' }, { path: 'test.js', content: 'ok' }],
      testFile: 'test.js',
    })), /path|Reserved/i);
  });
}

test('rejects duplicate paths and missing test entry points', () => {
  assert.throws(() => parseWorkspaceManifest(JSON.stringify({
    files: [{ path: 'test.js', content: 'a' }, { path: 'test.js', content: 'b' }],
    testFile: 'test.js',
  })), /Duplicate/);
  assert.throws(() => parseWorkspaceManifest(JSON.stringify({
    files: [{ path: 'index.js', content: 'a' }], testFile: 'test.js',
  })), /testFile/);
});

test('runs a generated test file in the isolated workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'triforce-workspaces-run-'));
  try {
    const manifest = parseWorkspaceManifest(JSON.stringify({
      files: [{ path: 'test.js', content: "import assert from 'node:assert'; assert.equal(2 + 2, 4); console.log('workspace ok');" }],
      testFile: 'test.js',
    }));
    const workspace = await createWorkspace(manifest, root);
    const result = await runWorkspaceTest(workspace, { packageRoot: join(import.meta.dirname, '..') });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /workspace ok/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runs generated Express integration tests over private loopback', async () => {
  const packageRoot = join(import.meta.dirname, '..');
  const root = await mkdtemp(join(packageRoot, 'generated-projects-test-'));
  try {
    const manifest = parseWorkspaceManifest(JSON.stringify({
      files: [
        { path: 'package.json', content: '{"type":"module"}' },
        { path: 'server.js', content: "import express from 'express'; const app=express(); app.get('/health',(_req,res)=>res.json({ok:true})); export const server=app.listen(0,'127.0.0.1');" },
        { path: 'test.js', content: "import assert from 'node:assert'; import {server} from './server.js'; try { await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve)); const {port}=server.address(); const data=await fetch(`http://127.0.0.1:${port}/health`).then(r=>r.json()); assert.deepEqual(data,{ok:true}); console.log('express ok'); } finally { server.close(); }" },
      ],
      testFile: 'test.js',
    }));
    const workspace = await createWorkspace(manifest, root, { dependencyRoot: join(packageRoot, 'node_modules') });
    const result = await runWorkspaceTest(workspace, { packageRoot });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /express ok/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const [label, content] of [
  ['host filesystem reads', "import fs from 'node:fs'; fs.readFileSync('/etc/passwd');"],
  ['child processes', "import {execFileSync} from 'node:child_process'; execFileSync('/bin/true');"],
]) {
  test(`workspace test sandbox blocks ${label}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'triforce-workspaces-block-'));
    try {
      const manifest = parseWorkspaceManifest(JSON.stringify({ files: [{ path: 'test.js', content }], testFile: 'test.js' }));
      const workspace = await createWorkspace(manifest, root);
      const result = await runWorkspaceTest(workspace, { packageRoot: join(import.meta.dirname, '..') });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /permission|access denied|ERR_ACCESS_DENIED/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('runWorkspaceTest aborts immediately on signal abort', async () => {
  const root = await mkdtemp(join(tmpdir(), 'triforce-workspaces-abort-'));
  try {
    const manifest = parseWorkspaceManifest(JSON.stringify({
      files: [{ path: 'test.js', content: "setTimeout(() => {}, 60000);" }],
      testFile: 'test.js',
    }));
    const workspace = await createWorkspace(manifest, root);
    const controller = new AbortController();
    const p = runWorkspaceTest(workspace, { packageRoot: join(import.meta.dirname, '..'), signal: controller.signal });
    controller.abort();
    await assert.rejects(p, err => {
      return err.name === 'AbortError';
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function fakeWorkspaceName(index) {
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString().replaceAll(':', '-');
  return `${timestamp}-${index.toString(16).padStart(10, '0')}`;
}

async function makeFakeWorkspaces(root, count) {
  const names = [];
  for (let i = 0; i < count; i++) {
    const name = fakeWorkspaceName(i);
    await mkdir(join(root, name), { recursive: true });
    await writeFile(join(root, name, 'app.js'), `// workspace ${i}\n`);
    names.push(name);
  }
  return names; // oldest first
}

test('gcWorkspaces keeps the newest N and skips foreign directory names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'triforce-workspaces-gc-'));
  try {
    const names = await makeFakeWorkspaces(root, 25);
    await mkdir(join(root, 'my-manual-dir'));
    const { removed, kept } = await gcWorkspaces(root, { keep: 20 });
    assert.equal(removed.length, 5);
    assert.deepEqual(removed.sort(), names.slice(0, 5).sort());
    assert.equal(kept.length, 20);
    const remaining = await readdir(root);
    assert.ok(remaining.includes('my-manual-dir'));
    for (const name of names.slice(5)) assert.ok(remaining.includes(name));
    for (const name of names.slice(0, 5)) assert.ok(!remaining.includes(name));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('gcWorkspaces never deletes the protected just-completed workspace regardless of age', async () => {
  const root = await mkdtemp(join(tmpdir(), 'triforce-workspaces-gc-protect-'));
  try {
    const names = await makeFakeWorkspaces(root, 25);
    const oldest = join(root, names[0]);
    const { removed } = await gcWorkspaces(root, { keep: 20, protect: [oldest] });
    assert.equal(removed.length, 4);
    const remaining = await readdir(root);
    assert.ok(remaining.includes(names[0]));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('gcWorkspaces reads TRIFORCE_WORKSPACE_KEEP and tolerates a missing root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'triforce-workspaces-gc-env-'));
  const previous = process.env.TRIFORCE_WORKSPACE_KEEP;
  try {
    await makeFakeWorkspaces(root, 5);
    process.env.TRIFORCE_WORKSPACE_KEEP = '2';
    const { removed, kept } = await gcWorkspaces(root);
    assert.equal(kept.length, 2);
    assert.equal(removed.length, 3);
    const missing = await gcWorkspaces(join(root, 'does-not-exist'));
    assert.deepEqual(missing, { removed: [], kept: [] });
  } finally {
    if (previous === undefined) delete process.env.TRIFORCE_WORKSPACE_KEEP;
    else process.env.TRIFORCE_WORKSPACE_KEEP = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('gcWorkspaces never follows symlinks out of the workspace root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'triforce-workspaces-gc-symlink-'));
  const outside = await mkdtemp(join(tmpdir(), 'triforce-workspaces-gc-outside-'));
  try {
    await writeFile(join(outside, 'precious.txt'), 'keep me\n');
    const names = await makeFakeWorkspaces(root, 3);
    await symlink(outside, join(root, fakeWorkspaceName(59)), 'dir');
    const { removed } = await gcWorkspaces(root, { keep: 0 });
    assert.deepEqual(removed.sort(), names.sort());
    assert.equal(await readFile(join(outside, 'precious.txt'), 'utf8'), 'keep me\n');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('createWorkspace initializes git repository, commits each iteration, and supports diffing', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const { checkGit, getWorkspaceDiff } = await import('../workspace.js');

  const root = await mkdtemp(join(tmpdir(), 'triforce-workspaces-git-test-'));
  try {
    const isGit = await checkGit();
    if (!isGit) {
      console.warn('Skipping git workspace test: git is not available on this host');
      return;
    }

    const manifest1 = parseWorkspaceManifest(JSON.stringify({
      files: [{ path: 'app.js', content: 'console.log("v1");\n' }],
      testFile: 'app.js',
    }));

    const workspace = await createWorkspace(manifest1, root, { iteration: 1 });
    assert.deepEqual(workspace.files, ['app.js']);

    const log1 = await execFileAsync('git', ['log', '--oneline'], { cwd: workspace.directory });
    assert.match(log1.stdout, /iteration-1/);
    assert.match(log1.stdout, /initial commit/);

    const manifest2 = parseWorkspaceManifest(JSON.stringify({
      files: [{ path: 'app.js', content: 'console.log("v2");\n' }],
      testFile: 'app.js',
    }));
    const workspace2 = await createWorkspace(manifest2, root, { existingWorkspace: workspace, iteration: 2 });
    assert.equal(workspace2.directory, workspace.directory);

    const log2 = await execFileAsync('git', ['log', '--oneline'], { cwd: workspace.directory });
    assert.match(log2.stdout, /iteration-2/);

    const diff = await getWorkspaceDiff(workspace);
    assert.match(diff, /-console\.log\("v1"\);/);
    assert.match(diff, /\+console\.log\("v2"\);/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
