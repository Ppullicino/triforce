import { PROTOCOL_VERSION, type AgentConfiguration, type AgentRole, type PipelineMode } from '@triforce/protocol';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { TriforceConnection, type ConnectionState } from './core/connection';
import { BrowserHostStorage, HostRepository, type HostProfile } from './core/hosts';
import { initialPipelineState, reducePipeline, type PipelineViewState } from './core/pipeline';
import { appendUserMessage, initialChatState, reduceChat, type ChatState } from './core/chat';
import { createCredentialStorage } from './core/platform-credentials';

const roles: AgentRole[] = ['architect', 'developer', 'reviewer'];
const connectionMessages: Partial<Record<ConnectionState, string>> = {
  connecting: 'Connecting…',
  reconnecting: 'Connection interrupted. Reconnecting with bounded backoff…',
  unauthorized: 'Authentication failed. Update the saved access token and try again.',
  incompatible: `This server requires an incompatible protocol version. Client protocol: ${PROTOCOL_VERSION}.`,
  unreachable: 'Unable to reach the server. Check its URL, network, and TLS certificate; certificate errors are never bypassed.',
};
// The build screen always edits a full architect/developer/reviewer triad; the
// protocol type keeps every position optional for Modes 2/3.
type BuildTriad = Record<AgentRole, AgentConfiguration>;
const defaultConfig: BuildTriad = {
  architect: { provider: 'claude-cli', model: 'claude-cli-default' },
  developer: { provider: 'codex-cli', model: 'codex-cli-default' },
  reviewer: { provider: 'agy-cli', model: 'agy-cli-default' },
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
  const [chat, setChat] = useState<ChatState>(initialChatState);
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
    next.onEvent(event => {
      setPipeline(current => {
        const updated = reducePipeline(current, event);
        if (updated.status !== current.status && ['completed', 'failed'].includes(updated.status)) setHistory(items => [updated, ...items].slice(0, 50));
        return updated;
      });
      setChat(current => reduceChat(current, event));
    });
    setConnection(next); setActiveHost(host); setPreferredHostId(host.id); localStorage.setItem('triforce.selected-host.v1', host.id);
    await next.connect(await repository.token(host.id) ?? undefined);
  }

  if (!activeHost || !connection || connectionState !== 'connected') {
    return <HostScreen hosts={hosts} preferredHostId={preferredHostId} state={connectionState} error={error} onAdd={addHost} onConnect={connectHost}
      onDelete={async id => { await repository.delete(id); setHosts(await repository.list()); }} />;
  }

  const sendChat = (message: string) => {
    setChat(current => appendUserMessage(current, message));
    connection.chat(message, chat.conversationId ? { conversationId: chat.conversationId } : {});
  };

  return <Dashboard host={activeHost} connection={connection} connectionState={connectionState} pipeline={pipeline}
    chat={chat} onSendChat={sendChat}
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
    {state !== 'disconnected' && <p className={`connection ${state}`} role={state === 'unreachable' || state === 'unauthorized' || state === 'incompatible' ? 'alert' : 'status'}>{connectionMessages[state] ?? state}</p>}
    <ul className="host-list" aria-label="Saved Triforce hosts">{hosts.map(host => <li key={host.id}>
      <span><strong>{host.name}{host.id === preferredHostId && ' · Recent'}</strong><small>{host.url}{host.url.startsWith('http:') && ' · Insecure local development'}</small></span><span className="host-actions">
        <button type="button" onClick={() => onConnect(host)}>Connect</button>
        <button type="button" className="quiet" onClick={() => onDelete(host.id)}>Delete</button>
      </span></li>)}</ul><small>Protocol {PROTOCOL_VERSION}</small>
  </section></main>;
}

function Dashboard({ host, connection, connectionState, pipeline, chat, onSendChat, history, screen, setScreen, onSwitch }: {
  host: HostProfile; connection: TriforceConnection; connectionState: ConnectionState; pipeline: PipelineViewState;
  chat: ChatState; onSendChat: (message: string) => void;
  history: PipelineViewState[]; screen: string; setScreen: (screen: 'run' | 'history' | 'settings' | 'diagnostics') => void; onSwitch: () => void;
}) {
  const [mode, setMode] = useState<PipelineMode>(1);
  const [config, setConfig] = useState(defaultConfig);
  const [task, setTask] = useState('');
  const [folder, setFolder] = useState('');
  const [chatDraft, setChatDraft] = useState('');
  const [activeRole, setActiveRole] = useState<AgentRole>('architect');
  function submit(event: FormEvent) { event.preventDefault(); connection.run(task, config, mode); setTask(''); }
  function submitChat(event: FormEvent) { event.preventDefault(); const m = chatDraft.trim(); if (!m || chat.status === 'thinking') return; onSendChat(m); setChatDraft(''); }
  const modeLabels = ['Build', 'Credit', 'Chat'];
  const totalCost = roles.reduce((sum, role) => sum + (pipeline.usage[role]?.cost ?? 0), 0);

  return <main className="app-frame">
    <header className="topbar"><div><span className="brand">TRIFORCE</span><small>{host.name} · {connectionState}</small></div>
      <nav aria-label="Application"><button onClick={() => setScreen('run')}>Run</button><button onClick={() => setScreen('history')}>History</button><button onClick={() => setScreen('settings')}>Settings</button><button onClick={() => setScreen('diagnostics')}>Diagnostics</button></nav>
      <button className="quiet" onClick={onSwitch}>Switch host</button></header>
    {screen === 'run' && <div className="workspace-view">
      <section className="composer">
        <div className="mode-row" aria-label="Pipeline mode">{([1, 2, 3] as PipelineMode[]).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{modeLabels[value - 1]}</button>)}</div>
        {mode === 3
          ? <form onSubmit={submitChat}>
              <label htmlFor="chat-input">Ask anything — every answer is drafted, cross-checked by all three CLIs, then reconciled.</label>
              <textarea id="chat-input" value={chatDraft} onChange={event => setChatDraft(event.target.value)} rows={3} />
              <button type="submit" disabled={chat.status === 'thinking'}>{chat.status === 'thinking' ? (chat.label || 'Thinking…') : 'Send'}</button>
            </form>
          : <form onSubmit={submit}>
              <label htmlFor="task">What should your agents build?</label><textarea id="task" value={task} onChange={event => setTask(event.target.value)} required rows={4} />
              <div className="folder-row">
                <input aria-label="Working folder" placeholder="/path/to/project (optional)" value={folder} onChange={event => setFolder(event.target.value)} />
                <button type="button" onClick={() => folder.trim() && connection.fsSelectWorking(folder.trim())}>Use folder</button>
              </div>
              <button type="submit" disabled={pipeline.status === 'running'}>{pipeline.status === 'running' ? 'Pipeline running…' : 'Launch pipeline'}</button>
            </form>}
        <div className="run-meta">
          {mode === 3
            ? <><span>{chat.status === 'thinking' ? (chat.label || 'Thinking…') : chat.status}</span>{chat.lastAgreement && <span>{chat.crossChecked ? `${chat.lastAgreement} agree` : 'not cross-checked'}</span>}</>
            : <><span>{pipeline.label || 'Ready'}</span><span>${totalCost.toFixed(4)}</span>{pipeline.error && <span className="error">{pipeline.error}</span>}</>}
        </div>
      </section>
      {mode === 3
        ? <section className="results chat" aria-live="polite">
            {chat.messages.length === 0 && <p>No messages yet.</p>}
            {chat.messages.map((m, index) => <article className={`chat-msg ${m.role}`} key={index}>
              <h2>{m.role === 'user' ? 'You' : `${m.role}${m.cli ? ` · ${m.cli}` : ''}${m.assessment ? ` · ${m.assessment}` : ''}`}</h2>
              <pre>{m.text}</pre>
            </article>)}
          </section>
        : <section className="results" aria-live="polite"><div className="role-tabs" role="tablist">{roles.map(role => <button role="tab" aria-selected={activeRole === role} key={role} onClick={() => setActiveRole(role)}>{role}</button>)}</div>
            <article className="agent-output"><h2>{activeRole}</h2><pre>{pipeline.outputs[activeRole] || 'Waiting for agent output…'}</pre></article>
            <article className="terminal"><h2>Sandbox terminal</h2><pre>{pipeline.terminal || 'No terminal output yet.'}</pre></article>
            {pipeline.diff && <article className="artifact"><h2>Diff</h2><pre>{pipeline.diff}</pre>
              {pipeline.status === 'completed' && pipeline.runId && <button type="button" onClick={() => connection.apply(pipeline.runId as string)}>Apply to folder</button>}
              {pipeline.applyResult && <p className={pipeline.applyResult.ok ? '' : 'error'}>{pipeline.applyResult.ok ? `Applied ${(pipeline.applyResult.applied as string[] | undefined)?.length ?? 0} file(s)${pipeline.applyResult.branch ? ` on ${pipeline.applyResult.branch}` : ''}` : `Apply blocked: ${String(pipeline.applyResult.reason ?? '')}`}</p>}
            </article>}
            {pipeline.workspace && <article className="artifact"><h2>Workspace</h2><pre>{JSON.stringify(pipeline.workspace, null, 2)}</pre></article>}
          </section>}
    </div>}
    {screen === 'history' && <section className="page"><h1>Run history</h1>{history.length ? history.map((run, index) => <article className="history-card" key={`${run.runId}-${index}`}><strong>{run.status}</strong><span>{run.runId}</span><span>{run.elapsed ?? 0}s</span></article>) : <p>No completed runs this session.</p>}</section>}
    {screen === 'settings' && <section className="page"><h1>Agent settings</h1><div className="settings-grid">{roles.map(role => <fieldset key={role}><legend>{role}</legend><label>Provider<input value={config[role].provider} onChange={event => setConfig(current => ({ ...current, [role]: { ...current[role], provider: event.target.value } }))} /></label><label>Model<input value={config[role].model} onChange={event => setConfig(current => ({ ...current, [role]: { ...current[role], model: event.target.value } }))} /></label></fieldset>)}</div></section>}
    {screen === 'diagnostics' && <section className="page"><h1>Diagnostics</h1><dl><dt>Server</dt><dd>{host.url}</dd><dt>Connection</dt><dd>{connectionState}</dd><dt>Protocol</dt><dd>{PROTOCOL_VERSION}</dd><dt>Run ID</dt><dd>{pipeline.runId ?? 'none'}</dd><dt>Buffered terminal</dt><dd>{pipeline.terminal.length.toLocaleString()} characters</dd></dl></section>}
  </main>;
}
