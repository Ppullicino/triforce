import { expect, test } from 'vitest';
import { MemoryCredentialStorage } from './hosts';
import { createCredentialStorage } from './platform-credentials';

test('uses ephemeral credentials outside a native shell', () => {
  expect(createCredentialStorage()).toBeInstanceOf(MemoryCredentialStorage);
});
