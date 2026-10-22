/**
 * dsh-session-delete — browser half.
 *
 * Adds one `sidebar.workspaces.session.menu.item` row ("删除会话", order 500)
 * to the shipped Session "..." menu, plus the `shell.overlay` confirmation
 * dialog it raises. The deletion itself runs on the Host half through the
 * plugin's own route; this half only collects the confirmation and shows the
 * Host's answer.
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

    const zh = {
      'meta.title': '删除会话',
      'meta.description': '在会话右键菜单中增加“删除会话”，可连同会话日志、工作区记账与归档/置顶标记一起清除。',
      'menu.delete': '删除会话',
      'dialog.title': '删除会话',
      'dialog.titleOpen': '删除当前对话',
      'dialog.description': '将永久删除会话“{name}”及其全部对话记录。',
      'dialog.descriptionOpen': '将永久删除你正在阅读的这个对话“{name}”及其全部对话记录。',
      'dialog.openNote': '这个对话正打开着：确认后会先关闭它，再删除它的记录。',
      'dialog.untitled': '未命名',
      'dialog.warning': '删除后无法撤销：会话日志文件会从磁盘移除，该会话也会从工作区、归档与置顶列表中消失。',
      'dialog.identity': '会话 ID：{id}',
      'dialog.confirm': '删除',
      'dialog.confirmOpen': '关闭并删除',
      'dialog.cancel': '取消',
      'dialog.pending': '正在删除…',
      'dialog.pendingOpen': '正在关闭并删除…',
      'dialog.close': '关闭',
      'dialog.failed': '删除失败：{message}',
      'menu.failed': '无法删除会话：{message}',
    };

    const en = {
      'meta.title': 'Delete session',
      'meta.description': 'Adds “Delete session” to the session menu, removing the session log together with its workspace accounting and archive/pin membership.',
      'menu.delete': 'Delete session',
      'dialog.title': 'Delete session',
      'dialog.titleOpen': 'Delete this conversation',
      'dialog.description': 'Session “{name}” and its complete conversation history will be permanently deleted.',
      'dialog.descriptionOpen': 'The conversation you are reading, “{name}”, and its complete history will be permanently deleted.',
      'dialog.openNote': 'This conversation is open: confirming closes it first, then deletes its record.',
      'dialog.untitled': 'Untitled',
      'dialog.warning': 'This cannot be undone: the session log file is removed from disk, and the session disappears from the workspace, archive, and pin lists.',
      'dialog.identity': 'Session ID: {id}',
      'dialog.confirm': 'Delete',
      'dialog.confirmOpen': 'Close and delete',
      'dialog.cancel': 'Cancel',
      'dialog.pending': 'Deleting…',
      'dialog.pendingOpen': 'Closing and deleting…',
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

    /** The Session row menu entry. */
    function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState, t, openDelete }) {
      const [, setMenuOpen] = useMenuOpenState();
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
              onClick: (event) => {
                event.stopPropagation();
                setMenuOpen(false);
                openDelete({ sessionId, title: displayTitle });
              },
            },
            [
              h('span', { key: 'icon', className: 'dsd-icon' }, h(TrashIcon)),
              h('span', { key: 'label', className: 'dsd-label' }, t('menu.delete')),
            ],
          ),
        ]),
      ]);
    }

    /** The frame-wide confirmation dialog. */
    function DeleteSessionDialog({ t, useLocaleRevision, useSessions, leaveOpenSession }) {      useLocaleRevision();
      const request = usePending();
      const [pendingState, setPendingState] = useState(false);
      const [error, setError] = useState(null);
      const cancelRef = useRef(null);
      const restoreRef = useRef(null);

      const open = request !== null;
      const sessionId = request?.sessionId;

      // A Session retained by the main view is the conversation on screen. The
      // Host refuses to delete it unless asked to release it, so the dialog says
      // so up front and keeps the ordinary wording for every other row.
      const isOpen =
        open && typeof useSessions === 'function'
          ? useSessions((list) => (list?.byId?.[sessionId]?.retainedBy?.mainView ?? 0) > 0)
          : false;

      useEffect(() => {
        if (!open) return undefined;
        restoreRef.current = document.activeElement;
        setError(null);
        setPendingState(false);
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

      const confirm = async (wasOpen) => {
        setPendingState(true);
        setError(null);
        try {
          const response = await fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            // `force` releases the Session's live Agent (the same teardown an
            // app quit performs) and stops its running work, so deleting the
            // conversation you are reading works instead of being refused.
            body: JSON.stringify({ sessionId: request.sessionId, force: true }),
          });
          const payload = await response.json().catch(() => null);
          if (!response.ok || payload?.ok !== true) {
            throw new Error(payload?.message ?? `HTTP ${response.status}`);
          }
          setPending(null);
          // The conversation being read no longer exists: leave it and show the
          // app's empty state instead of a transcript whose log is gone.
          if (wasOpen && typeof leaveOpenSession === 'function') leaveOpenSession();
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setPendingState(false);
        }
      };

      const close = () => {
        if (!pendingState) setPending(null);
      };

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
                    t(isOpen ? 'dialog.titleOpen' : 'dialog.title'),
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
                    t(isOpen ? 'dialog.descriptionOpen' : 'dialog.description', { name: title }),
                  ),
                  isOpen
                    ? h('div', { key: 'openNote', className: 'dsd-warning' }, [
                        h('span', { key: 'icon', className: 'dsd-warning-icon' }, h(WarningIcon)),
                        h('p', { key: 'text' }, t('dialog.openNote')),
                      ])
                    : null,
                  h('div', { key: 'warning', className: 'dsd-warning' }, [
                    h('span', { key: 'icon', className: 'dsd-warning-icon' }, h(WarningIcon)),
                    h('p', { key: 'text' }, t('dialog.warning')),
                  ]),
                  h('p', { key: 'id', className: 'dsd-id' }, t('dialog.identity', { id: request.sessionId })),
                  pendingState
                    ? h(
                        'p',
                        { key: 'pending', className: 'dsd-status', role: 'status' },
                        t(isOpen ? 'dialog.pendingOpen' : 'dialog.pending'),
                      )
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
                      onClick: () => confirm(isOpen),
                    },
                    t(isOpen ? 'dialog.confirmOpen' : 'dialog.confirm'),
                  ),
                ]),
              ],
            ),
          ],
        ),
      ]);
    }

    return {
      name: 'dsh-session-delete',
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-delete: locale');

        const openDelete = (request) => setPending(request);

        /**
         * Leave a conversation whose log was just deleted.
         *
         * The retained main-view reference dies with the Host side, so no
         * Session id may stay selected: switching to the Workspace's blank
         * Session is the shipped "new conversation" behaviour and lands the user
         * on an empty composer instead of a transcript that no longer exists.
         * Falls back to clearing the selection when no Workspace is available.
         */
        const leaveOpenSession = () => {
          try {
            const uiWorkspace = ctx.get('uiWorkspace');
            const workspaces = ctx.get('workspaces')?.list?.getSnapshot?.();
            const current = workspaces?.items?.[0];
            if (uiWorkspace !== undefined && current !== undefined) {
              uiWorkspace.startSession(current.workspaceId);
              return;
            }
            if (uiWorkspace !== undefined && typeof uiWorkspace.openSession === 'function') {
              ctx.get('layout')?.selectPanel?.(null);
            }
          } catch (error) {
            console.warn('[dsh-session-delete] could not leave the deleted conversation:', error);
          }
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
              inject: () => ({ t, useLocaleRevision, leaveOpenSession }),
            },
            DeleteSessionDialog,
          ),
        );
      },
    };
  },
});
