import React, { useState, useEffect, useRef, useMemo, useDeferredValue, useCallback } from 'react';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { List, type ListImperativeAPI, type RowComponentProps } from 'react-window';

import type { Email, GmailAccountId, ThreadMessage } from '../types/email';
import { useEmailContext } from '../contexts/emailContext';
import { useTaskContext } from '../contexts/taskContext';
import { useToast } from '../components/Toast';
import TaskSuggestionModal from '../components/TaskSuggestionModal';
import { TaskSuggestion } from '../types/taskSuggestion';
import type { TaskPriority } from '../types/task';
import { csrfHeaders } from '../lib/csrf';
import type { SetViewFn } from '../config/navigation';
import { buildTaskFromEmail, isFollowUpEmail } from '../lib/dashboardFeatures';

interface ComposeState {
  to: string;
  subject: string;
  body: string;
  sending: boolean;
  error: string | null;
}

const EMPTY_COMPOSE: ComposeState = { to: '', subject: '', body: '', sending: false, error: null };
const EMAIL_ROW_PX = 110;
const UNREAD_DIVIDER_PX = 17;
type RequestIdleCallbackFn = (cb: () => void, opts?: { timeout?: number }) => number;
function getRequestIdleCallback(): RequestIdleCallbackFn | null {
  const w = window as unknown as { requestIdleCallback?: RequestIdleCallbackFn };
  return typeof w.requestIdleCallback === 'function' ? w.requestIdleCallback : null;
}

function buildEmailFrameDoc(html: string): string {
  return `<!doctype html>
<html>
<head>
  <base target="_blank">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html {
      margin: 0;
      padding: 0;
      background: transparent;
    }
    body {
      box-sizing: border-box;
      margin: 0;
      padding: 20px;
      background: #fff;
      color: #111827;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 14px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      max-width: 100%;
    }
    img, picture, svg {
      max-width: 100%;
      height: auto;
    }
    table {
      max-width: 100%;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    a {
      color: #1a73e8;
    }
  </style>
</head>
<body>${html}</body>
</html>`;
}

/** Renders server-sanitized HTML in an iframe so email CSS cannot leak into the app. */
function EmailHtmlFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(420);
  const srcDoc = useMemo(() => buildEmailFrameDoc(html), [html]);

  const resize = useCallback(() => {
    try {
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      const contentHeight = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0);
      const nextHeight = Math.max(280, Math.min(5000, contentHeight));
      setHeight(nextHeight + 2);
    } catch {
      setHeight(720);
    }
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title="Email body"
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="email-html-frame"
      style={{ height }}
      onLoad={resize}
    />
  );
}

function EmailBodyDisplay({
  plain,
  html,
}: {
  plain: string;
  html?: string | null;
}) {
  if (html?.trim()) {
    return <EmailHtmlFrame html={html} />;
  }
  return (
    <pre className="email-readable-body">
      {plain || '(empty)'}
    </pre>
  );
}
/** Mirrors the server-side check — catches typos before the round-trip */
const isValidEmail = (addr: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim());
/** Valid task priority values — declared at module level to avoid per-render Set creation */
const VALID_PRIORITIES = new Set<TaskPriority>(['Priority', 'Critical']);

type ToastType = 'success' | 'error' | 'info';

type ThreadRowProps = {
  accountId: GmailAccountId;
  messages: ThreadMessage[];
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
};

function threadRowHeight(index: number, props: ThreadRowProps): number {
  const msg = props.messages[index];
  if (!msg) return 72;
  const isExpanded = props.expanded.has(msg.id);
  if (!isExpanded) return 72;
  // Over-estimate so expanded content never clips.
  const len = (msg.bodyHtml?.length ?? msg.body?.length ?? 0);
  return Math.min(900, 220 + Math.max(0, Math.floor(len / 4)));
}

const ThreadMessageItem = React.memo(function ThreadMessageItem({
  msg,
  isExpanded,
  isLast,
  onToggle,
}: {
  msg: ThreadMessage;
  isExpanded: boolean;
  isLast: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative border-b border-white/5">
      <button
        type="button"
        aria-expanded={isExpanded}
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-white/5 transition-colors text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary relative z-10 min-w-0"
      >
        <div className={`w-7 h-7 rounded-full glass-avatar flex items-center justify-center text-xs font-semibold shrink-0 relative ${msg.unread ? 'text-foreground ring-2 ring-primary/40' : 'text-text-muted'}`}>
          {msg.initials}
          {!isLast && (
            <div className="absolute -right-1 -bottom-1 w-2.5 h-2.5 rounded-full bg-primary border-2 border-background-elevated" aria-hidden="true" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[13px] font-semibold truncate ${msg.unread ? 'text-foreground' : 'text-text-muted'}`}>{msg.sender}</span>
            {isLast && (
              <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0">Latest</span>
            )}
          </div>
          {!isExpanded && msg.body && (
            <p className="text-[12px] text-text-muted/70 truncate mt-0.5">{msg.body.split('\n')[0]}</p>
          )}
        </div>
        <span className="text-[12px] text-text-muted shrink-0 ml-2">{msg.time}</span>
        <span className="material-symbols-outlined text-[18px] text-text-muted shrink-0 transition-transform" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none' }} aria-hidden="true">expand_more</span>
      </button>
      {isExpanded && (
        <div className="px-4 sm:px-5 pb-5 pt-2 ml-8 sm:ml-10 border-l-2 border-primary/20 bg-white/[0.02] min-w-0">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/5">
            <span className="text-[11px] text-text-muted break-all">From: <span className="text-foreground/80">{msg.senderEmail}</span></span>
          </div>
          <EmailBodyDisplay plain={msg.body} html={msg.bodyHtml} />
        </div>
      )}
    </div>
  );
});

const ThreadMessageRow = React.memo(function ThreadMessageRow(p: RowComponentProps<ThreadRowProps>) {
  const { index, style, ...rest } = p;
  const msg = rest.messages[index];
  if (!msg) return null;
  const isExpanded = rest.expanded.has(msg.id);
  const isLast = index === rest.messages.length - 1;
  return (
    <div style={style}>
      <ThreadMessageItem
        msg={msg}
        isExpanded={isExpanded}
        isLast={isLast}
        onToggle={() => rest.setExpanded(prev => {
          const next = new Set(prev);
          if (next.has(msg.id)) next.delete(msg.id);
          else next.add(msg.id);
          return next;
        })}
      />
    </div>
  );
});

function ThreadMessagesList({
  accountId,
  messages,
  expanded,
  setExpanded,
}: {
  accountId: GmailAccountId;
  messages: ThreadMessage[];
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  if (messages.length > 18) {
    return (
      <div className="relative h-[60vh]">
        <div className="absolute left-[36px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/30 via-primary/10 to-transparent pointer-events-none" aria-hidden="true" />
        <AutoSizer
          renderProp={({ height, width }) => {
            if (!height || !width) return null;
            return (
              <List
                style={{ height, width }}
                rowCount={messages.length}
                rowHeight={threadRowHeight}
                rowComponent={ThreadMessageRow}
                rowProps={{ accountId, messages, expanded, setExpanded }}
                overscanCount={4}
                className="custom-scrollbar"
              />
            );
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-white/5 relative">
      <div className="absolute left-[36px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-primary/30 via-primary/10 to-transparent pointer-events-none" aria-hidden="true" />
      {messages.map((msg, idx) => {
        const isExpanded = expanded.has(msg.id);
        const isLast = idx === messages.length - 1;
        return (
          <ThreadMessageItem
            key={`${accountId}:${msg.id}`}
            msg={msg}
            isExpanded={isExpanded}
            isLast={isLast}
            onToggle={() => setExpanded(prev => {
              const next = new Set(prev);
              if (next.has(msg.id)) next.delete(msg.id);
              else next.add(msg.id);
              return next;
            })}
          />
        );
      })}
    </div>
  );
}

const EmailRow = React.memo(function EmailRow({
  accountId,
  email,
  index,
  selected,
  onActivate,
  setSelectedIndex,
  openDetail,
  onPrefetchBody,
  onPrefetchThread,
  handleReply,
  archiveEmail,
  toggleRead,
  deleteEmail,
  showToast,
}: {
  accountId: GmailAccountId;
  email: Email;
  index: number;
  selected: boolean;
  onActivate: () => void;
  setSelectedIndex: (n: number) => void;
  openDetail: (email: Email) => void;
  onPrefetchBody: (emailId: string) => void;
  onPrefetchThread: (threadId: string) => void;
  handleReply: (email: Email, e: React.MouseEvent) => void;
  archiveEmail: (accountId: GmailAccountId, id: string, e?: React.MouseEvent) => void;
  toggleRead: (accountId: GmailAccountId, id: string, e?: React.MouseEvent) => void;
  deleteEmail: (accountId: GmailAccountId, id: string, e?: React.MouseEvent) => void;
  showToast: (message: string, type?: ToastType) => void;
}) {
  const onOpen = () => { onActivate(); setSelectedIndex(index); openDetail(email); };
  const prefetch = () => {
    onPrefetchBody(email.id);
    if ((email.messageCount ?? 1) > 1 && email.threadId) onPrefetchThread(email.threadId);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${email.unread ? 'Unread: ' : ''}${email.sender} — ${email.subject}`}
      className={`email-row group relative flex items-start gap-4 p-4 rounded-lg cursor-pointer mb-1 border w-full text-left transition-[background-color,border-color,opacity]
        ${selected ? 'border-primary/20 bg-primary/5' : 'border-transparent'}
        ${email.urgent ? 'hover:border-white/10 bg-rose-500/10' : 'hover:border-white/5'}
        ${!email.unread ? 'opacity-70 hover:opacity-100' : ''}
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
        if (e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
    >
      <div aria-hidden="true" className={`w-2 h-2 rounded-full mt-3 shrink-0 ${email.urgent ? 'bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.45)]' : email.unread ? 'bg-primary neon-pulse-unread' : 'bg-transparent'}`}></div>
      <div className={`w-8 h-8 rounded-full glass-avatar flex items-center justify-center text-sm font-semibold shrink-0 mt-0.5 hover:scale-110 transition-transform ${email.urgent ? 'border-rose-400/35 text-rose-300' : email.unread ? 'text-foreground' : 'text-text-muted'}`}>
        {email.initials}
      </div>
      <div className="flex-1 min-w-0 pr-4 group-hover:pr-32 group-focus-within:pr-32 [@media(hover:none)]:pr-32 transition-[padding]">
        <div className="flex items-center justify-between mb-1">
          <span className={`font-semibold text-[15px] truncate ${email.unread ? 'text-foreground' : 'text-text-muted font-medium'}`}>{email.sender}</span>
          <span className={`text-[13px] font-medium flex-shrink-0 ml-2 ${email.urgent ? 'text-rose-300' : email.unread ? 'text-primary' : 'text-text-muted'}`}>{email.time}</span>
        </div>
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className={`font-medium text-[14px] truncate ${email.unread ? 'text-foreground' : 'text-text-muted'}`}>{email.subject}</h3>
          {(email.messageCount ?? 1) > 1 && (
            <span
              aria-label={`${email.messageCount} messages in thread`}
              className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white/10 border border-white/15 text-[10px] font-bold text-text-muted shrink-0"
            >
              {email.messageCount}
            </span>
          )}
        </div>
        <p className={`text-[13px] leading-relaxed line-clamp-2 ${email.unread ? 'text-text-muted' : 'text-text-muted/70'}`}>{email.preview}</p>
      </div>

      <div
        className="action-bar absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-surface/92 backdrop-blur-md p-1.5 rounded-lg border border-white/10 shadow-2xl z-20
          opacity-0 pointer-events-none translate-x-2 transition-[opacity,transform] duration-150
          group-hover:opacity-100 group-hover:pointer-events-auto group-hover:translate-x-0
          group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-x-0
          [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:translate-x-0"
      >
        <button onClick={(e) => handleReply(email, e)} aria-label="Reply" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">reply</span>
        </button>
        <button onClick={(e) => { e.stopPropagation(); archiveEmail(accountId, email.id, e); showToast('Email archived', 'info'); }} aria-label="Archive" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">archive</span>
        </button>
        <button onClick={(e) => { e.stopPropagation(); toggleRead(accountId, email.id, e); }} aria-label={email.unread ? 'Mark as read' : 'Mark as unread'} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{email.unread ? 'mark_email_read' : 'mark_as_unread'}</span>
        </button>
        <div className="w-px h-4 bg-white/10 mx-1" aria-hidden="true"></div>
        <button onClick={(e) => { e.stopPropagation(); deleteEmail(accountId, email.id, e); }} aria-label="Move to trash" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-rose-500/20 text-text-muted hover:text-rose-300 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
        </button>
      </div>
    </div>
  );
});

interface EmailDetail {
  id: string;
  threadId?: string;
  messageCount?: number;
  subject: string;
  sender: string;
  senderEmail: string;
  time: string;
  body: string;
  bodyHtml?: string | null;
  loading: boolean;
  /** Expanded thread messages — populated when messageCount > 1 */
  threadMessages?: ThreadMessage[];
  threadLoading?: boolean;
}

interface CommunicationsProps {
  setCurrentView: SetViewFn;
  /** Increment to open the compose panel from outside (e.g. command palette). */
  externalComposeTrigger?: number;
}

function accountLabel(accountId: GmailAccountId) {
  return accountId === 'primary' ? 'Inbox 1' : 'Inbox 2';
}

function InboxPane({
  accountId,
  isActive,
  onActivate,
  onCloseView,
  externalComposeTrigger,
}: {
  accountId: GmailAccountId;
  isActive: boolean;
  onActivate: () => void;
  onCloseView: () => void;
  externalComposeTrigger?: number;
}) {
  const { state, actions } = useEmailContext();
  const { actions: { addTask } } = useTaskContext();
  const { showToast } = useToast();

  const emails = state.emailsByAccount[accountId];
  const gmailConnected = state.connectedByAccount[accountId];
  const emailsLoading = state.emailsLoadingByAccount[accountId];
  const serverError = state.serverErrorByAccount[accountId];

  const { toggleRead, archiveEmail, deleteEmail, refreshEmails, fetchThread } = actions;

  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const stateRef = React.useRef({ visibleEmails: [] as Email[], selectedIndex: 0, compose: null as ComposeState | null });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const [readerWide, setReaderWide] = useState(false);
  /** Set of message IDs that are currently expanded in the thread accordion */
  const [expandedMsgIds, setExpandedMsgIds] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<ListImperativeAPI | null>(null);
  const bodyCacheRef = useRef<Map<string, { body: string; bodyHtml: string | null; at: number }>>(new Map());
  const bodyPrefetchInflightRef = useRef<Set<string>>(new Set());
  const threadCacheRef = useRef<Map<string, { messages: ThreadMessage[]; at: number }>>(new Map());
  const threadPrefetchInflightRef = useRef<Set<string>>(new Set());

  // AI task extraction (primary only for now; server bulk endpoint assumes primary auth)
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [isAnalyzingDetail, setIsAnalyzingDetail] = useState(false);
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [suggestionContext, setSuggestionContext] = useState('');

  const handleAddSuggestions = (accepted: TaskSuggestion[]) => {
    for (const s of accepted) {
      const priority: TaskPriority | undefined = VALID_PRIORITIES.has(s.priority as TaskPriority)
        ? (s.priority as TaskPriority)
        : undefined;
      addTask({
        id: s.id,
        title: s.title,
        priority,
        completed: false,
        group: s.group,
        source: { type: 'email', id: s.emailId, label: 'AI suggestion' },
        createdAt: new Date().toISOString(),
        tags: ['email'],
      });
    }
    showToast(`${accepted.length} task${accepted.length !== 1 ? 's' : ''} added`, 'success');
    setSuggestions([]);
  };

  const lowerQuery = deferredSearchQuery.toLowerCase();
  const visibleEmails = useMemo(() => emails.filter(email =>
    !email.archived &&
    !email.deleted &&
    (!followUpOnly || isFollowUpEmail(email)) &&
    ((email.subject ?? '').toLowerCase().includes(lowerQuery) ||
     (email.sender ?? '').toLowerCase().includes(lowerQuery) ||
     (email.preview ?? '').toLowerCase().includes(lowerQuery))
  ), [emails, followUpOnly, lowerQuery]);

  const followUpCount = useMemo(
    () => emails.filter(email => isFollowUpEmail(email)).length,
    [emails],
  );

  const unreadCount = useMemo(
    () => emails.filter(e => e.unread && !e.archived && !e.deleted).length,
    [emails],
  );

  const detailStats = useMemo(() => {
    if (!detail?.body) return { words: 0, readMinutes: 0 };
    const words = detail.body.trim().split(/\s+/).filter(Boolean).length;
    return { words, readMinutes: Math.max(1, Math.ceil(words / 225)) };
  }, [detail?.body]);

  const openCompose = useCallback((prefill?: Partial<ComposeState>) => {
    setCompose({ ...EMPTY_COMPOSE, ...prefill });
  }, []);

  const addTaskFromEmail = useCallback((email: Pick<Email, 'id' | 'subject' | 'sender' | 'preview'>) => {
    addTask(buildTaskFromEmail(email));
    showToast('Email task added', 'success');
  }, [addTask, showToast]);

  const addTaskFromDetail = useCallback(() => {
    if (!detail) return;
    addTaskFromEmail({
      id: detail.id,
      subject: detail.subject,
      sender: detail.sender,
      preview: detail.body ? detail.body.slice(0, 220) : `Email from ${detail.sender}`,
    });
  }, [addTaskFromEmail, detail]);

  const copyDetailSender = useCallback(async () => {
    if (!detail?.senderEmail) return;
    try {
      await navigator.clipboard.writeText(detail.senderEmail);
      showToast('Sender copied', 'success');
    } catch {
      showToast('Could not copy sender', 'error');
    }
  }, [detail, showToast]);

  const archiveDetail = useCallback(() => {
    if (!detail) return;
    archiveEmail(accountId, detail.id);
    setDetail(null);
    showToast('Email archived', 'info');
  }, [accountId, archiveEmail, detail, showToast]);

  const deleteDetail = useCallback(() => {
    if (!detail) return;
    deleteEmail(accountId, detail.id);
    setDetail(null);
    showToast('Email moved to trash', 'info');
  }, [accountId, deleteEmail, detail, showToast]);

  const markDetailUnread = useCallback(() => {
    if (!detail) return;
    toggleRead(accountId, detail.id);
    showToast('Email marked unread', 'info');
  }, [accountId, detail, showToast, toggleRead]);

  const analyzeDetailEmail = useCallback(async () => {
    if (!detail) return;
    if (accountId !== 'primary') {
      showToast('AI analysis is currently only enabled for Inbox 1', 'info');
      return;
    }

    setIsAnalyzingDetail(true);
    try {
      const res = await fetch('/api/ai/extract-tasks-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ emailIds: [detail.id] }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'NO_AI_KEY') showToast('AI not configured — add your OpenAI key in Settings.', 'error');
        else showToast(data.error ?? 'Failed to analyze email', 'error');
        return;
      }
      if (!data.suggestions?.length) {
        showToast('No actionable task found in this email', 'info');
        return;
      }
      setSuggestions(data.suggestions);
      setSuggestionContext(detail.subject || 'selected email');
    } catch {
      showToast('Failed to reach the AI service', 'error');
    } finally {
      setIsAnalyzingDetail(false);
    }
  }, [accountId, detail, showToast]);

  const analyzeAllUnread = async () => {
    if (accountId !== 'primary') {
      showToast('AI analysis is currently only enabled for Inbox 1', 'info');
      return;
    }
    const ids = visibleEmails.filter(e => e.unread).slice(0, 10).map(e => e.id);
    if (ids.length === 0) { showToast('No unread emails to analyze', 'info'); return; }
    setIsAnalyzingAll(true);
    try {
      const res = await fetch('/api/ai/extract-tasks-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ emailIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === 'NO_AI_KEY') showToast('AI not configured — add your OpenAI key in Settings.', 'error');
        else showToast(data.error ?? 'Failed to analyze emails', 'error');
        return;
      }
      if (data.suggestions.length === 0) { showToast('No actionable tasks found in unread emails', 'info'); return; }
      setSuggestions(data.suggestions);
      setSuggestionContext(`${ids.length} unread email${ids.length !== 1 ? 's' : ''}`);
    } catch {
      showToast('Failed to reach the AI service', 'error');
    } finally {
      setIsAnalyzingAll(false);
    }
  };

  // Reset keyboard selection whenever the visible list changes (search or refresh)
  useEffect(() => { setSelectedIndex(0); }, [visibleEmails]);
  useEffect(() => {
    listRef.current?.scrollToRow({ index: selectedIndex, align: 'smart' });
  }, [selectedIndex]);

  // Open compose when triggered from outside (e.g. command palette)
  useEffect(() => {
    if (!externalComposeTrigger) return;
    openCompose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalComposeTrigger]);

  // Keep a ref in sync so the keyboard handler never needs to re-register
  stateRef.current.visibleEmails = visibleEmails;
  stateRef.current.selectedIndex = selectedIndex;
  stateRef.current.compose = compose;

  const prefetchBody = useCallback((emailId: string) => {
    const cached = bodyCacheRef.current.get(emailId);
    if (cached && (Date.now() - cached.at) < 5 * 60_000) return;
    if (bodyPrefetchInflightRef.current.has(emailId)) return;
    bodyPrefetchInflightRef.current.add(emailId);

    const run = () => {
      fetch(`/api/gmail/message/${emailId}?accountId=${encodeURIComponent(accountId)}`)
        .then(r => r.ok ? r.json() : null)
        .then((data: unknown) => {
          const d = data as { body?: unknown; bodyHtml?: unknown } | null;
          if (!d) return;
          bodyCacheRef.current.set(emailId, {
            body: typeof d.body === 'string' ? d.body : '',
            bodyHtml: typeof d.bodyHtml === 'string' ? d.bodyHtml : null,
            at: Date.now(),
          });
        })
        .catch(() => {})
        .finally(() => { bodyPrefetchInflightRef.current.delete(emailId); });
    };

    // Prefer idle time so hover doesn't block UI on slower devices.
    const ric = getRequestIdleCallback();
    if (ric) ric(run, { timeout: 800 });
    else setTimeout(run, 120);
  }, [accountId]);

  const prefetchThread = useCallback((threadId: string) => {
    const key = `${accountId}:${threadId}`;
    const cached = threadCacheRef.current.get(key);
    if (cached && (Date.now() - cached.at) < 5 * 60_000) return;
    if (threadPrefetchInflightRef.current.has(key)) return;
    threadPrefetchInflightRef.current.add(key);

    const run = async () => {
      try {
        const messages = await fetchThread(accountId, threadId);
        threadCacheRef.current.set(key, { messages, at: Date.now() });
      } catch {
        // ignore
      } finally {
        threadPrefetchInflightRef.current.delete(key);
      }
    };

    const ric = getRequestIdleCallback();
    if (ric) ric(() => { void run(); }, { timeout: 1200 });
    else setTimeout(() => { void run(); }, 200);
  }, [accountId, fetchThread]);

  const openDetail = useCallback(async (email: Email) => {
    onActivate();
    // Reset thread expansion — newest message (last in list) will auto-expand after load
    setExpandedMsgIds(new Set());
    setReaderWide(false);
    setDetail({
      id: email.id,
      threadId: email.threadId,
      messageCount: email.messageCount,
      subject: email.subject,
      sender: email.sender,
      senderEmail: email.senderEmail ?? '',
      time: email.time,
      body: '',
      bodyHtml: null,
      loading: true,
      threadMessages: undefined,
      threadLoading: (email.messageCount ?? 1) > 1,
    });
    if (email.unread) {
      toggleRead(accountId, email.id); // no event needed — programmatic call
    }
    // Fetch single-message body (use prefetched cache when available)
    const cached = bodyCacheRef.current.get(email.id);
    if (cached) {
      setDetail(prev => prev?.id === email.id ? {
        ...prev,
        body: cached.body,
        bodyHtml: cached.bodyHtml,
        loading: false,
      } : prev);
    } else {
      try {
        const res = await fetch(`/api/gmail/message/${email.id}?accountId=${encodeURIComponent(accountId)}`);
        if (res.ok) {
          const data = await res.json();
          const body = typeof data.body === 'string' ? data.body : '';
          const bodyHtml = typeof data.bodyHtml === 'string' ? data.bodyHtml : null;
          bodyCacheRef.current.set(email.id, { body, bodyHtml, at: Date.now() });
          setDetail(prev => prev?.id === email.id ? {
            ...prev,
            body,
            bodyHtml,
            loading: false,
          } : prev);
        } else {
          setDetail(prev => prev?.id === email.id ? {
            ...prev,
            body: '(Could not load message body)',
            bodyHtml: null,
            loading: false,
          } : prev);
        }
      } catch {
        setDetail(prev => prev?.id === email.id ? {
          ...prev,
          body: '(Failed to fetch message)',
          bodyHtml: null,
          loading: false,
        } : prev);
      }
    }
    // Fetch full thread when conversation has more than one message
    if ((email.messageCount ?? 1) > 1 && email.threadId) {
      const threadId = email.threadId;
      const key = `${accountId}:${threadId}`;
      const cachedThread = threadCacheRef.current.get(key);
      if (cachedThread) {
        const messages = cachedThread.messages;
        setDetail(prev => prev?.id === email.id ? { ...prev, threadMessages: messages, threadLoading: false } : prev);
        if (messages.length > 0) setExpandedMsgIds(new Set([messages[messages.length - 1].id]));
      } else {
        const messages = await fetchThread(accountId, threadId);
        threadCacheRef.current.set(key, { messages, at: Date.now() });
        setDetail(prev =>
          prev?.id === email.id ? { ...prev, threadMessages: messages, threadLoading: false } : prev,
        );
        // Auto-expand the latest message (last in the list)
        if (messages.length > 0) {
          setExpandedMsgIds(new Set([messages[messages.length - 1].id]));
        }
      }
    }
  }, [accountId, fetchThread, onActivate, toggleRead]);

  const handleReply = useCallback((email: Email, e: React.MouseEvent) => {
    e.stopPropagation();
    openCompose({
      to: email.senderEmail ?? email.sender,
      subject: email.subject ? `Re: ${email.subject}` : '',
    });
  }, [openCompose]);

  type InboxRowProps = {
    accountId: GmailAccountId;
    visibleEmails: Email[];
    selectedIndex: number;
    prefetchBody: (emailId: string) => void;
    prefetchThread: (threadId: string) => void;
    onActivate: () => void;
    setSelectedIndex: (n: number) => void;
    openDetail: (email: Email) => void;
    handleReply: (email: Email, e: React.MouseEvent) => void;
    archiveEmail: (accountId: GmailAccountId, id: string, e?: React.MouseEvent) => void;
    toggleRead: (accountId: GmailAccountId, id: string, e?: React.MouseEvent) => void;
    deleteEmail: (accountId: GmailAccountId, id: string, e?: React.MouseEvent) => void;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  };

  const rowHeight = useCallback((index: number, props: InboxRowProps) => {
    const prev = props.visibleEmails[index - 1];
    const cur = props.visibleEmails[index];
    const needsDivider = index > 0 && prev?.unread && !cur?.unread;
    return EMAIL_ROW_PX + (needsDivider ? UNREAD_DIVIDER_PX : 0);
  }, []);

  const RowComponent = useCallback((p: RowComponentProps<InboxRowProps>) => {
    const { index, style, ...rest } = p;
    const email = rest.visibleEmails[index];
    if (!email) return null;
    const prev = rest.visibleEmails[index - 1];
    const needsDivider = index > 0 && prev?.unread && !email.unread;
    return (
      <div style={style}>
        <div className="px-2">
          {needsDivider && <div className="w-full h-px bg-white/5 my-2" />}
          <EmailRow
            accountId={rest.accountId}
            email={email}
            index={index}
            selected={index === rest.selectedIndex}
            onActivate={rest.onActivate}
            setSelectedIndex={rest.setSelectedIndex}
            openDetail={rest.openDetail}
            onPrefetchBody={rest.prefetchBody}
            onPrefetchThread={rest.prefetchThread}
            handleReply={rest.handleReply}
            archiveEmail={rest.archiveEmail}
            toggleRead={rest.toggleRead}
            deleteEmail={rest.deleteEmail}
            showToast={rest.showToast}
          />
        </div>
      </div>
    );
  }, []);

  const handleSend = async () => {
    if (!compose) return;
    if (!isValidEmail(compose.to)) {
      setCompose(c => c ? { ...c, error: 'Invalid recipient email address' } : null);
      return;
    }
    setCompose(c => c ? { ...c, sending: true, error: null } : null);
    try {
      const res = await fetch(`/api/gmail/send?accountId=${encodeURIComponent(accountId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ to: compose.to, subject: compose.subject, body: compose.body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? 'Failed to send');
      }
      setCompose(null);
      showToast('Email sent!', 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setCompose(c => c ? { ...c, sending: false, error: message } : null);
    }
  };

  // Keyboard shortcuts — only active in the last-activated pane
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA';
      const { compose: c, visibleEmails: current, selectedIndex: idx } = stateRef.current;

      if (e.key === 'Escape') {
        e.preventDefault();
        if (c) { setCompose(null); return; }
        if (detail) { setDetail(null); return; }
        onCloseView();
        return;
      }

      if (isInput) return;

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setCompose({ ...EMPTY_COMPOSE });
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, current.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        const email = current[idx];
        if (email) {
          archiveEmail(accountId, email.id); // no event needed — keyboard handler
          showToast('Email archived', 'info');
          setSelectedIndex(i => Math.max(i - 1, 0));
        }
      }
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        if (detail) {
          addTaskFromDetail();
          return;
        }
        const email = current[idx];
        if (email) addTaskFromEmail(email);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [accountId, addTaskFromDetail, addTaskFromEmail, archiveEmail, detail, isActive, onCloseView, showToast]);

  return (
    <div className={`flex-1 min-w-0 min-h-0 flex flex-col border-white/10 ${isActive ? 'bg-white/[0.02]' : ''}`} onMouseDown={onActivate}>
      {/* Pane header */}
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4 border-b border-white/10 shrink-0 bg-background-elevated/55">
        <div className="flex items-center gap-3">
          <h2 className="font-heading font-semibold text-xl text-foreground">{accountLabel(accountId)}</h2>
          <div className="flex h-6 items-center justify-center gap-x-2 rounded-full bg-primary/10 px-3 border border-primary/20">
            {unreadCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>}
            <p className="text-primary text-xs font-medium uppercase tracking-wider">{unreadCount} Unread</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setFollowUpOnly(v => !v)}
            aria-pressed={followUpOnly}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
              followUpOnly
                ? 'text-amber-200 bg-amber-300/10 border-amber-300/25'
                : 'text-text-muted bg-white/[0.04] border-white/10 hover:text-foreground'
            }`}
          >
            <span className="material-symbols-outlined !text-sm" aria-hidden="true">flag</span>
            <span className="hidden xl:inline">Follow-ups</span>
            {followUpCount}
          </button>
          <button
            onClick={analyzeAllUnread}
            disabled={isAnalyzingAll || !gmailConnected || accountId !== 'primary'}
            aria-label="Analyze all unread emails with AI"
            title={accountId === 'primary' ? 'Extract tasks from all unread emails' : 'AI analysis is currently only enabled for Inbox 1'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider text-primary bg-primary/10 border border-primary/25 transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {isAnalyzingAll
              ? <span className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-hidden="true" />
              : <span className="material-symbols-outlined !text-sm" aria-hidden="true">auto_awesome</span>
            }
            Analyze
          </button>
          <button
            onClick={() => refreshEmails(accountId)}
            disabled={emailsLoading}
            aria-label="Refresh inbox"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-text-muted hover:text-foreground disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className={`material-symbols-outlined text-[20px] ${emailsLoading ? 'animate-spin' : ''}`} aria-hidden="true">refresh</span>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-5 py-4 border-b border-white/10 shrink-0 bg-background-elevated/30">
        <div className="glass-search flex items-center gap-3 px-4 py-2.5 rounded-lg">
          <span className="material-symbols-outlined text-text-muted text-[20px]" aria-hidden="true">search</span>
          <input
            ref={searchRef}
            aria-label="Search emails"
            name="email-search"
            autoComplete="off"
            className="bg-transparent border-none focus-visible:ring-1 focus-visible:ring-primary/40 text-[14px] text-foreground placeholder-text-muted w-full p-0 rounded"
            placeholder="Search…"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={onActivate}
          />
          <span className="hidden xl:inline-flex shrink-0 rounded-full border border-white/10 bg-white/[0.035] px-2 py-0.5 text-[10px] font-mono text-text-muted">
            {visibleEmails.length}
          </span>
        </div>
      </div>

      {/* Inbox list uses full pane width; opened message is a full-pane overlay (readable on split-screen). */}
      <div className="flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden relative">
        <div className="flex-1 min-h-0 flex flex-col min-w-0 relative">
          <div
            className="flex-1 overflow-hidden relative min-w-0"
            aria-hidden={!!detail}
          >
            {!gmailConnected ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4">
                <span className="material-symbols-outlined text-4xl" aria-hidden="true">{serverError ? 'cloud_off' : 'mail'}</span>
                {serverError ? (
                  <>
                    <p className="text-sm">Server unreachable. Make sure the app is running.</p>
                    <button
                      onClick={() => refreshEmails(accountId)}
                      className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm">Connect Gmail to see this inbox.</p>
                    <p className="text-xs text-text-muted/80">Open Integrations → Google (Secondary).</p>
                  </>
                )}
              </div>
            ) : visibleEmails.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-text-muted">
                <span className="material-symbols-outlined text-4xl" aria-hidden="true">
                  {searchQuery || followUpOnly ? 'search_off' : 'inbox'}
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {searchQuery || followUpOnly ? 'No Matching Emails' : 'Inbox Zero'}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {searchQuery || followUpOnly ? 'Try clearing filters or searching a different sender, subject, or preview.' : 'Nothing needs triage in this inbox.'}
                  </p>
                </div>
                {(searchQuery || followUpOnly) && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(''); setFollowUpOnly(false); searchRef.current?.focus(); }}
                    className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-white/[0.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <AutoSizer
                renderProp={({ height, width }) => {
                  if (!height || !width) return null;
                  return (
                    <List
                      // Reset internal measurements when the filtered list changes.
                      key={`${accountId}:${visibleEmails.length}:${visibleEmails[0]?.id ?? ''}`}
                      listRef={listRef}
                      style={{ height, width }}
                      rowCount={visibleEmails.length}
                      rowHeight={rowHeight}
                      rowComponent={RowComponent}
                      rowProps={{
                        accountId,
                        visibleEmails,
                        selectedIndex,
                        prefetchBody,
                        prefetchThread,
                        onActivate,
                        setSelectedIndex,
                        openDetail,
                        handleReply,
                        archiveEmail,
                        toggleRead,
                        deleteEmail,
                        showToast,
                      }}
                      overscanCount={8}
                      className="custom-scrollbar"
                    />
                  );
                }}
              />
            )}
          </div>

          {!detail && (
            <button
              onClick={() => openCompose()}
              aria-label="Compose new email"
              className="fab-compose absolute bottom-8 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-primary text-background-dark flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform z-30 group focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
            >
              <span className="material-symbols-outlined text-[28px] font-bold" aria-hidden="true">edit</span>
            </button>
          )}

          {detail && (
            <div
              className={`${readerWide ? 'fixed inset-6 z-[650] rounded-xl border border-white/15 shadow-2xl' : 'absolute inset-0 z-40 border-t border-white/10 shadow-[0_-12px_48px_rgba(0,0,0,0.35)]'} flex flex-col min-w-0 overflow-hidden bg-background-elevated/97 backdrop-blur-md`}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`email-detail-title-${accountId}`}
            >
              <div className="shrink-0 border-b border-white/10 bg-background-elevated/90">
                <div className="flex items-start gap-2 sm:gap-3 px-3 sm:px-5 py-3">
                  <button
                    type="button"
                    onClick={() => setDetail(null)}
                    aria-label="Back to inbox"
                    className="w-9 h-9 shrink-0 mt-0.5 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="material-symbols-outlined text-[22px]" aria-hidden="true">arrow_back</span>
                  </button>
                  <div className="flex-1 min-w-0 py-0.5">
                    <div className="flex items-start gap-2 flex-wrap">
                      <h3 id={`email-detail-title-${accountId}`} className="font-heading font-semibold text-base sm:text-xl text-white break-words min-w-0 flex-1 leading-snug">
                        {detail.subject}
                      </h3>
                      {(detail.messageCount ?? 1) > 1 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-bold text-primary shrink-0">
                          <span className="material-symbols-outlined !text-[12px]" aria-hidden="true">forum</span>
                          {detail.messageCount}
                        </span>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-text-muted mt-1 break-all line-clamp-2">
                      {detail.sender} &lt;{detail.senderEmail}&gt; · {detail.time}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 pt-0.5">
                    <button
                      type="button"
                      onClick={analyzeDetailEmail}
                      disabled={isAnalyzingDetail || accountId !== 'primary'}
                      aria-label="Analyze this email for tasks"
                      className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-primary disabled:opacity-35 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className={`material-symbols-outlined text-[20px] ${isAnalyzingDetail ? 'animate-spin' : ''}`} aria-hidden="true">
                        {isAnalyzingDetail ? 'progress_activity' : 'auto_awesome'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={addTaskFromDetail}
                      aria-label="Create task from this email"
                      className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">add_task</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openCompose({ to: detail.senderEmail, subject: `Re: ${detail.subject}` })}
                      aria-label="Reply to this email"
                      className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">reply</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReaderWide(v => !v)}
                      aria-label={readerWide ? 'Exit wide reader' : 'Open wide reader'}
                      className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{readerWide ? 'close_fullscreen' : 'open_in_full'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetail(null)}
                      aria-label="Close email"
                      className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 bg-background-dark/35 px-4 sm:px-5 py-2.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${detail.bodyHtml ? 'border-primary/20 bg-primary/10 text-primary' : 'border-white/10 bg-white/[0.035] text-text-muted'}`}>
                      <span className="material-symbols-outlined !text-[14px]" aria-hidden="true">
                        {detail.bodyHtml ? 'web_asset' : 'subject'}
                      </span>
                      {detail.bodyHtml ? 'Gmail Layout' : 'Text Fallback'}
                    </span>
                    <span className="inline-flex rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] text-text-muted">
                      {detailStats.words > 0 ? `${detailStats.readMinutes} Min Read` : 'Loading…'}
                    </span>
                    {(detail.messageCount ?? 1) > 1 && (
                      <span className="inline-flex rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] text-text-muted">
                        Thread View
                      </span>
                    )}
                    <span className="hidden md:inline-flex min-w-0 max-w-[280px] truncate rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] text-text-muted">
                      {detail.senderEmail}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={copyDetailSender}
                      aria-label="Copy sender address"
                      className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-foreground hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined !text-[18px]" aria-hidden="true">content_copy</span>
                    </button>
                    <button
                      type="button"
                      onClick={markDetailUnread}
                      aria-label="Mark email unread"
                      className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-foreground hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined !text-[18px]" aria-hidden="true">mark_as_unread</span>
                    </button>
                    <button
                      type="button"
                      onClick={archiveDetail}
                      aria-label="Archive email"
                      className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-foreground hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined !text-[18px]" aria-hidden="true">archive</span>
                    </button>
                    <button
                      type="button"
                      onClick={deleteDetail}
                      aria-label="Move email to trash"
                      className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-rose-300 hover:bg-rose-500/15 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="material-symbols-outlined !text-[18px]" aria-hidden="true">delete</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar min-w-0 bg-background-dark/20">
                <div className={`mx-auto w-full ${readerWide ? 'max-w-5xl' : 'max-w-3xl'} px-4 sm:px-8 py-6 pb-16 min-w-0`}>
                  {(detail.messageCount ?? 1) <= 1 ? (
                    detail.loading ? (
                      <div className="flex items-center justify-center py-20">
                        <div className="w-7 h-7 rounded-full border-2 border-primary border-t-transparent animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      </div>
                    ) : (
                      <EmailBodyDisplay plain={detail.body} html={detail.bodyHtml} />
                    )
                  ) : detail.threadLoading || !detail.threadMessages ? (
                    <div className="flex items-center justify-center py-20">
                      <div className="w-7 h-7 rounded-full border-2 border-primary border-t-transparent animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    </div>
                  ) : (
                    <div className="flex flex-col rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-white/5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-background-elevated/40">
                        <span className="text-xs text-text-muted font-medium">
                          {detail.threadMessages.length} message{detail.threadMessages.length !== 1 ? 's' : ''} in conversation
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setExpandedMsgIds(new Set(detail.threadMessages!.map(m => m.id)))}
                            className="text-xs text-primary hover:underline font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded px-2 py-1"
                          >
                            Expand all
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedMsgIds(new Set([detail.threadMessages![detail.threadMessages!.length - 1].id]))}
                            className="text-xs text-text-muted hover:text-primary hover:underline font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded px-2 py-1"
                          >
                            Collapse all
                          </button>
                        </div>
                      </div>
                      <ThreadMessagesList
                        accountId={accountId}
                        messages={detail.threadMessages}
                        expanded={expandedMsgIds}
                        setExpanded={setExpandedMsgIds}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compose Modal */}
      {compose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-[600px] rounded-xl overflow-hidden flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-background-elevated/70">
              <h2 className="font-heading font-semibold text-lg text-white" id="compose-title">New Message</h2>
              <button onClick={() => setCompose(null)} aria-label="Discard and close" className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-white transition-colors hover:rotate-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center gap-3 border-b border-white/10 pb-3">
                <label htmlFor="compose-to" className="text-xs text-text-muted w-12 shrink-0">To</label>
                <input
                  id="compose-to"
                  name="to"
                  type="email"
                  autoComplete="email"
                  className="flex-1 bg-transparent text-sm text-white placeholder-text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
                  placeholder="recipient@example.com"
                  value={compose.to}
                  onChange={e => setCompose(c => c ? { ...c, to: e.target.value } : null)}
                />
              </div>
              <div className="flex items-center gap-3 border-b border-white/10 pb-3">
                <label htmlFor="compose-subject" className="text-xs text-text-muted w-12 shrink-0">Subject</label>
                <input
                  id="compose-subject"
                  name="subject"
                  autoComplete="off"
                  className="flex-1 bg-transparent text-sm text-white placeholder-text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
                  placeholder="Subject…"
                  value={compose.subject}
                  onChange={e => setCompose(c => c ? { ...c, subject: e.target.value } : null)}
                />
              </div>
              <textarea
                id="compose-body"
                name="body"
                aria-label="Message body"
                className="w-full bg-transparent text-sm text-white placeholder-text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded resize-none h-40 custom-scrollbar"
                placeholder="Write your message…"
                value={compose.body}
                onChange={e => setCompose(c => c ? { ...c, body: e.target.value } : null)}
              />
              {compose.error && (
                <p className="text-xs text-red-400" aria-live="polite">{compose.error}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-white/10 bg-background-elevated/55 flex items-center justify-between">
              <button onClick={() => setCompose(null)} className="text-sm text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded">
                Discard
              </button>
              <button
                onClick={handleSend}
                disabled={compose.sending || !isValidEmail(compose.to) || !compose.subject.trim() || !compose.body.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-background-dark text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_14px_rgba(56,189,248,0.28)]"
              >
                {compose.sending ? (
                  <span className="w-4 h-4 rounded-full border-2 border-background-dark border-t-transparent animate-spin motion-reduce:animate-none" aria-hidden="true"></span>
                ) : (
                  <span className="material-symbols-outlined text-[18px]" aria-hidden="true">send</span>
                )}
                {compose.sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Task Suggestion Modal */}
      {suggestions.length > 0 && (
        <TaskSuggestionModal
          suggestions={suggestions}
          context={suggestionContext}
          onAdd={handleAddSuggestions}
          onClose={() => setSuggestions([])}
        />
      )}
    </div>
  );
}

export default function Communications({ setCurrentView, externalComposeTrigger }: CommunicationsProps) {
  const [activePane, setActivePane] = useState<GmailAccountId>('primary');

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 p-4 sm:p-6">
      <div className="glass-panel w-full max-w-none flex-1 min-h-0 mx-auto flex flex-col rounded-xl relative overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-white/10 shrink-0 bg-background-elevated/55">
          <div className="flex min-w-0 items-center gap-3">
            <span className="material-symbols-outlined flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary" aria-hidden="true">
              mark_email_unread
            </span>
            <div className="min-w-0">
              <h1 className="font-heading font-semibold text-2xl text-foreground text-pretty">Inbox Triage</h1>
              <p className="hidden sm:block truncate text-xs text-text-muted">Review mail, extract tasks, and clear what does not need attention.</p>
            </div>
          </div>
          <button
            onClick={() => setCurrentView('MainHub')}
            aria-label="Close communications"
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors hover:rotate-90 text-text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="flex-1 min-w-0 min-h-0 flex border-r border-white/10">
            <InboxPane
              accountId="primary"
              isActive={activePane === 'primary'}
              onActivate={() => setActivePane('primary')}
              onCloseView={() => setCurrentView('MainHub')}
              externalComposeTrigger={externalComposeTrigger}
            />
          </div>
          <div className="flex-1 min-w-0 min-h-0 flex">
            <InboxPane
              accountId="secondary"
              isActive={activePane === 'secondary'}
              onActivate={() => setActivePane('secondary')}
              onCloseView={() => setCurrentView('MainHub')}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
