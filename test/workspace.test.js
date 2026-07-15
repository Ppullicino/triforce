import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace, parseWorkspaceManifest, runWorkspaceTest } from '../workspace.js';

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
