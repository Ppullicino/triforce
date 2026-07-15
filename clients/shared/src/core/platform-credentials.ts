import { invoke } from '@tauri-apps/api/core';
import { MemoryCredentialStorage, type CredentialStorage } from './hosts';

export class TauriCredentialStorage implements CredentialStorage {
  get(hostId: string) { return invoke<string | null>('credential_get', { hostId }); }
  set(hostId: string, token: string) { return invoke<void>('credential_set', { hostId, token }); }
  delete(hostId: string) { return invoke<void>('credential_delete', { hostId }); }
}

interface AndroidBridge { postMessage(message: string): void; onmessage?: (event: { data: string }) => void }
const pending = new Map<string, { resolve: (value: string | null) => void; reject: (error: Error) => void }>();

export class AndroidCredentialStorage implements CredentialStorage {
  get(hostId: string) { return androidRequest('get', hostId); }
  async set(hostId: string, token: string) { await androidRequest('set', hostId, token); }
  async delete(hostId: string) { await androidRequest('delete', hostId); }
}

export function handleAndroidCredentialResponse(payload: string) {
  const message = JSON.parse(payload) as { id: string; value?: string | null; error?: string };
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve(message.value ?? null);
}

function androidRequest(operation: string, hostId: string, token?: string) {
  const id = crypto.randomUUID();
  return new Promise<string | null>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.triforceNative!.postMessage(JSON.stringify({ id, operation, hostId, token }));
  });
}

export function createCredentialStorage(): CredentialStorage {
  if ('__TAURI_INTERNALS__' in window) return new TauriCredentialStorage();
  if (window.triforceNative) return new AndroidCredentialStorage();
  return new MemoryCredentialStorage();
}

declare global { interface Window { triforceNative?: AndroidBridge; triforceNativeResponse?: (payload: string) => void } }
