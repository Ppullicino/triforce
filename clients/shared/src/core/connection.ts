import { PROTOCOL_VERSION, type ServerEvent } from '@triforce/protocol';
import { normalizeHostUrl } from './host-url';

export type ConnectionState = 'connecting' | 'connected' | 'unauthorized' | 'incompatible' | 'unreachable' | 'disconnected' | 'reconnecting';
type StateListener = (state: ConnectionState) => void;
type EventListener = (event: ServerEvent) => void;

interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'message' | 'error', listener: (event: Event) => void): void;
}

export interface ConnectionOptions {
  fetch?: typeof fetch;
  createSocket?: (url: string) => SocketLike;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  maxReconnectAttempts?: number;
}

export class TriforceConnection {
  state: ConnectionState = 'disconnected';
  private socket: SocketLike | null = null;
  private reconnectAttempts = 0;
  private reconnectEnabled = false;
  private lastRunId: string | null = null;
  private lastEventId = 0;
  private readonly stateListeners = new Set<StateListener>();
  private readonly eventListeners = new Set<EventListener>();
  private readonly fetcher: typeof fetch;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  private readonly maxReconnectAttempts: number;

  constructor(readonly serverUrl: string, options: ConnectionOptions = {}) {
    this.fetcher = options.fetch ?? fetch;
    this.createSocket = options.createSocket ?? (url => new WebSocket(url) as unknown as SocketLike);
    this.schedule = options.schedule ?? setTimeout;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 6;
  }

  onState(listener: StateListener) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
  onEvent(listener: EventListener) { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }

  async connect(token?: string) {
    const host = normalizeHostUrl(this.serverUrl);
    this.transition('connecting');
    try {
      if (token) {
        const login = await this.fetcher(`${host.apiUrl}/session`, {
          method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }),
        });
        if (login.status === 401) return this.transition('unauthorized');
        if (!login.ok) throw new Error(`Authentication failed (${login.status})`);
      }
      const response = await this.fetcher(`${host.apiUrl}/capabilities`, { credentials: 'include' });
      if (response.status === 401) return this.transition('unauthorized');
      if (!response.ok) throw new Error(`Server unavailable (${response.status})`);
      const info = await response.json() as { protocolMajor?: number };
      if (info.protocolMajor !== 1) return this.transition('incompatible');
      this.reconnectEnabled = true;
      this.openSocket(host.webSocketUrl);
    } catch {
      this.transition('unreachable');
    }
  }

  disconnect() {
    this.reconnectEnabled = false;
    this.socket?.close();
    this.socket = null;
    this.transition('disconnected');
  }

  private openSocket(url: string) {
    const socket = this.createSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.transition('connected');
      socket.send(JSON.stringify({ type: 'capabilities', protocolVersion: PROTOCOL_VERSION }));
      if (this.lastRunId) socket.send(JSON.stringify({ type: 'subscribe', protocolVersion: PROTOCOL_VERSION, runId: this.lastRunId, afterEventId: this.lastEventId }));
    });
    socket.addEventListener('message', event => this.handleMessage(event as MessageEvent));
    socket.addEventListener('close', () => this.handleClose(url));
    socket.addEventListener('error', () => undefined);
  }

  private handleMessage(event: MessageEvent) {
    let message: ServerEvent;
    try { message = JSON.parse(String(event.data)) as ServerEvent; }
    catch { return; }
    if (typeof message.runId === 'string') this.lastRunId = message.runId;
    if (typeof message.eventId === 'number') this.lastEventId = Math.max(this.lastEventId, message.eventId);
    if (message.type === 'protocol_error' && message.code === 'INCOMPATIBLE_VERSION') this.transition('incompatible');
    for (const listener of this.eventListeners) listener(message);
  }

  private handleClose(url: string) {
    if (!this.reconnectEnabled) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return this.transition('unreachable');
    this.transition('reconnecting');
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempts++);
    this.schedule(() => this.openSocket(url), delay);
  }

  private transition(state: ConnectionState) {
    this.state = state;
    for (const listener of this.stateListeners) listener(state);
  }
}
