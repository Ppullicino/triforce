import { randomUUID } from 'node:crypto';

const OPEN = 1;

export class RunRegistry {
  constructor({ maxRuns = 50, maxEventsPerRun = 600, maxEventBytes = 2 * 1024 * 1024 } = {}) {
    this.maxRuns = maxRuns;
    this.maxEventsPerRun = maxEventsPerRun;
    this.maxEventBytes = maxEventBytes;
    this.runs = new Map();
  }

  get activeRun() {
    return [...this.runs.values()].find(run => run.status === 'running') ?? null;
  }

  get(runId) { return this.runs.get(runId) ?? null; }
  list() { return [...this.runs.values()].map(run => this.snapshot(run)); }

  snapshot(run) {
    return {
      id: run.id, task: run.task, mode: run.mode, status: run.status,
      createdAt: run.createdAt, updatedAt: run.updatedAt,
      lastEventId: run.nextEventId - 1, droppedEvents: run.droppedEvents,
    };
  }

  start(input, execute) {
    if (this.activeRun) throw new Error('Another terminal or browser pipeline is already running');
    const now = new Date().toISOString();
    const run = {
      id: randomUUID(), task: input.task, config: input.config, mode: input.mode,
      status: 'running', createdAt: now, updatedAt: now,
      events: [], eventBytes: 0, nextEventId: 1, droppedEvents: 0,
      subscribers: new Set(), completion: null, hasError: false,
    };
    this.runs.set(run.id, run);
    this.pruneRuns();
    run.completion = Promise.resolve()
      .then(() => execute(this.socketFor(run)))
      .then(() => this.finish(run, run.hasError ? 'failed' : 'completed'))
      .catch(error => {
        this.publish(run, { type: 'error', stage: 'architect', message: error.message });
        this.finish(run, 'failed');
      });
    return run;
  }

  socketFor(run) {
    return {
      readyState: OPEN,
      send: raw => this.publish(run, typeof raw === 'string' ? JSON.parse(raw) : raw),
    };
  }

  publish(run, event) {
    if (event.type === 'error') run.hasError = true;
    const enriched = { ...event, runId: run.id, eventId: run.nextEventId++, timestamp: new Date().toISOString() };
    const raw = JSON.stringify(enriched);
    const bytes = Buffer.byteLength(raw);
    if (bytes <= this.maxEventBytes) {
      run.events.push({ event: enriched, raw, bytes });
      run.eventBytes += bytes;
      while (run.events.length > this.maxEventsPerRun || run.eventBytes > this.maxEventBytes) {
        const removed = run.events.shift();
        if (!removed) break;
        run.eventBytes -= removed.bytes;
        run.droppedEvents++;
      }
    } else run.droppedEvents++;
    run.updatedAt = enriched.timestamp;
    for (const ws of run.subscribers) {
      if (ws.readyState === OPEN) ws.send(raw);
      else run.subscribers.delete(ws);
    }
    return enriched;
  }

  subscribe(run, ws, afterEventId = 0) {
    run.subscribers.add(ws);
    ws.send(JSON.stringify({ type: 'run_snapshot', run: this.snapshot(run) }));
    for (const item of run.events) {
      if (item.event.eventId > afterEventId && ws.readyState === OPEN) ws.send(item.raw);
    }
    return () => run.subscribers.delete(ws);
  }

  finish(run, status) {
    run.status = status;
    run.updatedAt = new Date().toISOString();
    this.publish(run, { type: 'run_state', status });
  }

  pruneRuns() {
    while (this.runs.size > this.maxRuns) {
      const candidate = [...this.runs.values()].find(run => run.status !== 'running');
      if (!candidate) break;
      this.runs.delete(candidate.id);
    }
  }
}
