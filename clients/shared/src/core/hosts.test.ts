import { expect, test } from 'vitest';
import { HostRepository, MemoryCredentialStorage, type HostProfile, type HostStorage } from './hosts';
import { normalizeHostUrl } from './host-url';

class MemoryHostStorage implements HostStorage {
  hosts: HostProfile[] = [];
  async load() { return structuredClone(this.hosts); }
  async save(hosts: HostProfile[]) { this.hosts = structuredClone(hosts); }
}

test.each([
  ['192.168.1.5:3000', 'http://192.168.1.5:3000', 'ws://192.168.1.5:3000'],
  ['https://triforce.example.net/base/', 'https://triforce.example.net/base', 'wss://triforce.example.net/base'],
  ['http://[::1]:3000', 'http://[::1]:3000', 'ws://[::1]:3000'],
])('normalizes host URL %s', (input, baseUrl, webSocketUrl) => {
  expect(normalizeHostUrl(input)).toMatchObject({ baseUrl, webSocketUrl });
});

test('rejects credentials, unsafe schemes, queries, and fragments in host URLs', () => {
  for (const value of ['ftp://host', 'http://user:pass@host', 'https://host?q=token', 'https://host/#token']) {
    expect(() => normalizeHostUrl(value)).toThrow();
  }
});

test('creates, edits, deletes, and separately stores host credentials', async () => {
  const storage = new MemoryHostStorage();
  const credentials = new MemoryCredentialStorage();
  const repository = new HostRepository(storage, credentials);
  const host = await repository.upsert({ name: 'Lab', url: '10.0.0.4:3000', token: 'secret' });
  expect(await repository.token(host.id)).toBe('secret');
  expect(JSON.stringify(await repository.list())).not.toContain('secret');
  await repository.upsert({ id: host.id, name: 'Home lab', url: host.url });
  expect((await repository.list())[0]?.name).toBe('Home lab');
  await repository.delete(host.id);
  expect(await repository.list()).toEqual([]);
  expect(await repository.token(host.id)).toBeNull();
});
