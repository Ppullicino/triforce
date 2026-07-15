import { normalizeHostUrl } from './host-url';

export interface HostProfile {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface HostStorage {
  load(): Promise<HostProfile[]>;
  save(hosts: HostProfile[]): Promise<void>;
}

export interface CredentialStorage {
  get(hostId: string): Promise<string | null>;
  set(hostId: string, token: string): Promise<void>;
  delete(hostId: string): Promise<void>;
}

export class BrowserHostStorage implements HostStorage {
  constructor(private readonly storage: Storage, private readonly key = 'triforce.hosts.v1') {}
  async load() {
    const parsed: unknown = JSON.parse(this.storage.getItem(this.key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isHostProfile) : [];
  }
  async save(hosts: HostProfile[]) { this.storage.setItem(this.key, JSON.stringify(hosts)); }
}

export class MemoryCredentialStorage implements CredentialStorage {
  private readonly values = new Map<string, string>();
  async get(hostId: string) { return this.values.get(hostId) ?? null; }
  async set(hostId: string, token: string) { this.values.set(hostId, token); }
  async delete(hostId: string) { this.values.delete(hostId); }
}

export class HostRepository {
  constructor(private readonly storage: HostStorage, private readonly credentials: CredentialStorage) {}
  list() { return this.storage.load(); }

  async upsert(input: { id?: string; name: string; url: string; token?: string }) {
    const hosts = await this.storage.load();
    const normalized = normalizeHostUrl(input.url);
    const now = new Date().toISOString();
    const existing = input.id ? hosts.find(host => host.id === input.id) : undefined;
    const host: HostProfile = {
      id: existing?.id ?? crypto.randomUUID(),
      name: input.name.trim() || new URL(normalized.baseUrl).hostname,
      url: normalized.baseUrl,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.storage.save([...hosts.filter(item => item.id !== host.id), host]);
    if (input.token) await this.credentials.set(host.id, input.token);
    return host;
  }

  async delete(hostId: string) {
    await this.storage.save((await this.storage.load()).filter(host => host.id !== hostId));
    await this.credentials.delete(hostId);
  }

  token(hostId: string) { return this.credentials.get(hostId); }
}

function isHostProfile(value: unknown): value is HostProfile {
  if (!value || typeof value !== 'object') return false;
  const host = value as Record<string, unknown>;
  return ['id', 'name', 'url', 'createdAt', 'updatedAt'].every(key => typeof host[key] === 'string');
}
