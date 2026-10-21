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
 *   2. it must not be live in this process (`ctx.sessions` / `ctx.agents`);
 *   3. it must report no running work through the shipped
 *      `workspace/session-activity` waterfall (running turns, owned jobs,
 *      subagent descendants, active schedules);
 *   4. its artifact directory is resolved through the persistence backend's own
 *      `locate()` hook and validated to stay inside the configured session root;
 *   5. the directory is removed, then the Workspace accounting slot plus the
 *      archive and pin sets are dropped.
 *
 * @module dsh-session-delete
 */
import { rm } from 'node:fs/promises';
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
const BUILD = 3;

/** Session identities are one safe path segment; the backend encodes them 1:1. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9._~-]{1,200}$/;

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
  const agent = ctx.agents.get(sessionId);
  if (agent !== undefined) return 'agent';
  const session = ctx.sessions.get(sessionId);
  if (session !== undefined) return 'session';
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

/**
 * Delete one stored Session: its log directory, its Workspace accounting slot,
 * and its archive and pin membership.
 *
 * @param ctx - the plugin's Host context.
 * @param sessionId - the Session identity to delete.
 * @param options - `dryRun` resolves the target without removing anything.
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
  if (live !== undefined) {
    throw new DeleteError(
      409,
      'session/in-use',
      '该会话仍在当前进程中使用（正在打开或被保留），请先切换到其他会话，稍后再试',
      { live },
    );
  }
  const activity = await sessionActivity(ctx, sessionId);
  if (activity.length > 0) {
    throw new DeleteError(409, 'session/active', '该会话仍有正在运行的工作，请先停止后再删除', {
      activity: activity.map((entry) => (typeof entry === 'string' ? entry : entry?.kind ?? 'work')),
    });
  }
  const directory = artifactDirectory(persistence, snapshot.header, sessionId);
  const account = accountingOf(ctx, sessionId);
  if (options.dryRun === true) {
    return {
      sessionId,
      directory,
      dryRun: true,
      workspace: account ?? null,
      revision: String(snapshot.revision),
    };
  }
  await rm(directory, { recursive: true, force: true });
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
    cleanup,
    notified,
    ...(warning === undefined ? {} : { warning }),
    revision: String(snapshot.revision),
  };
}

/**
 * Mount the deletion route: `GET /health` and `POST /delete`.
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

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          const path = (req.url ?? '/').split('?')[0];
          try {
            if (req.method === 'GET' && path === `${ROUTE_PREFIX}/health`) {
              sendJson(res, 200, { ok: true, plugin: name, build: BUILD });
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
            const receipt = await deleteSession(ctx, body?.sessionId, { dryRun: body?.dryRun === true });
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

  log('debug', `${name}: route mounted at ${ROUTE_PREFIX}`);
}
