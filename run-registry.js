import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';

const OPEN = 1;

export class RunRegistry {
  constructor({ maxRuns = 50, maxEventsPerRun = 600, maxEventBytes = 2 * 1024 * 1024, runsDir } = {}) {
    this.maxRuns = maxRuns;
    this.maxEventsPerRun = maxEventsPerRun;
    this.maxEventBytes = maxEventBytes;
    
    this.runsDir = runsDir || process.env.TRIFORCE_RUNS_DIR;
    if (!this.runsDir) {
      if (process.env.NODE_ENV === 'test') {
        this.runsDir = join(os.tmpdir(), `triforce-test-runs-${randomUUID()}`);
      } else {
        this.runsDir = join(os.homedir(), '.local/share/triforce/runs');
      }
    }
    
    mkdirSync(this.runsDir, { recursive: true });
    this.indexPath = join(this.runsDir, 'index.json');
    this.writeQueue = Promise.resolve();
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

  async load() {
    let indexData = { runs: [] };
    if (existsSync(this.indexPath)) {
      try {
        const raw = await fs.readFile(this.indexPath, 'utf8');
        indexData = JSON.parse(raw);
      } catch (err) {
        console.error('Failed to parse runs index.json, starting fresh:', err);
      }
    }
    
    const now = new Date().toISOString();
    let indexUpdated = false;

    for (const runData of (indexData.runs || [])) {
      const run = {
        id: runData.id,
        task: runData.task,
        config: runData.config,
        mode: runData.mode,
        status: runData.status,
        createdAt: runData.createdAt,
        updatedAt: runData.updatedAt,
        nextEventId: runData.nextEventId ?? 1,
        droppedEvents: runData.droppedEvents ?? 0,
        events: [],
        eventBytes: 0,
        subscribers: new Set(),
        completion: null,
        hasError: runData.status === 'failed',
        writeQueue: Promise.resolve(),
      };
      
      const jsonlPath = join(this.runsDir, `${run.id}.jsonl`);

      if (run.status === 'running') {
        run.status = 'failed';
        run.hasError = true;
        run.updatedAt = now;
        
        const syntheticEvent = {
          type: 'run_state',
          status: 'failed',
          runId: run.id,
          eventId: run.nextEventId++,
          timestamp: now,
        };
        
        const raw = JSON.stringify(syntheticEvent);
        await fs.appendFile(jsonlPath, raw + '\n', { mode: 0o600 });
        indexUpdated = true;
      }
      
      if (existsSync(jsonlPath)) {
        try {
          const content = await fs.readFile(jsonlPath, 'utf8');
          const lines = content.split('\n').filter(Boolean);
          for (const line of lines) {
            const event = JSON.parse(line);
            const bytes = Buffer.byteLength(line);
            if (bytes <= this.maxEventBytes) {
              run.events.push({ event, raw: line, bytes });
              run.eventBytes += bytes;
              
              while (run.events.length > this.maxEventsPerRun || run.eventBytes > this.maxEventBytes) {
                const removed = run.events.shift();
                if (!removed) break;
                run.eventBytes -= removed.bytes;
                run.droppedEvents++;
              }
            } else {
              run.droppedEvents++;
            }
          }
        } catch (err) {
          console.error(`Failed to restore events for run ${run.id}:`, err);
        }
      }
      
      this.runs.set(run.id, run);
    }

    if (indexUpdated) {
      await this._saveIndex();
    }
  }

  async _saveIndex() {
    const list = [...this.runs.values()].map(run => ({
      id: run.id,
      task: run.task,
      config: run.config,
      mode: run.mode,
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      nextEventId: run.nextEventId,
      droppedEvents: run.droppedEvents,
    }));
    await fs.writeFile(this.indexPath, JSON.stringify({ runs: list }, null, 2), { mode: 0o600 });
  }

  saveIndex() {
    this.writeQueue = this.writeQueue.then(() => this._saveIndex()).catch(() => {});
    return this.writeQueue;
  }

  start(input, execute) {
    if (this.activeRun) throw new Error('Another terminal or browser pipeline is already running');
    const now = new Date().toISOString();
    const run = {
      id: randomUUID(), task: input.task, config: input.config, mode: input.mode,
      status: 'running', createdAt: now, updatedAt: now,
      events: [], eventBytes: 0, nextEventId: 1, droppedEvents: 0,
      subscribers: new Set(), completion: null, hasError: false,
      writeQueue: Promise.resolve(),
    };
    this.runs.set(run.id, run);
    this.saveIndex();
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

    const jsonlPath = join(this.runsDir, `${run.id}.jsonl`);
    run.writeQueue = run.writeQueue.then(async () => {
      try {
        await fs.appendFile(jsonlPath, raw + '\n', { mode: 0o600 });
      } catch (err) {
        console.error(`Failed to append event to JSONL for run ${run.id}:`, err);
      }
    });

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
    this.saveIndex();
  }

  pruneRuns() {
    while (this.runs.size > this.maxRuns) {
      const candidate = [...this.runs.values()].find(run => run.status !== 'running');
      if (!candidate) break;
      this.runs.delete(candidate.id);
      
      const runFile = join(this.runsDir, `${candidate.id}.jsonl`);
      this.writeQueue = this.writeQueue.then(async () => {
        try {
          await fs.unlink(runFile);
        } catch {}
        await this._saveIndex();
      });
    }
  }

  async flush() {
    await this.writeQueue;
    for (const run of this.runs.values()) {
      await run.writeQueue;
    }
  }
}
