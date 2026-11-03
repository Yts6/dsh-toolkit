/**
 * dsh-session-delete — browser half.
 *
 * Adds one `sidebar.workspaces.session.menu.item` row ("删除会话", order 500)
 * to the shipped Session "..." menu, plus the `shell.overlay` confirmation
 * dialog it raises. The deletion itself runs on the Host half through the
 * plugin's own route; this half collects the confirmation and shows the
 * Host's answer.
 *
 * Every stored Session can be deleted, including the conversation on screen:
 * the Harness keeps that conversation alive in the main view, so this half
 * first opens a fresh blank conversation (the same action as "new session"),
 * waits until the page has let go of the old one, and only then asks the Host
 * to remove it. The user always lands in a new conversation.
 *
 * Styling follows the host's Session menu row and modal geometry with the
 * plugin's own `dsd-` classes and the theme's alias tokens, so no Harness
 * Client package is imported as a module.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    /** Locale namespace owned by this package. */
    const NS = 'sessionDelete';
    /** Host route owned by the Host half. */
    const ROUTE = '/dsh-session-delete/delete';
    /** Menu position: after the shipped `session-id` row (450). */
    const MENU_ORDER = 500;
    /** How long the page gets to open a new conversation before deletion is abandoned. */
    const NEW_CONVERSATION_TIMEOUT_MS = 8_000;

    const zh = {
      'meta.title': '删除会话',
      'meta.description': '在会话菜单中增加“删除会话”：永久删除会话日志，并清除其工作区记账、归档与置顶标记；删除当前对话后会自动打开一个新的空白对话。',
      'menu.delete': '删除会话',
      'menu.deleteCurrent': '删除当前对话',
      'menu.currentHint': '这是你正在使用的对话；删除后会为你打开一个新的空白对话',
      'dialog.title': '删除会话',
      'dialog.titleOpen': '删除当前对话',
      'dialog.description': '将永久删除会话“{name}”及其全部对话记录。',
      'dialog.descriptionOpen': '将永久删除你正在使用的对话“{name}”及其全部记录。',
      'dialog.openNote': '确认后会先为你打开一个新的空白对话，再删除这个对话的记录。',
      'dialog.runningNote': '这个对话还有正在运行的任务；确认后会先停止它，再删除记录。',
      'dialog.untitled': '未命名',
      'dialog.warning': '删除后无法撤销：会话日志文件会从磁盘移除，该会话也会从工作区、归档与置顶列表中消失。',
      'dialog.identity': '会话 ID：{id}',
      'dialog.confirm': '删除',
      'dialog.confirmOpen': '删除并新建对话',
      'dialog.cancel': '取消',
      'dialog.pending': '正在删除…',
      'dialog.pendingOpen': '正在删除…',
      'dialog.opening': '正在打开新的空白对话…',
      'dialog.newSessionFailed': '没能打开新的空白对话，已取消删除，请稍后再试',
      'dialog.close': '关闭',
      'dialog.failed': '删除失败：{message}',
      'menu.failed': '无法删除会话：{message}',
    };

    const en = {
      'meta.title': 'Delete session',
      'meta.description': 'Adds “Delete session” to the session menu, removing the session log together with its workspace accounting and archive/pin membership; deleting the open conversation starts a new blank one first.',
      'menu.delete': 'Delete session',
      'menu.deleteCurrent': 'Delete this conversation',
      'menu.currentHint': 'This is the conversation you are using; deleting it opens a new blank conversation',
      'dialog.title': 'Delete session',
      'dialog.titleOpen': 'Delete this conversation',
      'dialog.description': 'Session “{name}” and its complete conversation history will be permanently deleted.',
      'dialog.descriptionOpen': 'The conversation you are using, “{name}”, and its complete history will be permanently deleted.',
      'dialog.openNote': 'A new blank conversation opens first, then this one is deleted.',
      'dialog.runningNote': 'This conversation still has running work; confirming stops it first, then deletes the record.',
      'dialog.untitled': 'Untitled',
      'dialog.warning': 'This cannot be undone: the session log file is removed from disk, and the session disappears from the workspace, archive, and pin lists.',
      'dialog.identity': 'Session ID: {id}',
      'dialog.confirm': 'Delete',
      'dialog.confirmOpen': 'Delete and start a new chat',
      'dialog.cancel': 'Cancel',
      'dialog.pending': 'Deleting…',
      'dialog.pendingOpen': 'Deleting…',
      'dialog.opening': 'Opening a new blank conversation…',
      'dialog.newSessionFailed': 'Could not open a new blank conversation, so nothing was deleted. Try again later.',
      'dialog.close': 'Close',
      'dialog.failed': 'Delete failed: {message}',
      'menu.failed': 'Could not delete the session: {message}',
    };

    /** Row + dialog styles, scoped by the plugin's own class prefix. */
    const CSS = `
.dsd-item{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:none;border-radius:8px;background:transparent;cursor:pointer;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary,#e5484d);text-align:left}
.dsd-item:hover:not(:disabled),.dsd-item:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.12));outline:none}
.dsd-item:disabled{opacity:.4;cursor:not-allowed}
.dsd-icon{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:inherit}
.dsd-icon svg{width:14px;height:14px}
.dsd-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-wrap{position:relative}
.dsd-sep{height:.5px;margin:3px 2px;background:var(--dsw-alias-border-l2,#0000001f)}
.dsd-root{pointer-events:auto;position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top,24px)) 24px}
.dsd-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.32));backdrop-filter:var(--dsw-mask-blur,blur(2px))}
.dsd-dialog{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;gap:20px;width:min(440px,100%);padding:0 0 24px;border-radius:var(--dsw-radius-panel,14px);background:var(--dsw-alias-bg-layer-2,#f7f7f8);color:var(--dsw-alias-label-primary,#0f1115);box-shadow:var(--dsw-elevation-prominent,0 8px 32px #0000003d)}
.dsd-dialog:focus{outline:none}
.dsd-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}
.dsd-title{margin:0;font-size:16px;line-height:24px;font-weight:500}
.dsd-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#61666d);cursor:pointer}
.dsd-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1,#0000000f))}
.dsd-close:disabled{opacity:.4;cursor:default}
.dsd-body{display:flex;flex-direction:column;gap:12px;padding:0 24px}
.dsd-text{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#0f1115)}
.dsd-warning{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary,#61666d)}
.dsd-warning p{margin:0}
.dsd-warning-icon{flex:none;margin-top:3px;color:var(--dsw-alias-state-error-primary,#e5484d)}
.dsd-id{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666d);word-break:break-all}
.dsd-error{font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary,#e5484d)}
.dsd-status{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#61666d)}
.dsd-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px}
.dsd-button{box-sizing:border-box;min-width:72px;height:32px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l2,#0000001f);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);font-family:inherit;font-size:13px;font-weight:500;line-height:20px;cursor:pointer}
.dsd-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1,#0000000f))}
.dsd-button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe));outline-offset:2px}
.dsd-button:disabled{opacity:.5;cursor:default}
.dsd-confirm{min-width:96px}
.dsd-confirm:not(:disabled){color:var(--dsw-alias-state-error-primary,#e5484d)}
.dsd-confirm:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(229,72,77,.12))}
@media (prefers-reduced-motion:reduce){.dsd-item,.dsd-button{transition:none}}
`;

    /** One style element per mounted entry; removed with its component. */
    function Styles() {
      return h('style', { 'data-plugin': 'dsh-session-delete', dangerouslySetInnerHTML: { __html: CSS } });
    }

    function TrashIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [
          h('path', { key: 'lid', d: 'M2.6 4.4h10.8' }),
          h('path', { key: 'handle', d: 'M6.1 4.4V3.2c0-.4.3-.7.7-.7h2.4c.4 0 .7.3.7.7v1.2' }),
          h('path', { key: 'body', d: 'M4.2 4.4l.6 8.1c0 .5.4.9.9.9h4.6c.5 0 .9-.4.9-.9l.6-8.1' }),
          h('path', { key: 'lines', d: 'M6.7 6.9v3.8M9.3 6.9v3.8' }),
        ],
      );
    }

    function WarningIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 15,
          height: 15,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        [h('path', { key: 'c', d: 'M8 1.8l6.2 11.4H1.8z' }), h('path', { key: 's', d: 'M8 6.2v3.3M8 11.4h.01' })],
      );
    }

    /** The pending confirmation, shared by the menu row and the overlay entry. */
    let pending = null;
    const listeners = new Set();

    function setPending(next) {
      pending = next;
      for (const listener of listeners) listener();
    }

    /** Subscribe one component to the pending confirmation. */
    function usePending() {
      const [, force] = useState(0);
      useEffect(() => {
        const listener = () => force((n) => n + 1);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }, []);
      return pending;
    }

    /** Re-render on a locale switch so translated text follows the active locale. */
    function useLocaleRevision(locale) {
      const [, force] = useState(0);
      useEffect(() => {
        if (typeof locale?.subscribe !== 'function') return undefined;
        return locale.subscribe(() => force((n) => n + 1));
      }, [locale]);
      return undefined;
    }

    /**
     * The Session row menu entry.
     *
     * Every stored Session can be deleted, including the conversation currently
     * on screen. The open conversation is labelled differently and its tooltip
     * says what happens: a new blank conversation is opened first, then this one
     * is removed, so the click never leaves the user on a deleted record.
     */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, useSessions, t, openDelete }) {
      const [, setMenuOpen] = useMenuOpenState();
      const isCurrent = useSessions(
        (list) => (list?.byId?.[sessionId]?.retainedBy?.mainView ?? 0) > 0,
      );
      const isRunning = useSessions((list) => list?.byId?.[sessionId]?.running === true);
      return h(React.Fragment, null, [
        h(Styles, { key: 'styles' }),
        h('div', { key: 'row', className: 'dsd-wrap' }, [
          h('div', { key: 'separator', className: 'dsd-sep', role: 'presentation' }),
          h(
            'button',
            {
              key: 'button',
              type: 'button',
              role: 'menuitem',
              className: 'dsd-item',
              title: isCurrent ? t('menu.currentHint') : undefined,
              onClick: (event) => {
                event.stopPropagation();
                setMenuOpen(false);
                openDelete({ sessionId, title: displayTitle, current: isCurrent, running: isRunning });
              },
            },
            [
              h('span', { key: 'icon', className: 'dsd-icon' }, h(TrashIcon)),
              h(
                'span',
                { key: 'label', className: 'dsd-label' },
                isCurrent ? t('menu.deleteCurrent') : t('menu.delete'),
              ),
            ],
          ),
        ]),
      ]);
    }

    /**
     * The frame-wide confirmation dialog.
     *
     * Deleting the conversation on screen cannot happen while the page still
     * holds it: this dialog first opens a fresh blank conversation through
     * `moveToNewSession`, which resolves only once the page has let go of the
     * old Session, and then asks the Host to delete it. A Session open in
     * another tab, or one still holding running work, is deleted the same way
     * as before: the Host is asked with `force` to stop its work and release it
     * before the log is removed.
     */
    function DeleteSessionDialog({
      t,
      useLocaleRevision,
      moveToNewSession,
      isMainViewSession,
      reopenSession,
      refreshSessions,
    }) {
      useLocaleRevision();
      const request = usePending();
      const [phase, setPhase] = useState('idle');
      const [error, setError] = useState(null);
      /** True once this dialog has already switched the page to a fresh conversation. */
      const movedRef = useRef(false);
      const cancelRef = useRef(null);
      const restoreRef = useRef(null);

      const pendingState = phase !== 'idle';
      const open = request !== null;
      const sessionId = request?.sessionId;

      useEffect(() => {
        if (!open) return undefined;
        restoreRef.current = document.activeElement;
        movedRef.current = false;
        setError(null);
        setPhase('idle');
        cancelRef.current?.focus();
        return () => {
          const previous = restoreRef.current;
          if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
        };
      }, [open, sessionId]);

      useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          if (!pendingState) setPending(null);
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [open, pendingState]);

      if (!open) return null;

      const title = request.title !== undefined && request.title !== '' ? request.title : t('dialog.untitled');
      const deletingCurrent = request.current === true;

      const confirm = async () => {
        setError(null);
        const wasCurrent = deletingCurrent && isMainViewSession(request.sessionId);
        try {
          // The conversation on screen must be let go before its log is removed,
          // otherwise the Host would tear the Agent out from under the open page.
          // Opening a new conversation is exactly the "new session" action, and
          // it is done only once per dialog so a retry does not pile up blanks.
          if (wasCurrent && !movedRef.current) {
            setPhase('opening');
            const moved = await moveToNewSession(request.sessionId);
            if (!moved) throw new Error(t('dialog.newSessionFailed'));
            movedRef.current = true;
          }
          setPhase('deleting');
          const response = await fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            // `force` asks the Host to stop this Session's running work and
            // tear its Agent down (the same teardown an app quit performs)
            // before the log is removed, so an idle-but-loaded Session — the
            // normal state of any conversation opened during this app run —
            // still deletes.
            body: JSON.stringify({ sessionId: request.sessionId, force: true }),
          });
          const payload = await response.json().catch(() => null);
          // The Session is already gone: the outcome the user asked for.
          if (payload?.code === 'session/not-found') {
            setPending(null);
            return;
          }
          if (!response.ok || payload?.ok !== true) {
            throw new Error(payload?.message ?? `HTTP ${response.status}`);
          }
          // A Host that could not reach any page still leaves a stale row in
          // this page's list; pull a fresh baseline instead of trusting it.
          if (payload.notified === false) refreshSessions();
          setPending(null);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
          // A failed deletion must not strand the user in the blank
          // conversation this dialog opened: put back the one they were
          // reading, so they can retry from where they were.
          if (movedRef.current && wasCurrent) {
            movedRef.current = false;
            reopenSession(request.sessionId);
          }
        } finally {
          setPhase('idle');
        }
      };

      const close = () => {
        if (!pendingState) setPending(null);
      };

      const statusText =
        phase === 'opening'
          ? t('dialog.opening')
          : phase === 'deleting'
            ? deletingCurrent
              ? t('dialog.pendingOpen')
              : t('dialog.pending')
            : null;

      return h(React.Fragment, null, [
        h(Styles, { key: 'styles' }),
        h(
          'div',
          {
            key: 'root',
            className: 'dsd-root',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) close();
            },
          },
          [
            h('div', { key: 'mask', className: 'dsd-mask' }),
            h(
              'div',
              {
                key: 'dialog',
                className: 'dsd-dialog',
                role: 'alertdialog',
                'aria-modal': true,
                'aria-labelledby': 'dsd-dialog-title',
                'aria-describedby': 'dsd-dialog-description',
              },
              [
                h('div', { key: 'header', className: 'dsd-header' }, [
                  h(
                    'h2',
                    { key: 'title', id: 'dsd-dialog-title', className: 'dsd-title' },
                    deletingCurrent ? t('dialog.titleOpen') : t('dialog.title'),
                  ),
                  h(
                    'button',
                    {
                      key: 'close',
                      type: 'button',
                      className: 'dsd-close',
                      'aria-label': t('dialog.close'),
                      disabled: pendingState,
                      onClick: close,
                    },
                    '✕',
                  ),
                ]),
                h('div', { key: 'body', className: 'dsd-body' }, [
                  h(
                    'p',
                    { key: 'description', id: 'dsd-dialog-description', className: 'dsd-text' },
                    deletingCurrent
                      ? t('dialog.descriptionOpen', { name: title })
                      : t('dialog.description', { name: title }),
                  ),
                  deletingCurrent
                    ? h('p', { key: 'open-note', className: 'dsd-status' }, t('dialog.openNote'))
                    : null,
                  request.running === true
                    ? h('p', { key: 'running-note', className: 'dsd-status' }, t('dialog.runningNote'))
                    : null,
                  h('div', { key: 'warning', className: 'dsd-warning' }, [
                    h('span', { key: 'icon', className: 'dsd-warning-icon' }, h(WarningIcon)),
                    h('p', { key: 'text' }, t('dialog.warning')),
                  ]),
                  h('p', { key: 'id', className: 'dsd-id' }, t('dialog.identity', { id: request.sessionId })),
                  statusText !== null
                    ? h('p', { key: 'pending', className: 'dsd-status', role: 'status' }, statusText)
                    : null,
                  error !== null ? h('p', { key: 'error', className: 'dsd-error', role: 'alert' }, t('dialog.failed', { message: error })) : null,
                ]),
                h('div', { key: 'footer', className: 'dsd-footer' }, [
                  h(
                    'button',
                    {
                      key: 'cancel',
                      type: 'button',
                      ref: cancelRef,
                      className: 'dsd-button',
                      disabled: pendingState,
                      onClick: close,
                    },
                    t('dialog.cancel'),
                  ),
                  h(
                    'button',
                    {
                      key: 'confirm',
                      type: 'button',
                      className: 'dsd-button dsd-confirm',
                      disabled: pendingState,
                      onClick: confirm,
                    },
                    deletingCurrent ? t('dialog.confirmOpen') : t('dialog.confirm'),
                  ),
                ]),
              ],
            ),
          ],
        ),
      ]);
    }

    /**
     * Resolve once no main-view retention remains for `sessionId`.
     *
     * `retainedBy.mainView` is the Session Controller's own count of the page's
     * main-view reference: it drops to zero after `startSession()` selects the
     * new conversation and releases the previous one. A resolution with `false`
     * means the page never let go (creation refused or stalled), and the caller
     * abandons the deletion instead of removing a Session still on screen.
     */
    function waitForMainViewRelease(sessions, sessionId, timeoutMs) {
      const count = () => {
        try {
          return sessions.retainInfo(sessionId).getSnapshot().retainedBy?.mainView ?? 0;
        } catch {
          return 0;
        }
      };
      if (count() === 0) return Promise.resolve(true);
      return new Promise((resolve) => {
        let settled = false;
        let stop = () => {};
        let timer;
        const settle = (released) => {
          if (settled) return;
          settled = true;
          stop();
          clearTimeout(timer);
          resolve(released);
        };
        stop = sessions.retainInfo(sessionId).subscribe(() => {
          if (count() === 0) settle(true);
        });
        timer = setTimeout(() => settle(count() === 0), timeoutMs);
      });
    }

    return {
      name: 'dsh-session-delete',
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-delete: locale');

        const openDelete = (request) => setPending(request);

        /** Whether this page is still displaying `sessionId` in its main view. */
        const isMainViewSession = (sessionId) => {
          try {
            return (ctx.sessions.retainInfo(sessionId).getSnapshot().retainedBy?.mainView ?? 0) > 0;
          } catch {
            return false;
          }
        };

        /** Bring a conversation back after its deletion was refused. */
        const reopenSession = (sessionId) => {
          try {
            ctx.uiWorkspace.openSession?.(sessionId);
          } catch {
            /* nothing else to restore: the sidebar still lists the row */
          }
        };

        /** Re-pull the Host's Session baseline when this page may hold a stale row. */
        const refreshSessions = () => {
          try {
            Promise.resolve(ctx.sessions.refresh?.()).catch(() => {});
          } catch {
            /* the next baseline pull rebuilds the sidebar anyway */
          }
        };

        /**
         * Open a fresh blank conversation (the "new session" action) and wait
         * until this page no longer displays `sessionId`.
         */
        const moveToNewSession = async (sessionId) => {
          try {
            ctx.uiWorkspace.startSession();
          } catch {
            return false;
          }
          return waitForMainViewRelease(ctx.sessions, sessionId, NEW_CONVERSATION_TIMEOUT_MS);
        };

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'dsh-session-delete',
              order: MENU_ORDER,
              locale: NS,
              inject: () => ({ t, openDelete }),
            },
            DeleteSessionMenuItem,
          ),
        );

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'dsh-session-delete.dialog',
              locale: NS,
              inject: () => ({
                t,
                useLocaleRevision,
                moveToNewSession,
                isMainViewSession,
                reopenSession,
                refreshSessions,
              }),
            },
            DeleteSessionDialog,
          ),
        );
      },
    };
  },
});
