/**
 * Route-level harness for the dsh-session-delete Host half.
 *
 * Runs the real route handler against a fake Host context (fake agent-loop
 * factory, fake persistence, temp directory) so deletion and release behaviour
 * can be checked without starting DeepSeek Harness.
 *
 *   node tests/route.test.mjs skills/dsh-delete-session/payload/dsh-session-delete/index.js
 *
 * Covers: captured lifecycle handle → delete; missing handle → refuse and keep
 * the files; dryRun; unknown session; inspect; teardown that never settles.
 * The last case waits out the release budget (~20 s).
 */
import { mkdtemp, mkdir, writeFile, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN = pathToFileURL(process.argv[2]).href;
const mod = await import(PLUGIN);

function makeReq(method, url, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { for (const chunk of payload) yield chunk; },
  };
}
function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b.toString(); },
  };
}

async function scenario(name, setup, run) {
  const root = await mkdtemp(join(tmpdir(), 'dsd-'));
  const sessionId = 'session-test-0001';
  const dir = join(root, 'grp', sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'session.v4.jsonl'), 'x');

  const agents = new Map();
  const sessions = new Map();
  let handler;
  const events = [];
  const captured = new Map();

  const loop = {
    async createAgent(_owner, options) {
      const agent = { id: options.sessionId, cancel() {}, scope: { dispose: async () => {} } };
      const dispose = async () => {
        // Mirrors the real teardown: detach agent + session registries.
        agents.delete(options.sessionId);
        sessions.delete(options.sessionId);
      };
      return { agent, dispose };
    },
    async resume() { throw new Error('unused'); },
    async setupAndPublish(_o, id) {
      const agent = { id, cancel() {}, scope: { dispose: async () => {} } };
      return { agent, dispose: async () => { agents.delete(id); sessions.delete(id); } };
    },
  };

  const persistence = {
    root,
    tracker: { openHandles: new Set() },
    locate: (header) => ({ kind: 'jsonl', path: join(root, 'grp', header.id, 'session.v4.jsonl') }),
    async stat(id) {
      try {
        await stat(join(root, 'grp', id, 'session.v4.jsonl'));
      } catch { return undefined; }
      return { header: { id, cwd: '/tmp' }, revision: 'r1' };
    },
  };

  const ctx = {
    logger: { info() {}, warn() {}, debug() {} },
    agents: { get: (id) => agents.get(id) },
    sessions: { get: (id) => sessions.get(id) },
    sessionPersistence: persistence,
    workspaceRegistry: {
      list: () => [{
        id: 'ws1',
        title: 'tmp',
        sessionIds: [sessionId],
        detachSession: async (id) => { events.push('detach:' + id); },
      }],
      unarchiveSession: async () => {},
      unpinSession: async () => {},
    },
    get: (name) => (name === 'agentLoop' ? loop : undefined),
    waterfall: async () => [],
    parallel: async () => {},
    emit: (name, id) => { events.push(name + ':' + id); },
    effect: (fn) => { const d = fn(); return () => (typeof d === 'function' ? d() : undefined); },
    on: () => () => {},
    inject: () => {},
    webServer: { register: ({ handler: h }) => { handler = h; return () => {}; } },
  };

  mod.apply(ctx);
  await setup({ agents, sessions, sessionId, dir, loop, captured });
  const res = await run(handler, makeRes, sessionId);
  const exists = await stat(dir).then(() => true, () => false);
  const leftover = await readdir(root).then((x) => x.join(','), () => '');
  return { name, status: res.statusCode, payload: JSON.parse(res.body || '{}'), exists, events, leftover };
}

const results = [];
const mod2 = await import(PLUGIN);

// 1. live agent with captured lifecycle → deletes
results.push(await scenario('live+captured', async ({ agents, sessions, sessionId, loop }) => {
  agents.set(sessionId, { id: sessionId });
  sessions.set(sessionId, { id: sessionId });
  await loop.createAgent({}, { sessionId }); // capture through the wrapper
}, async (handler, makeRes, sessionId) => {
  const res = makeRes();
  await handler(makeReq('POST', '/dsh-session-delete/delete', { sessionId, force: true }), res);
  return res;
}));

// 2. live agent without capture → must fail, must NOT delete the directory
results.push(await scenario('live+uncaptured', async ({ agents, sessions, sessionId }) => {
  agents.set(sessionId, { id: sessionId, cancel() {}, scope: { dispose: async () => {} } });
  sessions.set(sessionId, { id: sessionId });
}, async (handler, makeRes, sessionId) => {
  const res = makeRes();
  await handler(makeReq('POST', '/dsh-session-delete/delete', { sessionId, force: true }), res);
  return res;
}));

// 3. dryRun never removes
results.push(await scenario('dryRun', async ({ agents, sessions, sessionId, loop }) => {
  agents.set(sessionId, { id: sessionId });
  sessions.set(sessionId, { id: sessionId });
  await loop.createAgent({}, { sessionId });
}, async (handler, makeRes, sessionId) => {
  const res = makeRes();
  await handler(makeReq('POST', '/dsh-session-delete/delete', { sessionId, dryRun: true }), res);
  return res;
}));

// 4. unknown session → 404
results.push(await scenario('missing', async () => {}, async (handler, makeRes) => {
  const res = makeRes();
  await handler(makeReq('POST', '/dsh-session-delete/delete', { sessionId: 'session-nope', force: true }), res);
  return res;
}));

// 5. inspect route
results.push(await scenario('inspect', async ({ agents, sessions, sessionId, loop }) => {
  agents.set(sessionId, { id: sessionId });
  sessions.set(sessionId, { id: sessionId });
  await loop.createAgent({}, { sessionId });
}, async (handler, makeRes, sessionId) => {
  const res = makeRes();
  await handler(makeReq('GET', '/dsh-session-delete/inspect?sessionId=' + sessionId), res);
  return res;
}));


// 6. teardown that never settles → 409, directory preserved, bounded by the release budget
results.push(await scenario('hanging-teardown', async ({ agents, sessions, sessionId }) => {
  agents.set(sessionId, { id: sessionId });
  sessions.set(sessionId, { id: sessionId });
  const registry = globalThis[Symbol.for('dsh-session-delete.lifecycle')];
  registry.set(sessionId, () => new Promise(() => {}));
}, async (handler, makeRes, sessionId) => {
  const started = Date.now();
  const keepAlive = setInterval(() => {}, 1000);
  const res = makeRes();
  await handler(makeReq('POST', '/dsh-session-delete/delete', { sessionId, force: true }), res);
  res.elapsed = Date.now() - started;
  clearInterval(keepAlive);
  return res;
}));

console.log(JSON.stringify(results, null, 2));