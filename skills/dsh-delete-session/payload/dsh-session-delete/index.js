/**
 * dsh-session-delete — Host half.
 *
 * Adds the Session deletion capability the Harness intentionally does not ship:
 * a Session log plus its workspace accounting can be removed, while the
 * packaged core keeps treating archival as non-destructive.
 *
 * One Client-callable entry point (the plugin's own Host HTTP route) performs
 * the single deletion operation:
 *
 *   1. the Session must exist in session persistence;
 *   2. a Session that is still live in this process is torn down exactly the
 *      way an application quit tears it down (see `releaseLiveAgent`): its
 *      running work is stopped, its Agent lifecycle is disposed (cancelling the
 *      turn, waiting for idle, closing the persistence write handle, detaching
 *      the Agent and Session stores), so nothing writes to the log afterwards;
 *   3. its artifact directory is resolved through the persistence backend's own
 *      `locate()` hook and validated to stay inside the configured session root;
 *   4. the directory is removed, then the Workspace accounting slot plus the
 *      archive and pin sets are dropped, and every connected page is told.
 *
 * Why the captured lifecycle handle matters: the Harness never unloads an open
 * Session on its own — an Agent stays registered for the life of the process.
 * `ctx.agents` exposes no "unload one agent" call, and disposing the Agent's
 * scope fiber alone does NOT run the lifecycle teardown (that closure is owned
 * by the agent-loop transaction, not by the scope). The only supported teardown
 * is the `{ agent, dispose }` handle `agents.create()` / `agents.resume()`
 * resolve to — which the Session controller drops when it keeps just `.agent`.
 * This half therefore wraps the loop factory's two handle-returning entry
 * points at load time and keeps each handle until its Session is deleted. The
 * handle closes the write handle and detaches both registries; without it a
 * live Session's log cannot be removed on Windows at all (the file is open).
 *
 * @module dsh-session-delete
 */
import { rm, stat as statPath } from 'node:fs/promises';
import { basename, dirname, sep } from 'node:path';

/** Cordis plugin name. */
export const name = 'dsh-session-delete';

/** Services this plugin refuses to activate without. */
export const inject = ['webServer', 'sessionPersistence', 'sessions', 'agents', 'workspaceRegistry'];

/** Host route prefix owned by this plugin. */
const ROUTE_PREFIX = '/dsh-session-delete';

/** Upper bound for a request body; the only body is one Session identity. */
const MAX_BODY_BYTES = 8 * 1024;

/** Build marker reported by `GET /health`, so a reload is observable. */
const BUILD = 7;

/** Session identities are one safe path segment; the backend encodes them 1:1. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;

/** How long a live Agent gets to finish its teardown before the request fails. */
const RELEASE_TIMEOUT_MS = 20_000;

/** Poll interval while waiting for an Agent's teardown to settle. */
const RELEASE_POLL_MS = 50;

/** Short grace after a completed teardown for the registries to settle. */
const RELEASE_SETTLE_MS = 3_000;

/** How long to wait for one retry after a locked log directory. */
const REMOVE_RETRY_MS = 400;

/**
 * Session id → the lifecycle disposer `agents.create()/resume()` resolved to.
 *
 * Kept on the process global so a plugin reload (Cordis HMR) does not orphan
 * the handles of Agents that are already live: a reloaded module must still be
 * able to tear down Sessions it did not create.
 *
 * The handle is single-shot: the first caller takes it out of the map, so a
 * retry after a partial teardown cannot run the same teardown twice.
 */
const LIFECYCLE_KEY = Symbol.for('dsh-session-delete.lifecycle');
const CAPTURED_KEY = Symbol.for('dsh-session-delete.captured');

const lifecycleHandles = (globalThis[LIFECYCLE_KEY] ??= new Map());

/** Which factory methods this build managed to instrument (diagnostics only). */
const captured = (globalThis[CAPTURED_KEY] ??= {
  createAgent: false,
  resume: false,
  setupAndPublish: false,
});

/** A failure carrying the HTTP status and stable code the Client shows. */
class DeleteError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sendJson(res, status, payload) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', String(body.length));
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new DeleteError(413, 'request/too-large', '请求体过大');
    chunks.push(chunk);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new DeleteError(400, 'request/invalid-json', '请求体不是合法 JSON');
  }
}

/**
 * Reject a request that a browser page other than the app itself could forge.
 * A same-origin `fetch` from the Web GUI sends neither header cross-site; a
 * cross-site form post cannot send `application/json` without a preflight.
 */
function assertSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
    throw new DeleteError(403, 'request/cross-site', '拒绝跨站请求');
  }
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin === 'string' && origin !== 'null' && typeof host === 'string') {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new DeleteError(403, 'request/bad-origin', 'Origin 头非法');
    }
    if (originHost !== host) throw new DeleteError(403, 'request/cross-site', '拒绝跨站请求');
  }
}

/** Is the Session materialized or driven by this Host process right now? */
function liveReason(ctx, sessionId) {
  if (ctx.agents.get(sessionId) !== undefined) return 'agent';
  if (ctx.sessions.get(sessionId) !== undefined) return 'session';
  return undefined;
}

/** Ask the shipped activity providers what work a Session still has. */
async function sessionActivity(ctx, sessionId) {
  if (typeof ctx.waterfall !== 'function') return [];
  const activity = await ctx.waterfall(
    'workspace/session-activity',
    { sessionId },
    () => Promise.resolve([]),
  );
  return Array.isArray(activity) ? activity : [];
}

/**
 * Instrument the agent-loop factory so every live Agent's teardown stays reachable.
 *
 * `agents.create()` delegates to `agentLoop.createAgent()`, and `agents.resume()`
 * to `agentLoop.resume()`; both resolve to `{ agent, dispose }`. Both also funnel
 * through `setupAndPublish()`, which is wrapped as well so a future entry point
 * cannot silently escape capture. Wrapping is idempotent and never changes the
 * resolved value.
 *
 * @param ctx - the plugin's Host context.
 * @returns whether any entry point is now instrumented.
 */
function installLifecycleCapture(ctx) {
  let loop;
  try {
    loop = ctx.get('agentLoop');
  } catch {
    loop = undefined;
  }
  if (loop === undefined || loop === null || typeof loop !== 'object') return false;
  const record = (handle) => {
    const id = handle?.agent?.id;
    const dispose = handle?.dispose;
    if (typeof id === 'string' && typeof dispose === 'function') lifecycleHandles.set(id, dispose);
    return handle;
  };
  let instrumented = false;
  for (const method of ['createAgent', 'resume', 'setupAndPublish']) {
    const original = loop[method];
    if (typeof original !== 'function' || original.__dsdCapture === true) {
      if (original?.__dsdCapture === true) instrumented = true;
      continue;
    }
    const wrapped = async function (...args) {
      return record(await original.apply(this, args));
    };
    wrapped.__dsdCapture = true;
    try {
      loop[method] = wrapped;
      captured[method] = true;
      instrumented = true;
    } catch {
      /* a frozen factory keeps its original method: the scope fallback still runs. */
    }
  }
  return instrumented;
}

/** Wait until the Agent and Session registries no longer hold `sessionId`. */
async function waitForRelease(ctx, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ctx.agents.get(sessionId) === undefined && ctx.sessions.get(sessionId) === undefined) return true;
    await new Promise((resolve) => setTimeout(resolve, RELEASE_POLL_MS));
  }
  return ctx.agents.get(sessionId) === undefined && ctx.sessions.get(sessionId) === undefined;
}

/**
 * Last-resort teardown for an Agent whose lifecycle handle was never captured
 * (an Agent created before this plugin loaded).
 *
 * Cancelling the turn and disposing the Agent's scope stops its work and closes
 * its scoped effects; it cannot detach the `agents`/`sessions` stores, which is
 * why `waitForRelease` may still time out. That failure is reported honestly
 * instead of removing a log a live Agent may still write.
 */
async function releaseByScope(agent) {
  try {
    agent.cancel?.({ kind: 'disposed' });
  } catch {
    /* cancellation is best effort */
  }
  try {
    if (typeof agent.scope?.dispose === 'function') await agent.scope.dispose();
    else if (typeof agent.ctx?.fiber?.dispose === 'function') await agent.ctx.fiber.dispose();
  } catch {
    /* the registry check below reports the outcome */
  }
}

/** The refusal used when a live Session could not be unloaded in time. */
function releaseTimeout(ctx, sessionId, release) {
  return new DeleteError(
    409,
    'session/release-timeout',
    '这个会话没能被卸载（可能还有未结束的轮次）。请等它空闲后重试；若一直失败，重启应用后再删。',
    {
      live: liveReason(ctx, sessionId),
      agent: ctx.agents.get(sessionId) !== undefined,
      session: ctx.sessions.get(sessionId) !== undefined,
      release,
    },
  );
}

/**
 * Tear one live Session down so its log is quiescent, then prove it is gone.
 *
 * Prefers the Agent's captured lifecycle handle — the same teardown an
 * application quit performs — and only falls back to scope disposal for an
 * Agent created before capture was installed.
 *
 * @param ctx - the plugin's Host context.
 * @param sessionId - the Session to release.
 * @returns how it was released ("lifecycle" | "scope" | "session"), or
 *   `undefined` when nothing was live.
 * @throws {DeleteError} `session/release-timeout` when the registries keep it.
 */
async function releaseLiveAgent(ctx, sessionId) {
  const agent = ctx.agents.get(sessionId);
  const session = ctx.sessions.get(sessionId);
  if (agent === undefined && session === undefined) return undefined;
  const dispose = lifecycleHandles.get(sessionId);
  lifecycleHandles.delete(sessionId);
  let mode;
  if (typeof dispose === 'function') {
    mode = 'lifecycle';
    // The teardown itself can stall on a turn that never reaches idle, so it is
    // raced against the release budget: a stalled teardown keeps running in the
    // background, but the request fails instead of hanging forever.
    let settled = false;
    const running = Promise.resolve()
      .then(() => dispose())
      .then(
        () => {
          settled = true;
        },
        (error) => {
          // Teardown detaches both registries in a finally block, so a throwing
          // close/drain does not by itself mean the Session is still live.
          settled = true;
          ctx.logger?.warn?.(
            `dsh-session-delete: lifecycle teardown for ${sessionId} reported: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );
    const timer = new Promise((resolve) => {
      const handle = setTimeout(resolve, RELEASE_TIMEOUT_MS);
      handle.unref?.();
    });
    await Promise.race([running, timer]);
    if (!settled) throw releaseTimeout(ctx, sessionId, mode);
  } else if (agent !== undefined) {
    mode = 'scope';
    ctx.logger?.warn?.(
      `dsh-session-delete: no captured lifecycle for ${sessionId}; falling back to scope disposal`,
    );
    await releaseByScope(agent);
  } else {
    mode = 'session';
    if (typeof session.ctx?.fiber?.dispose === 'function') {
      try {
        await session.ctx.fiber.dispose();
      } catch {
        /* reported by the wait below */
      }
    }
  }
  if (!(await waitForRelease(ctx, sessionId, mode === 'lifecycle' ? RELEASE_SETTLE_MS : RELEASE_TIMEOUT_MS))) {
    throw releaseTimeout(ctx, sessionId, mode);
  }
  return mode;
}

/** Which Workspace accounts for this Session, if any. */
function accountingOf(ctx, sessionId) {
  for (const workspace of ctx.workspaceRegistry.list()) {
    if (workspace.sessionIds.includes(sessionId)) {
      return { id: workspace.id, title: workspace.title ?? null };
    }
  }
  return undefined;
}

/**
 * Tell every connected client the Session is gone.
 *
 * The Client keeps one Session-list snapshot that it updates from the Host's
 * `api-session/added` / `api-session/removed` relay (the same pair the core
 * emits from `session/created` and `session/disposed`), plus a full baseline
 * pull on reconnect. Deleting the log behind the persistence API emits
 * nothing, so without this notification the client keeps the stale summary:
 * it is no longer in any Workspace's account, so the sidebar files it under
 * its browser-local "Ungrouped" bucket and that empty group stays visible.
 */
function notifyRemoved(ctx, sessionId) {
  try {
    if (typeof ctx.emit === 'function') ctx.emit('api-session/removed', sessionId);
    return true;
  } catch (error) {
    ctx.logger?.warn?.(
      `dsh-session-delete: removed ${sessionId} on disk but could not notify clients: ${String(error)}`,
    );
    return false;
  }
}

/** Drop the Session from every Workspace account, its archives and its pins. */
async function forgetAccounting(ctx, sessionId) {
  const registry = ctx.workspaceRegistry;
  let detachedFrom;
  for (const workspace of registry.list()) {
    if (!workspace.sessionIds.includes(sessionId)) continue;
    if (typeof workspace.detachSession !== 'function') {
      throw new DeleteError(
        500,
        'accounting/unsupported',
        '当前 Harness 版本的工作区注册表不支持移除会话记账，已保留磁盘数据',
      );
    }
    await workspace.detachSession(sessionId);
    detachedFrom = workspace.title ?? workspace.id;
  }
  // Unarchiving and unpinning accept an unknown id: removal cannot introduce
  // an unknown reference, so both are safe after the log is gone.
  const cleanup = [];
  try {
    await registry.unarchiveSession(sessionId);
  } catch (error) {
    cleanup.push(`unarchive: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await registry.unpinSession(sessionId);
  } catch (error) {
    cleanup.push(`unpin: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { detachedFrom, cleanup };
}

/** Resolve the Session's artifact directory through the backend's own hook. */
function artifactDirectory(persistence, header, sessionId) {
  if (typeof persistence.locate !== 'function') {
    throw new DeleteError(
      501,
      'storage/unsupported',
      '当前会话存储后端不支持定位会话文件，无法删除',
    );
  }
  const located = persistence.locate(header);
  const logPath = typeof located?.path === 'string' ? located.path : undefined;
  if (logPath === undefined) {
    throw new DeleteError(500, 'storage/unresolved', '无法解析会话文件路径');
  }
  const directory = dirname(logPath);
  if (basename(directory) !== sessionId) {
    throw new DeleteError(500, 'storage/mismatch', '会话目录与会话标识不一致，已中止删除');
  }
  const root = typeof persistence.root === 'string' ? persistence.root : undefined;
  if (root !== undefined && !directory.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
    throw new DeleteError(500, 'storage/escaping-root', '会话目录不在会话根目录内，已中止删除');
  }
  return directory;
}

/** The log directory an open write handle is still holding, if any. */
function openWriteHandles(persistence, sessionId) {
  try {
    const handles = persistence?.tracker?.openHandles;
    if (handles === undefined) return [];
    const list = [];
    for (const handle of handles) {
      if (handle?.id !== sessionId) continue;
      list.push({ access: handle.access ?? null, open: handle.closing === undefined });
    }
    return list;
  } catch {
    return [];
  }
}

/** Remove a directory, retrying once: a just-closed handle can linger briefly. */
async function removeDirectory(directory) {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (first) {
    await new Promise((resolve) => setTimeout(resolve, REMOVE_RETRY_MS));
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (second) {
      const code = second?.code ?? first?.code;
      throw new DeleteError(
        500,
        'storage/locked',
        code === 'EBUSY' || code === 'EPERM'
          ? '会话日志仍被占用，删除未完成（可能还有进程持有它）。请重试或重启应用后再删。'
          : `无法删除会话目录：${second instanceof Error ? second.message : String(second)}`,
      );
    }
  }
}

/** Does the artifact still exist after the removal? */
async function directoryExists(directory) {
  try {
    return (await statPath(directory)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Delete one stored Session: its log directory, its Workspace accounting slot,
 * and its archive and pin membership.
 *
 * @param ctx - the plugin's Host context.
 * @param sessionId - the Session identity to delete.
 * @param options - `dryRun` resolves the target without removing anything;
 *   `force` releases a live Agent and stops running work before deleting.
 * @returns the deletion receipt.
 * @throws {DeleteError} with a stable code when the Session is unknown, busy,
 *   or cannot be located safely.
 */
async function deleteSession(ctx, sessionId, options = {}) {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new DeleteError(400, 'session/invalid-id', '会话标识非法');
  }
  const persistence = ctx.sessionPersistence;
  const snapshot = await persistence.stat(sessionId);
  if (snapshot === undefined) {
    throw new DeleteError(404, 'session/not-found', '该会话已不存在');
  }
  const live = liveReason(ctx, sessionId);
  const activity = await sessionActivity(ctx, sessionId);
  if (live !== undefined || activity.length > 0) {
    // The user asked for exactly this Session, so the caller may force it: the
    // client already switched the page away, and this route tears the Agent
    // down the way an app quit would. Without `force` the refusal explains why
    // and lists the work.
    if (options.force !== true) {
      throw new DeleteError(
        409,
        'session/busy',
        live !== undefined
          ? '该会话正在打开或有未释放的会话实例，确认后会先关闭它再删除'
          : '该会话仍有正在运行的工作，确认后会先停止并删除',
        {
          ...(live === undefined ? {} : { live }),
          ...(activity.length === 0
            ? {}
            : { activity: activity.map((entry) => (typeof entry === 'string' ? entry : entry?.kind ?? 'work')) }),
          forceable: true,
        },
      );
    }
    // Force: stop running work first (the registry knows every provider), then
    // release the live Agent so its persistence write handle closes.
    if (activity.length > 0 && typeof ctx.parallel === 'function') {
      try {
        await ctx.parallel('workspace/session-stop', { sessionId });
      } catch (error) {
        ctx.logger?.warn?.(`dsh-session-delete: stop request failed for ${sessionId}: ${String(error)}`);
      }
    }
    if (live !== undefined) await releaseLiveAgent(ctx, sessionId);
  }
  const directory = artifactDirectory(persistence, snapshot.header, sessionId);
  const account = accountingOf(ctx, sessionId);
  if (options.dryRun === true) {
    return {
      sessionId,
      directory,
      dryRun: true,
      workspace: account ?? null,
      live: live ?? null,
      activity: activity.map((entry) => (typeof entry === 'string' ? entry : entry?.kind ?? 'work')),
      captured: lifecycleHandles.has(sessionId),
      revision: String(snapshot.revision),
    };
  }
  await removeDirectory(directory);
  if (await directoryExists(directory)) {
    throw new DeleteError(500, 'storage/persists', '会话目录仍然存在，删除未完成');
  }
  const notified = notifyRemoved(ctx, sessionId);
  let cleanup = [];
  let warning;
  try {
    cleanup = (await forgetAccounting(ctx, sessionId)).cleanup;
  } catch (error) {
    // The log is already gone: report the deletion that did happen, and say
    // which part still needs a restart instead of failing the whole request.
    warning = `会话日志已删除，但工作区记账未能清理：${error instanceof Error ? error.message : String(error)}。该行已随会话摘要消失，记账条目会在下次启动时被剪除。`;
  }
  return {
    sessionId,
    directory,
    workspace: account ?? null,
    released: live === undefined ? null : 'released',
    cleanup,
    notified,
    ...(warning === undefined ? {} : { warning }),
    revision: String(snapshot.revision),
  };
}

/** Read-only diagnosis of one Session, used by `GET /inspect`. */
async function inspect(ctx, sessionId) {
  const result = {
    build: BUILD,
    capture: { ...captured, handles: lifecycleHandles.size },
  };
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) return result;
  const persistence = ctx.sessionPersistence;
  const snapshot = await persistence.stat(sessionId);
  const live = liveReason(ctx, sessionId);
  const activity = await sessionActivity(ctx, sessionId);
  let directory;
  let directoryError;
  if (snapshot !== undefined) {
    try {
      directory = artifactDirectory(persistence, snapshot.header, sessionId);
    } catch (error) {
      directoryError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    ...result,
    session: {
      id: sessionId,
      stored: snapshot !== undefined,
      live: live ?? null,
      captured: lifecycleHandles.has(sessionId),
      activity: activity.map((entry) => (typeof entry === 'string' ? entry : entry?.kind ?? 'work')),
      workspace: accountingOf(ctx, sessionId) ?? null,
      directory: directory ?? null,
      ...(directoryError === undefined ? {} : { directoryError }),
      handles: openWriteHandles(persistence, sessionId),
    },
  };
}

/**
 * Mount the deletion route: `GET /health`, `GET /inspect` and `POST /delete`.
 *
 * @param ctx - the plugin's Host context.
 */
export function apply(ctx) {
  const log = (level, message) => {
    try {
      ctx.logger?.[level]?.(message);
    } catch {
      /* logging must never break the route */
    }
  };

  if (!installLifecycleCapture(ctx)) {
    // The factory may mount after this bundle; instrument it as soon as it does.
    try {
      ctx.inject(['agentLoop'], () => {
        if (installLifecycleCapture(ctx)) log('debug', `${name}: lifecycle capture installed late`);
      });
    } catch {
      /* diagnostics below report the missing capture */
    }
    log('warn', `${name}: agent-loop lifecycle capture is not installed yet`);
  }

  ctx.effect(() => {
    if (typeof ctx.on !== 'function') return undefined;
    const off = ctx.on('agent/disposed', ({ agent }) => {
      if (agent?.id !== undefined) lifecycleHandles.delete(agent.id);
    });
    return () => {
      try {
        off?.();
      } catch {
        /* listener teardown is best effort */
      }
    };
  }, 'dsh-session-delete: lifecycle bookkeeping');

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const path = url.pathname;
          try {
            if (req.method === 'GET' && path === `${ROUTE_PREFIX}/health`) {
              sendJson(res, 200, { ok: true, plugin: name, build: BUILD, capture: { ...captured } });
              return;
            }
            if (req.method === 'GET' && path === `${ROUTE_PREFIX}/inspect`) {
              const sessionId = url.searchParams.get('sessionId') ?? undefined;
              sendJson(res, 200, { ok: true, ...(await inspect(ctx, sessionId)) });
              return;
            }
            if (path !== `${ROUTE_PREFIX}/delete`) {
              throw new DeleteError(404, 'route/not-found', '未知路由');
            }
            if (req.method !== 'POST') {
              throw new DeleteError(405, 'route/method', '请使用 POST');
            }
            assertSameOrigin(req);
            const body = await readJsonBody(req);
            const receipt = await deleteSession(ctx, body?.sessionId, {
              dryRun: body?.dryRun === true,
              force: body?.force === true,
            });
            log('info', `${name}: ${receipt.dryRun === true ? 'resolved' : 'deleted'} session ${receipt.sessionId}`);
            sendJson(res, 200, { ok: true, ...receipt });
          } catch (error) {
            const failure =
              error instanceof DeleteError
                ? error
                : new DeleteError(500, 'delete/failed', error instanceof Error ? error.message : String(error));
            log('warn', `${name}: delete failed (${failure.code}): ${failure.message}`);
            sendJson(res, failure.status, {
              ok: false,
              code: failure.code,
              message: failure.message,
              ...(failure.details === undefined ? {} : { details: failure.details }),
            });
          }
        },
      }),
    'dsh-session-delete: session deletion route',
  );

  log('debug', `${name}: route mounted at ${ROUTE_PREFIX} (build ${BUILD})`);
}
