import { PROTOCOL_VERSION } from '@triforce/protocol';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { TriforceConnection, type ConnectionState } from './core/connection';
import { BrowserHostStorage, HostRepository, MemoryCredentialStorage, type HostProfile } from './core/hosts';

export function App() {
  const repository = useMemo(() => new HostRepository(new BrowserHostStorage(localStorage), new MemoryCredentialStorage()), []);
  const [hosts, setHosts] = useState<HostProfile[]>([]);
  const [error, setError] = useState('');
  const [states, setStates] = useState<Record<string, ConnectionState>>({});
  useEffect(() => { void repository.list().then(setHosts); }, [repository]);

  async function addHost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await repository.upsert({
        name: String(form.get('name') ?? ''),
        url: String(form.get('url') ?? ''),
        token: String(form.get('token') ?? ''),
      });
      setHosts(await repository.list());
      setError('');
      event.currentTarget.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save host'); }
  }

  async function removeHost(id: string) {
    await repository.delete(id);
    setHosts(await repository.list());
  }

  async function testHost(host: HostProfile) {
    const connection = new TriforceConnection(host.url);
    connection.onState(state => setStates(current => ({ ...current, [host.id]: state })));
    await connection.connect(await repository.token(host.id) ?? undefined);
  }

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="app-title">
        <p className="eyebrow">TRIFORCE REMOTE</p>
        <h1 id="app-title">Your agents. Any screen.</h1>
        <p className="lede">Connect this shared client to a Triforce server from Android, Windows, or macOS.</p>
        <form className="host-form" onSubmit={addHost}>
          <label>Name<input name="name" placeholder="Home lab" autoComplete="off" /></label>
          <label>Server URL<input name="url" placeholder="https://triforce.example.net" required inputMode="url" /></label>
          <label>Access token<input name="token" type="password" required autoComplete="off" /></label>
          <button type="submit">Add a Triforce host</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        <ul className="host-list" aria-label="Saved Triforce hosts">
          {hosts.map(host => <li key={host.id}>
            <span><strong>{host.name}</strong><small>{host.url}</small></span>
            <span className="host-actions">
              <button type="button" onClick={() => testHost(host)}>Test</button>
              <button type="button" className="quiet" onClick={() => removeHost(host.id)}>Delete</button>
            </span>
            {states[host.id] && <small className="connection-state">{states[host.id]}</small>}
          </li>)}
        </ul>
        <small>Protocol foundation {PROTOCOL_VERSION}</small>
      </section>
    </main>
  );
}
