import { invoke } from '@tauri-apps/api/core';
import { MemoryCredentialStorage, type CredentialStorage } from './hosts';

export class TauriCredentialStorage implements CredentialStorage {
  get(hostId: string) { return invoke<string | null>('credential_get', { hostId }); }
  set(hostId: string, token: string) { return invoke<void>('credential_set', { hostId, token }); }
  delete(hostId: string) { return invoke<void>('credential_delete', { hostId }); }
}

export function createCredentialStorage(): CredentialStorage {
  return '__TAURI_INTERNALS__' in window ? new TauriCredentialStorage() : new MemoryCredentialStorage();
}
