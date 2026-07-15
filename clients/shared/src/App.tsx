import { PROTOCOL_VERSION, type AgentRole, type PipelineConfiguration, type PipelineMode } from '@triforce/protocol';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { TriforceConnection, type ConnectionState } from './core/connection';
import { BrowserHostStorage, HostRepository, type HostProfile } from './core/hosts';
import { initialPipelineState, reducePipeline, type PipelineViewState } from './core/pipeline';
import { createCredentialStorage } from './core/platform-credentials';

const roles: AgentRole[] = ['architect', 'developer', 'reviewer'];
const defaultConfig: PipelineConfiguration = {
  architect: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  developer: { provider: 'google', model: 'gemini-2.5-flash' },
  reviewer: { provider: 'google', model: 'gemini-2.5-flash' },
};

export function App() {
  const repository = useMemo(() => new HostRepository(new BrowserHostStorage(localStorage), createCredentialStorage()), []);
  const [hosts, setHosts] = useState<HostProfile[]>([]);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<TriforceConnection | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [activeHost, setActiveHost] = useState<HostProfile | null>(null);
  const [preferredHostId, setPreferredHostId] = useState(() => localStorage.getItem('triforce.selected-host.v1'));
  const [pipeline, setPipeline] = useState<PipelineViewState>(initialPipelineState);
  const [history, setHistory] = useState<PipelineViewState[]>([]);
  const [screen, setScreen] = useState<'run' | 'history' | 'settings' | 'diagnostics'>('run');
  useEffect(() => { void repository.list().then(setHosts); }, [repository]);

  async function addHost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await repository.upsert({ name: String(form.get('name') ?? ''), url: String(form.get('url') ?? ''), token: String(form.get('token') ?? '') });
      setHosts(await repository.list()); setError(''); event.currentTarget.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save host'); }
  }

  async function connectHost(host: HostProfile) {
    connection?.disconnect();
    const next = new TriforceConnection(host.url);
    next.onState(setConnectionState);
    next.onEvent(event => setPipeline(current => {
      const updated = reducePipeline(current, event);
      if (updated.status !== current.status && ['completed', 'failed'].includes(updated.status)) setHistory(items => [updated, ...items].slice(0, 50));
      return updated;
    }));
    setConnection(next); setActiveHost(host); setPreferredHostId(host.id); localStorage.setItem('triforce.selected-host.v1', host.id);
    await next.connect(await repository.token(host.id) ?? undefined);
  }

  if (!activeHost || !connection || connectionState !== 'connected') {
    return <HostScreen hosts={hosts} preferredHostId={preferredHostId} state={connectionState} error={error} onAdd={addHost} onConnect={connectHost}
      onDelete={async id => { await repository.delete(id); setHosts(await repository.list()); }} />;
  }

  return <Dashboard host={activeHost} connection={connection} connectionState={connectionState} pipeline={pipeline}
    history={history} screen={screen} setScreen={setScreen} onSwitch={() => { connection.disconnect(); localStorage.removeItem('triforce.selected-host.v1'); setPreferredHostId(null); setActiveHost(null); }} />;
}

function HostScreen({ hosts, preferredHostId, state, error, onAdd, onConnect, onDelete }: {
  hosts: HostProfile[]; preferredHostId: string | null; state: ConnectionState; error: string; onAdd: (event: FormEvent<HTMLFormElement>) => void;
  onConnect: (host: HostProfile) => void; onDelete: (id: string) => void;
}) {
  return <main className="shell"><section className="hero" aria-labelledby="app-title">
    <p className="eyebrow">TRIFORCE REMOTE</p><h1 id="app-title">Your agents. Any screen.</h1>
    <p className="lede">Connect to a Triforce server from Android, Windows, or macOS.</p>
    <form className="host-form" onSubmit={onAdd}>
      <label>Name<input name="name" placeholder="Home lab" autoComplete="off" /></label>
      <label>Server URL<input name="url" placeholder="https://triforce.example.net" required inputMode="url" /></label>
      <label>Access token<input name="token" type="password" required autoComplete="off" /></label>
      <button type="submit">Add a Triforce host</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {state !== 'disconnected' && <p className={`connection ${state}`}>{state}</p>}
    <ul className="host-list" aria-label="Saved Triforce hosts">{hosts.map(host => <li key={host.id}>
      <span><strong>{host.name}{host.id === preferredHostId && ' · Recent'}</strong><small>{host.url}{host.url.startsWith('http:') && ' · Insecure local development'}</small></span><span className="host-actions">
        <button type="button" onClick={() => onConnect(host)}>Connect</button>
        <button type="button" className="quiet" onClick={() => onDelete(host.id)}>Delete</button>
      </span></li>)}</ul><small>Protocol {PROTOCOL_VERSION}</small>
  </section></main>;
}

function Dashboard({ host, connection, connectionState, pipeline, history, screen, setScreen, onSwitch }: {
  host: HostProfile; connection: TriforceConnection; connectionState: ConnectionState; pipeline: PipelineViewState;
  history: PipelineViewState[]; screen: string; setScreen: (screen: 'run' | 'history' | 'settings' | 'diagnostics') => void; onSwitch: () => void;
}) {
  const [mode, setMode] = useState<PipelineMode>(1);
  const [config, setConfig] = useState(defaultConfig);
  const [task, setTask] = useState('');
  const [activeRole, setActiveRole] = useState<AgentRole>('architect');
  function submit(event: FormEvent) { event.preventDefault(); connection.run(task, config, mode); setTask(''); }
  const totalCost = roles.reduce((sum, role) => sum + (pipeline.usage[role]?.cost ?? 0), 0);

  return <main className="app-frame">
    <header className="topbar"><div><span className="brand">TRIFORCE</span><small>{host.name} · {connectionState}</small></div>
      <nav aria-label="Application"><button onClick={() => setScreen('run')}>Run</button><button onClick={() => setScreen('history')}>History</button><button onClick={() => setScreen('settings')}>Settings</button><button onClick={() => setScreen('diagnostics')}>Diagnostics</button></nav>
      <button className="quiet" onClick={onSwitch}>Switch host</button></header>
    {screen === 'run' && <div className="workspace-view">
      <section className="composer"><form onSubmit={submit}>
        <label htmlFor="task">What should your agents build?</label><textarea id="task" value={task} onChange={event => setTask(event.target.value)} required rows={4} />
        <div className="mode-row" aria-label="Pipeline mode">{([1, 2, 3] as PipelineMode[]).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>Mode {value}</button>)}</div>
        <button type="submit" disabled={pipeline.status === 'running'}>{pipeline.status === 'running' ? 'Pipeline running…' : 'Launch pipeline'}</button>
      </form><div className="run-meta"><span>{pipeline.label || 'Ready'}</span><span>${totalCost.toFixed(4)}</span>{pipeline.error && <span className="error">{pipeline.error}</span>}</div>
      </section>
      <section className="results" aria-live="polite"><div className="role-tabs" role="tablist">{roles.map(role => <button role="tab" aria-selected={activeRole === role} key={role} onClick={() => setActiveRole(role)}>{role}</button>)}</div>
        <article className="agent-output"><h2>{activeRole}</h2><pre>{pipeline.outputs[activeRole] || 'Waiting for agent output…'}</pre></article>
        <article className="terminal"><h2>Sandbox terminal</h2><pre>{pipeline.terminal || 'No terminal output yet.'}</pre></article>
        {pipeline.workspace && <article className="artifact"><h2>Workspace</h2><pre>{JSON.stringify(pipeline.workspace, null, 2)}</pre></article>}
      </section></div>}
    {screen === 'history' && <section className="page"><h1>Run history</h1>{history.length ? history.map((run, index) => <article className="history-card" key={`${run.runId}-${index}`}><strong>{run.status}</strong><span>{run.runId}</span><span>{run.elapsed ?? 0}s</span></article>) : <p>No completed runs this session.</p>}</section>}
    {screen === 'settings' && <section className="page"><h1>Agent settings</h1><div className="settings-grid">{roles.map(role => <fieldset key={role}><legend>{role}</legend><label>Provider<input value={config[role].provider} onChange={event => setConfig(current => ({ ...current, [role]: { ...current[role], provider: event.target.value } }))} /></label><label>Model<input value={config[role].model} onChange={event => setConfig(current => ({ ...current, [role]: { ...current[role], model: event.target.value } }))} /></label></fieldset>)}</div></section>}
    {screen === 'diagnostics' && <section className="page"><h1>Diagnostics</h1><dl><dt>Server</dt><dd>{host.url}</dd><dt>Connection</dt><dd>{connectionState}</dd><dt>Protocol</dt><dd>{PROTOCOL_VERSION}</dd><dt>Run ID</dt><dd>{pipeline.runId ?? 'none'}</dd><dt>Buffered terminal</dt><dd>{pipeline.terminal.length.toLocaleString()} characters</dd></dl></section>}
  </main>;
}
