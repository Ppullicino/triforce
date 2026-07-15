import test from 'node:test';
import assert from 'node:assert/strict';
import { readTask } from '../cli-input.js';

function fakeReadline(lines) {
  return {
    async question() {
      assert.ok(lines.length, 'readTask requested unexpected input');
      return lines.shift();
    },
  };
}

test('reads ordinary one-line prompts unchanged', async () => {
  assert.equal(await readTask(fakeReadline(['build a library'])), 'build a library');
});

test('collects pasted multiline prompts until /run', async () => {
  const task = await readTask(fakeReadline(['/paste', 'first line', '', 'last line', '/run']));
  assert.equal(task, 'first line\n\nlast line');
});

test('can cancel multiline prompt collection', async () => {
  const notices = [];
  const task = await readTask(fakeReadline(['/paste', 'discard me', '/cancel']), notices.push.bind(notices));
  assert.equal(task, null);
  assert.match(notices.at(-1), /cancelled/i);
});
