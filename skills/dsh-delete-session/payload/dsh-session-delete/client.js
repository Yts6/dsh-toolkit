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
      'meta.description': '在会话菜单中增加“删除会话”与“批量删除会话”：永久删除会话日志，并清除其工作区记账、归档与置顶标记；删除当前对话后会自动打开一个新的空白对话，批量删除可一次勾选多个会话。',
      'menu.delete': '删除会话',
      'menu.deleteCurrent': '删除当前对话',
      'menu.batch': '批量删除会话…',
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
      'batch.title': '批量删除会话',
      'batch.description': '勾选要永久删除的会话。删除会移除会话日志及其工作区记账、归档与置顶标记，且无法撤销。',
      'batch.search': '搜索标题或会话 ID…',
      'batch.selectAll': '全选',
      'batch.clearAll': '取消全选',
      'batch.selected': '已选择 {count} / {total} 个会话',
      'batch.currentTag': '当前对话',
      'batch.currentHint': '当前对话不参与批量删除；如需删除它，请先切换到其他对话，再用单项删除。',
      'batch.currentNote': '当前对话不在批量删除范围内。',
      'batch.archivedTag': '已归档',
      'batch.runningTag': '运行中',
      'batch.empty': '没有可删除的会话。',
      'batch.noMatch': '没有匹配的会话。',
      'batch.delete': '删除 {count} 个会话',
      'batch.progress': '正在删除 {done} / {total}…',
      'batch.failedTitle': '{count} 个会话未能删除',
      'batch.failedItem': '“{name}”：{message}',
      'batch.retry': '重试失败项',
      'batch.deleting': '正在删除…',
      'batch.close': '关闭',
    };

    const en = {
      'meta.title': 'Delete session',
      'meta.description': 'Adds “Delete session” and “Delete sessions…” to the session menu, removing session logs together with their workspace accounting and archive/pin membership, one at a time or in bulk; deleting the open conversation starts a new blank one first.',
      'menu.delete': 'Delete session',
      'menu.deleteCurrent': 'Delete this conversation',
      'menu.batch': 'Delete sessions…',
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
      'batch.title': 'Delete sessions',
      'batch.description': 'Select the sessions to delete permanently. This removes each session log together with its workspace accounting, archive, and pin membership, and cannot be undone.',
      'batch.search': 'Search by title or session ID…',
      'batch.selectAll': 'Select all',
      'batch.clearAll': 'Clear selection',
      'batch.selected': '{count} of {total} selected',
      'batch.currentTag': 'Open',
      'batch.currentHint': 'The open conversation is not part of batch deletion; switch away and delete it from its own menu instead.',
      'batch.currentNote': 'The open conversation is not included in batch deletion.',
      'batch.archivedTag': 'Archived',
      'batch.runningTag': 'Running',
      'batch.empty': 'No sessions can be deleted.',
      'batch.noMatch': 'No sessions match.',
      'batch.delete': 'Delete {count} sessions',
      'batch.progress': 'Deleting {done} / {total}…',
      'batch.failedTitle': '{count} sessions could not be deleted',
      'batch.failedItem': '“{name}”: {message}',
      'batch.retry': 'Retry failed',
      'batch.deleting': 'Deleting…',
      'batch.close': 'Close',
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
.dsd-count{flex:none;margin-left:auto;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:12px;line-height:16px;font-variant-numeric:tabular-nums}
.dsd-batch{width:min(560px,100%);max-height:calc(100vh - 48px);overflow:hidden}
.dsd-batch .dsd-body{min-height:0}
.dsd-searchRow{display:flex;align-items:center;gap:8px}
.dsd-search{flex:1;min-width:0;box-sizing:border-box;height:32px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2,#0000001f);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#0f1115);font-family:inherit;font-size:13px;line-height:20px}
.dsd-search::placeholder{color:var(--dsw-alias-label-tertiary,#8a8f98)}
.dsd-search:focus{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary,#4d6bfe));outline-offset:1px}
.dsd-toolbar{display:flex;align-items:center;gap:12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666d)}
.dsd-link{border:none;background:transparent;padding:0;color:var(--dsw-alias-brand-primary,#4d6bfe);font-family:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsd-link:hover:not(:disabled){text-decoration:underline}
.dsd-link:disabled{color:var(--dsw-alias-label-tertiary,#8a8f98);cursor:default;text-decoration:none}
.dsd-list{display:flex;flex-direction:column;gap:1px;max-height:min(42vh,340px);min-height:96px;overflow-y:auto;overscroll-behavior:contain;border:.5px solid var(--dsw-alias-border-l2,#0000001f);border-radius:10px;padding:4px}
.dsd-row{display:flex;align-items:center;gap:10px;min-height:38px;padding:6px 8px;border-radius:7px;cursor:pointer;font-size:13px;line-height:20px}
.dsd-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dsd-row[data-disabled=true]{cursor:not-allowed;opacity:.55}
.dsd-row[data-disabled=true]:hover{background:transparent}
.dsd-check{flex:none;width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-brand-primary,#4d6bfe);cursor:inherit}
.dsd-rowText{display:flex;flex-direction:column;min-width:0;flex:1}
.dsd-rowTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsd-rowId{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8f98)}
.dsd-rowTags{display:flex;flex:none;align-items:center;gap:4px}
.dsd-tag{flex:none;border-radius:999px;padding:0 6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#61666d);background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.06))}
.dsd-tagRun{color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.dsd-rowDate{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-variant-numeric:tabular-nums}
.dsd-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a8f98)}
.dsd-failures{display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto}
.dsd-failures p{margin:0}
.dsd-failureList{margin:0;padding-left:18px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e5484d);word-break:break-word}
.dsd-empty{margin:0;padding:24px 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#8a8f98)}
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

    /** A compact `YYYY-MM-DD` stamp for one Session row; empty when unknown. */
    function formatDay(updatedAt) {
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return '';
      const date = new Date(updatedAt);
      if (Number.isNaN(date.getTime())) return '';
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${date.getFullYear()}-${month}-${day}`;
    }

    /**
     * The Session row menu entry that opens bulk deletion.
     *
     * It sits right below the single-delete row (`order` 510) and carries the
     * stored-Session count, so the list the dialog will show is predictable
     * before the dialog opens.
     */
    function BatchDeleteMenuItem({ useMenuOpenState, useSessions, t, openBatch }) {
      const [, setMenuOpen] = useMenuOpenState();
      const count = useSessions((list) => {
        const stored = list?.byId;
        if (stored === undefined) return 0;
        let total = 0;
        for (const session of Object.values(stored)) {
          if (session !== undefined && session !== null && session.blank !== true) total += 1;
        }
        return total;
      });
      return h(React.Fragment, null, [
        h(Styles, { key: 'styles' }),
        h('div', { key: 'row', className: 'dsd-wrap' }, [
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
                openBatch();
              },
            },
            [
              h('span', { key: 'icon', className: 'dsd-icon' }, h(TrashIcon)),
              h('span', { key: 'label', className: 'dsd-label' }, t('menu.batch')),
              count > 0 ? h('span', { key: 'count', className: 'dsd-count' }, String(count)) : null,
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
      // The batch dialog owns the `kind: 'batch'` request; this one handles a
      // single Session (the menu row's own shape has no `kind`).
      const open = request !== null && request.kind !== 'batch';
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
     * Bulk deletion dialog: pick several stored conversations, then remove them.
     *
     * The list is the page's own Session store, so it always matches the sidebar
     * (archived rows included). The conversation currently on screen is shown
     * but not selectable: removing it needs the page to let go of it first, and
     * that hand-off belongs to the single-row flow. Every other row is deleted
     * through the same per-Session Host route with `force`, one at a time —
     * sequential so each row reports its own outcome, the page repaints between
     * rows, and a failure never hides the ones that already succeeded.
     */
    function BatchDeleteDialog({ t, useLocaleRevision, useSessions, useWorkspaces, refreshSessions }) {
      useLocaleRevision();
      const request = usePending();
      const open = request?.kind === 'batch';
      const byId = useSessions((list) => list?.byId);
      const currentId = useSessions((list) => {
        const stored = list?.byId;
        if (stored === undefined) return undefined;
        for (const [id, session] of Object.entries(stored)) {
          if ((session?.retainedBy?.mainView ?? 0) > 0) return id;
        }
        return undefined;
      });
      const archivedIds = useWorkspaces((snapshot) => snapshot?.archivedSessionIds);
      const [selected, setSelected] = useState(() => new Set());
      const [query, setQuery] = useState('');
      const [phase, setPhase] = useState('idle');
      const [progress, setProgress] = useState({ done: 0, total: 0 });
      const [failures, setFailures] = useState([]);
      const cancelRef = useRef(null);
      const restoreRef = useRef(null);
      const deleting = phase === 'deleting';

      useEffect(() => {
        if (!open) return undefined;
        restoreRef.current = document.activeElement;
        setSelected(new Set());
        setQuery('');
        setPhase('idle');
        setProgress({ done: 0, total: 0 });
        setFailures([]);
        cancelRef.current?.focus();
        return () => {
          const previous = restoreRef.current;
          if (previous instanceof HTMLElement && document.contains(previous)) previous.focus();
        };
      }, [open]);

      // A completed deletion removes its row from the store; drop it from the
      // selection too so the footer count never promises a row that is gone.
      useEffect(() => {
        if (!open) return;
        setSelected((previous) => {
          let changed = false;
          const next = new Set();
          for (const id of previous) {
            if (byId?.[id] !== undefined) next.add(id);
            else changed = true;
          }
          return changed ? next : previous;
        });
      }, [open, byId]);

      useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          if (!deleting) setPending(null);
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [open, deleting]);

      if (!open) return null;

      const archived = new Set(Array.isArray(archivedIds) ? archivedIds : []);
      const rows = [];
      for (const [id, session] of Object.entries(byId ?? {})) {
        if (session === undefined || session === null || session.blank === true) continue;
        const title = typeof session.title === 'string' ? session.title.trim() : '';
        rows.push({
          id,
          title: title === '' ? t('dialog.untitled') : title,
          updatedAt: typeof session.updatedAt === 'number' ? session.updatedAt : 0,
          running: session.running === true,
          archived: archived.has(id),
          current: id === currentId,
        });
      }
      rows.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
      const needle = query.trim().toLowerCase();
      const visible =
        needle === ''
          ? rows
          : rows.filter(
              (row) => row.title.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle),
            );
      const selectable = visible.filter((row) => !row.current);
      const allVisibleSelected = selectable.length > 0 && selectable.every((row) => selected.has(row.id));

      const toggle = (id) => {
        if (deleting) return;
        setSelected((previous) => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };

      const toggleVisible = () => {
        if (deleting) return;
        setSelected((previous) => {
          const next = new Set(previous);
          if (allVisibleSelected) for (const row of selectable) next.delete(row.id);
          else for (const row of selectable) next.add(row.id);
          return next;
        });
      };

      const run = async (ids) => {
        if (ids.length === 0) return;
        setFailures([]);
        setPhase('deleting');
        setProgress({ done: 0, total: ids.length });
        const failed = [];
        let stale = false;
        for (let index = 0; index < ids.length; index += 1) {
          const sessionId = ids[index];
          try {
            const response = await fetch(ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'same-origin',
              // `force` is what makes a stored-but-loaded Session deletable:
              // the Host stops its work and runs the Agent teardown an app quit
              // would perform before it removes the log.
              body: JSON.stringify({ sessionId, force: true }),
            });
            const payload = await response.json().catch(() => null);
            if (payload?.code === 'session/not-found') {
              // Already gone: the requested outcome holds.
            } else if (!response.ok || payload?.ok !== true) {
              failed.push({ id: sessionId, message: payload?.message ?? `HTTP ${response.status}` });
            } else if (payload.notified === false) {
              stale = true;
            }
          } catch (error) {
            failed.push({ id: sessionId, message: error instanceof Error ? error.message : String(error) });
          }
          setProgress({ done: index + 1, total: ids.length });
          setSelected((previous) => {
            if (!previous.has(sessionId)) return previous;
            const next = new Set(previous);
            next.delete(sessionId);
            return next;
          });
        }
        if (stale) refreshSessions();
        if (failed.length === 0) {
          setPhase('idle');
          setPending(null);
          return;
        }
        // Keep exactly the failed rows selected, so one click retries them.
        setFailures(failed);
        setSelected(new Set(failed.map((entry) => entry.id)));
        setPhase('done');
      };

      const titleOf = (id) => {
        const session = byId?.[id];
        const title = typeof session?.title === 'string' ? session.title.trim() : '';
        return title === '' ? id : title;
      };

      const statusText = deleting ? t('batch.progress', { done: progress.done, total: progress.total }) : null;

      return h(React.Fragment, null, [
        h(Styles, { key: 'styles' }),
        h(
          'div',
          {
            key: 'root',
            className: 'dsd-root',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget && !deleting) setPending(null);
            },
          },
          [
            h('div', { key: 'mask', className: 'dsd-mask' }),
            h(
              'div',
              {
                key: 'dialog',
                className: 'dsd-dialog dsd-batch',
                role: 'dialog',
                'aria-modal': true,
                'aria-labelledby': 'dsd-batch-title',
                'aria-describedby': 'dsd-batch-description',
              },
              [
                h('div', { key: 'header', className: 'dsd-header' }, [
                  h('h2', { key: 'title', id: 'dsd-batch-title', className: 'dsd-title' }, t('batch.title')),
                  h(
                    'button',
                    {
                      key: 'close',
                      type: 'button',
                      className: 'dsd-close',
                      'aria-label': t('batch.close'),
                      disabled: deleting,
                      onClick: () => {
                        if (!deleting) setPending(null);
                      },
                    },
                    '✕',
                  ),
                ]),
                h('div', { key: 'body', className: 'dsd-body' }, [
                  h(
                    'p',
                    { key: 'description', id: 'dsd-batch-description', className: 'dsd-text' },
                    t('batch.description'),
                  ),
                  h('div', { key: 'searchRow', className: 'dsd-searchRow' }, [
                    h('input', {
                      key: 'search',
                      type: 'search',
                      className: 'dsd-search',
                      placeholder: t('batch.search'),
                      'aria-label': t('batch.search'),
                      value: query,
                      disabled: deleting,
                      onChange: (event) => setQuery(event.target.value),
                    }),
                  ]),
                  h('div', { key: 'toolbar', className: 'dsd-toolbar' }, [
                    h(
                      'button',
                      {
                        key: 'toggleVisible',
                        type: 'button',
                        className: 'dsd-link',
                        disabled: deleting || selectable.length === 0,
                        onClick: toggleVisible,
                      },
                      allVisibleSelected ? t('batch.clearAll') : t('batch.selectAll'),
                    ),
                    h(
                      'span',
                      { key: 'count' },
                      t('batch.selected', { count: selected.size, total: rows.length }),
                    ),
                  ]),
                  h(
                    'div',
                    { key: 'list', className: 'dsd-list', role: 'group', 'aria-label': t('batch.title') },
                    rows.length === 0
                      ? [h('p', { key: 'empty', className: 'dsd-empty' }, t('batch.empty'))]
                      : visible.length === 0
                        ? [h('p', { key: 'noMatch', className: 'dsd-empty' }, t('batch.noMatch'))]
                        : visible.map((row) =>
                            h(
                              'label',
                              {
                                key: row.id,
                                className: 'dsd-row',
                                'data-disabled': row.current ? 'true' : undefined,
                                title: row.current ? t('batch.currentHint') : undefined,
                              },
                              [
                                h('input', {
                                  key: 'check',
                                  type: 'checkbox',
                                  className: 'dsd-check',
                                  checked: selected.has(row.id),
                                  disabled: row.current || deleting,
                                  onChange: () => toggle(row.id),
                                }),
                                h('span', { key: 'text', className: 'dsd-rowText' }, [
                                  h('span', { key: 'title', className: 'dsd-rowTitle' }, row.title),
                                  h('span', { key: 'id', className: 'dsd-rowId' }, row.id),
                                ]),
                                row.current || row.archived || row.running
                                  ? h('span', { key: 'tags', className: 'dsd-rowTags' }, [
                                      row.current
                                        ? h('span', { key: 'current', className: 'dsd-tag' }, t('batch.currentTag'))
                                        : null,
                                      row.archived
                                        ? h('span', { key: 'archived', className: 'dsd-tag' }, t('batch.archivedTag'))
                                        : null,
                                      row.running
                                        ? h(
                                            'span',
                                            { key: 'running', className: 'dsd-tag dsd-tagRun' },
                                            t('batch.runningTag'),
                                          )
                                        : null,
                                    ])
                                  : null,
                                h('span', { key: 'date', className: 'dsd-rowDate' }, formatDay(row.updatedAt)),
                              ],
                            ),
                          ),
                  ),
                  currentId !== undefined
                    ? h('p', { key: 'currentNote', className: 'dsd-hint' }, t('batch.currentNote'))
                    : null,
                  failures.length > 0
                    ? h('div', { key: 'failures', className: 'dsd-failures' }, [
                        h(
                          'p',
                          { key: 'failedTitle', className: 'dsd-error', role: 'alert' },
                          t('batch.failedTitle', { count: failures.length }),
                        ),
                        h(
                          'ul',
                          { key: 'failedList', className: 'dsd-failureList' },
                          failures.map((failure) =>
                            h(
                              'li',
                              { key: failure.id },
                              t('batch.failedItem', { name: titleOf(failure.id), message: failure.message }),
                            ),
                          ),
                        ),
                      ])
                    : null,
                  statusText !== null
                    ? h('p', { key: 'status', className: 'dsd-status', role: 'status' }, statusText)
                    : null,
                ]),
                h('div', { key: 'footer', className: 'dsd-footer' }, [
                  h(
                    'button',
                    {
                      key: 'cancel',
                      type: 'button',
                      ref: cancelRef,
                      className: 'dsd-button',
                      disabled: deleting,
                      onClick: () => {
                        if (!deleting) setPending(null);
                      },
                    },
                    t('dialog.cancel'),
                  ),
                  h(
                    'button',
                    {
                      key: 'confirm',
                      type: 'button',
                      className: 'dsd-button dsd-confirm',
                      disabled: deleting || selected.size === 0,
                      // Returns the run promise (React ignores it) so a caller —
                      // the tests included — can await the whole batch.
                      onClick: () => run([...selected]),
                    },
                    phase === 'done'
                      ? t('batch.retry')
                      : deleting
                        ? t('batch.deleting')
                        : t('batch.delete', { count: selected.size }),
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

        /** Open the bulk-deletion dialog. */
        const openBatch = () => setPending({ kind: 'batch' });

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

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () =>
          ctx.slots.register(
            {
              name: 'sidebar.workspaces.session.menu.item',
              id: 'dsh-session-delete.batch',
              order: MENU_ORDER + 10,
              locale: NS,
              inject: () => ({ t, openBatch }),
            },
            BatchDeleteMenuItem,
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

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'dsh-session-delete.batch-dialog',
              locale: NS,
              inject: () => ({ t, useLocaleRevision, refreshSessions }),
            },
            BatchDeleteDialog,
          ),
        );
      },
    };
  },
});
