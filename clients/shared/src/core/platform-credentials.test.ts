import { expect, test } from 'vitest';
import { MemoryCredentialStorage } from './hosts';
import { createCredentialStorage, handleAndroidCredentialResponse } from './platform-credentials';

test('uses ephemeral credentials outside a native shell', () => {
  expect(createCredentialStorage()).toBeInstanceOf(MemoryCredentialStorage);
});

test('uses the origin-scoped Android message bridge when installed', async () => {
  let sent = '';
  window.triforceNative = { postMessage: message => { sent = message; } };
  const credentials = createCredentialStorage();
  const result = credentials.get('host-1');
  const request = JSON.parse(sent) as { id: string };
  handleAndroidCredentialResponse(JSON.stringify({ id: request.id, value: 'secret' }));
  await expect(result).resolves.toBe('secret');
  delete window.triforceNative;
});
