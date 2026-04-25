import React, { useState, useEffect, useRef, useMemo } from 'react';

import { Email, ThreadMessage } from '../types/email';
import { useEmailContext } from '../contexts/emailContext';
import { useTaskContext } from '../contexts/taskContext';
import { useToast } from '../components/Toast';
import TaskSuggestionModal from '../components/TaskSuggestionModal';
import { TaskSuggestion } from '../types/taskSuggestion';
import type { TaskPriority } from '../types/task';
import { csrfHeaders } from '../lib/csrf';
import type { SetViewFn } from '../config/navigation';

interface ComposeState {
  to: string;
  subject: string;
  body: string;
  sending: boolean;
  error: string | null;
}

const EMPTY_COMPOSE: ComposeState = { to: '', subject: '', body: '', sending: false, error: null };
const KEYBOARD_SHORTCUTS = [['C', 'Compose'], ['E', 'Archive'], ['Esc', 'Close'], ['↑↓', 'Navigate']] as const;
/** Mirrors the server-side check — catches typos before the round-trip */
const isValidEmail = (addr: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.trim());
/** Valid task priority values — declared at module level to avoid per-render Set creation */
const VALID_PRIORITIES = new Set<TaskPriority>(['Priority', 'Critical']);

interface EmailDetail {
  id: string;
  threadId?: string;
  messageCount?: number;
  subject: string;
  sender: string;
  senderEmail: string;
  time: string;
  body: string;
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

export default function Communications({ setCurrentView, externalComposeTrigger }: CommunicationsProps) {
  const { state: { emails, gmailConnected, emailsLoading, serverError }, actions: { toggleRead, archiveEmail, deleteEmail, refreshEmails, fetchThread } } = useEmailContext();
  const { actions: { addTask } } = useTaskContext();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const stateRef = React.useRef({ visibleEmails: [] as Email[], selectedIndex: 0, compose: null as ComposeState | null });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  /** Set of message IDs that are currently expanded in the thread accordion */
  const [expandedMsgIds, setExpandedMsgIds] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // AI task extraction
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [suggestionContext, setSuggestionContext] = useState('');

  const analyzeAllUnread = async () => {
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
        if (data.code === 'NO_AI_KEY') showToast('AI not configured — add an OpenAI key in Settings (or set OPENAI_API_KEY).', 'error');
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

  const handleAddSuggestions = (accepted: TaskSuggestion[]) => {
    for (const s of accepted) {
      const priority: TaskPriority | undefined = VALID_PRIORITIES.has(s.priority as TaskPriority)
        ? (s.priority as TaskPriority)
        : undefined;
      addTask({ id: s.id, title: s.title, priority, completed: false, group: s.group });
    }
    showToast(`${accepted.length} task${accepted.length !== 1 ? 's' : ''} added`, 'success');
    setSuggestions([]);
  };

  const lowerQuery = searchQuery.toLowerCase();
  const visibleEmails = useMemo(() => emails.filter(email =>
    !email.archived &&
    !email.deleted &&
    ((email.subject ?? '').toLowerCase().includes(lowerQuery) ||
     (email.sender ?? '').toLowerCase().includes(lowerQuery) ||
     (email.preview ?? '').toLowerCase().includes(lowerQuery))
  ), [emails, lowerQuery]);

  const unreadCount = emails.filter(e => e.unread && !e.archived && !e.deleted).length;

  // Reset keyboard selection whenever the visible list changes (search or refresh)
  useEffect(() => { setSelectedIndex(0); }, [visibleEmails]);

  // Open compose when triggered from outside (e.g. command palette)
  useEffect(() => {
    if (!externalComposeTrigger) return;
    setCompose(EMPTY_COMPOSE);
  }, [externalComposeTrigger]);

  // Keep a ref in sync so the keyboard handler never needs to re-register
  stateRef.current.visibleEmails = visibleEmails;
  stateRef.current.selectedIndex = selectedIndex;
  stateRef.current.compose = compose;

  const openCompose = (prefill?: Partial<ComposeState>) => {
    setCompose({ ...EMPTY_COMPOSE, ...prefill });
  };

  const openDetail = async (email: Email) => {
    // Reset thread expansion — newest message (last in list) will auto-expand after load
    setExpandedMsgIds(new Set());
    setDetail({
      id: email.id,
      threadId: email.threadId,
      messageCount: email.messageCount,
      subject: email.subject,
      sender: email.sender,
      senderEmail: email.senderEmail ?? '',
      time: email.time,
      body: '',
      loading: true,
      threadMessages: undefined,
      threadLoading: (email.messageCount ?? 1) > 1,
    });
    if (email.unread) {
      toggleRead(email.id); // no event needed — programmatic call
    }
    // Fetch single-message body
    try {
      const res = await fetch(`/api/gmail/message/${email.id}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(prev => prev?.id === email.id ? { ...prev, body: data.body, loading: false } : prev);
      } else {
        setDetail(prev => prev?.id === email.id ? { ...prev, body: '(Could not load message body)', loading: false } : prev);
      }
    } catch {
      setDetail(prev => prev?.id === email.id ? { ...prev, body: '(Failed to fetch message)', loading: false } : prev);
    }
    // Fetch full thread when conversation has more than one message
    if ((email.messageCount ?? 1) > 1 && email.threadId) {
      const threadId = email.threadId;
      const messages = await fetchThread(threadId);
      setDetail(prev =>
        prev?.id === email.id ? { ...prev, threadMessages: messages, threadLoading: false } : prev,
      );
      // Auto-expand the latest message (last in the list)
      if (messages.length > 0) {
        setExpandedMsgIds(new Set([messages[messages.length - 1].id]));
      }
    }
  };

  const handleReply = (email: Email, e: React.MouseEvent) => {
    e.stopPropagation();
    openCompose({
      to: email.senderEmail ?? email.sender,
      subject: email.subject ? `Re: ${email.subject}` : '',
    });
  };

  const handleSend = async () => {
    if (!compose) return;
    if (!isValidEmail(compose.to)) {
      setCompose(c => c ? { ...c, error: 'Invalid recipient email address' } : null);
      return;
    }
    setCompose(c => c ? { ...c, sending: true, error: null } : null);
    try {
      const res = await fetch('/api/gmail/send', {
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

  // Keyboard shortcuts — registered once, reads latest values from stateRef
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA';
      const { compose: c, visibleEmails: emails, selectedIndex: idx } = stateRef.current;

      if (e.key === 'Escape') {
        if (c) { setCompose(null); return; }
        setCurrentView('MainHub');
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
        setSelectedIndex(i => Math.min(i + 1, emails.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        const email = emails[idx];
        if (email) {
          archiveEmail(email.id); // no event needed — keyboard handler
          showToast('Email archived', 'info');
          setSelectedIndex(i => Math.max(i - 1, 0));
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setCurrentView, archiveEmail, showToast]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 p-8">
      <div className="glass-panel w-full max-w-[1200px] flex-1 min-h-0 mx-auto flex flex-col rounded-xl relative overflow-hidden">
        {/* Header */}
        <div className="flex flex-col border-b border-white/10 shrink-0 bg-background-elevated/55">
          <div className="flex items-center justify-between px-6 pt-5 pb-4">
            <div className="flex items-center gap-4 group">
              <h1 className="font-heading font-semibold text-2xl text-foreground group-hover:text-primary transition-colors cursor-default">Inbox Triage</h1>
              <div className="flex h-6 items-center justify-center gap-x-2 rounded-full bg-primary/10 px-3 border border-primary/20 shadow-[0_0_10px_rgba(6,232,249,0.2)]">
                {unreadCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>}
                <p className="text-primary text-xs font-medium uppercase tracking-wider">{unreadCount} Unread</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={analyzeAllUnread}
                disabled={isAnalyzingAll || !gmailConnected}
                aria-label="Analyze all unread emails with AI"
                title="Extract tasks from all unread emails"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider text-primary bg-primary/10 border border-primary/25 transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {isAnalyzingAll
                  ? <span className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-hidden="true" />
                  : <span className="material-symbols-outlined !text-sm" aria-hidden="true">auto_awesome</span>
                }
                Analyze all
              </button>
              <button
                onClick={refreshEmails}
                disabled={emailsLoading}
                aria-label="Refresh inbox"
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-text-muted hover:text-foreground disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className={`material-symbols-outlined text-[20px] ${emailsLoading ? 'animate-spin' : ''}`} aria-hidden="true">refresh</span>
              </button>
              <button
                onClick={() => setCurrentView('MainHub')}
                aria-label="Close communications"
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors hover:rotate-90 text-text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="px-6 pb-5">
            <div className="glass-search flex items-center gap-3 px-4 py-2.5 rounded-xl">
              <span className="material-symbols-outlined text-text-muted text-[20px]" aria-hidden="true">search</span>
              <input
                ref={searchRef}
                aria-label="Search emails"
                name="email-search"
                autoComplete="off"
                className="bg-transparent border-none focus:ring-0 text-[14px] text-foreground placeholder-text-muted w-full p-0"
                placeholder="Search emails, people, or keywords…"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-text-muted text-[10px] font-mono">⌘</span>
                <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-text-muted text-[10px] font-mono">K</span>
              </div>
            </div>
          </div>
        </div>

        {/* Email List + Detail Split */}
        <div className="flex-1 min-h-0 flex overflow-hidden relative">
          {/* Left: Email List */}
          <div className={`flex flex-col overflow-hidden transition-[width,flex] duration-300 ${detail ? 'w-80 flex-none border-r border-white/10' : 'flex-1'}`}>
            <div
              className="flex-1 overflow-y-auto overflow-x-hidden p-2 relative"
              style={{ contentVisibility: 'auto' as any, containIntrinsicSize: '900px 700px' as any }}
            >
              {!gmailConnected ? (
                <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4">
                  <span className="material-symbols-outlined text-4xl" aria-hidden="true">{serverError ? 'cloud_off' : 'mail'}</span>
                  {serverError ? (
                    <>
                      <p className="text-sm">Server unreachable. Make sure the app is running.</p>
                      <button
                        onClick={refreshEmails}
                        className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors border border-white/10"
                      >
                        Retry
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">Connect Gmail to see your inbox.</p>
                      <button
                        onClick={() => setCurrentView('Integrations')}
                        className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors border border-white/10"
                      >
                        Go to Integrations
                      </button>
                    </>
                  )}
                </div>
              ) : visibleEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-text-muted gap-4">
                  <span className="material-symbols-outlined text-4xl" aria-hidden="true">inbox</span>
                  <p>{searchQuery ? 'No emails match your search.' : 'Inbox zero!'}</p>
                </div>
              ) : (
                visibleEmails.map((email, index) => (
                  <div key={email.id}>
                    {index > 0 && visibleEmails[index - 1].unread && !email.unread && (
                      <div className="w-full h-px bg-white/5 my-2"></div>
                    )}
                    <button
                      type="button"
                      aria-label={`${email.unread ? 'Unread: ' : ''}${email.sender} — ${email.subject}`}
                      className={`email-row group relative flex items-start gap-4 p-4 rounded-lg cursor-pointer mb-1 border w-full text-left transition-[background-color,border-color,opacity]
                        ${detail?.id === email.id ? 'border-primary/40 bg-primary/8' : index === selectedIndex ? 'border-primary/20 bg-primary/5' : 'border-transparent'}
                        ${email.urgent ? 'hover:border-white/10 bg-rose-500/10' : 'hover:border-white/5'}
                        ${!email.unread ? 'opacity-70 hover:opacity-100' : ''}
                        focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
                      onClick={() => { setSelectedIndex(index); openDetail(email); }}
                    >
                      <div aria-hidden="true" className={`w-2 h-2 rounded-full mt-3 shrink-0 ${email.urgent ? 'bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.45)]' : email.unread ? 'bg-primary neon-pulse-unread' : 'bg-transparent'}`}></div>
                      <div className={`w-8 h-8 rounded-full glass-avatar flex items-center justify-center text-sm font-semibold shrink-0 mt-0.5 hover:scale-110 transition-transform ${email.urgent ? 'border-rose-400/35 text-rose-300' : email.unread ? 'text-foreground' : 'text-text-muted'}`}>
                        {email.initials}
                      </div>
                      <div className={`flex-1 min-w-0 ${detail ? '' : 'pr-32'}`}>
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
                        {!detail && <p className={`text-[13px] truncate leading-relaxed ${email.unread ? 'text-text-muted' : 'text-text-muted/70'}`}>{email.preview}</p>}
                      </div>

                      {/* Hover Action Bar — hidden in split view to save space */}
                      {!detail && (
                        <div className="action-bar absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-surface/92 backdrop-blur-md p-1.5 rounded-lg border border-white/10 shadow-2xl z-20">
                          <button onClick={(e) => handleReply(email, e)} aria-label="Reply" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">reply</span>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); archiveEmail(email.id, e); showToast('Email archived', 'info'); }} aria-label="Archive" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">archive</span>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); toggleRead(email.id, e); }} aria-label={email.unread ? 'Mark as read' : 'Mark as unread'} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{email.unread ? 'mark_email_read' : 'mark_as_unread'}</span>
                          </button>
                          <div className="w-px h-4 bg-white/10 mx-1" aria-hidden="true"></div>
                          <button onClick={(e) => { e.stopPropagation(); deleteEmail(email.id, e); }} aria-label="Move to trash" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-rose-500/20 text-text-muted hover:text-rose-300 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">delete</span>
                          </button>
                        </div>
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Compose FAB */}
            <button
              onClick={() => openCompose()}
              aria-label="Compose new email"
              className="fab-compose absolute bottom-8 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-primary text-background-dark flex items-center justify-center shadow-lg hover:scale-110 hover:shadow-[0_0_22px_rgba(56,189,248,0.45)] active:scale-95 transition-transform z-30 group focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
            >
              <span className="material-symbols-outlined text-[28px] font-bold" aria-hidden="true">edit</span>
            </button>
          </div>

          {/* Right: Email Detail */}
          {detail && (
            <div className="flex-1 flex flex-col overflow-hidden bg-background-elevated/35">
              {/* Detail Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-heading font-semibold text-lg text-white truncate">{detail.subject}</h3>
                    {(detail.messageCount ?? 1) > 1 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] font-bold text-primary shrink-0">
                        <span className="material-symbols-outlined !text-[12px]" aria-hidden="true">forum</span>
                        {detail.messageCount}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-text-muted mt-0.5 truncate">{detail.sender} &lt;{detail.senderEmail}&gt;</p>
                </div>
                <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                  <button
                    onClick={() => openCompose({ to: detail.senderEmail, subject: `Re: ${detail.subject}` })}
                    aria-label="Reply to this email"
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">reply</span>
                  </button>
                  <button
                    onClick={() => setDetail(null)}
                    aria-label="Close email"
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-text-muted hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
                  </button>
                </div>
              </div>
              {/* Detail Body — single message or thread accordion */}
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {(detail.messageCount ?? 1) <= 1 ? (
                  /* Single message view */
                  <div className="p-6">
                    {detail.loading ? (
                      <div className="flex items-center justify-center h-32">
                        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                      </div>
                    ) : (
                      <pre className="text-sm text-foreground/85 whitespace-pre-wrap break-words font-sans leading-relaxed">{detail.body || '(empty)'}</pre>
                    )}
                  </div>
                ) : detail.threadLoading || !detail.threadMessages ? (
                  /* Thread loading */
                  <div className="flex items-center justify-center h-32">
                    <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  </div>
                ) : (
                  /* Thread accordion */
                  <div className="flex flex-col divide-y divide-white/5">
                    {detail.threadMessages.map((msg, idx) => {
                      const isExpanded = expandedMsgIds.has(msg.id);
                      const isLast = idx === detail.threadMessages!.length - 1;
                      return (
                        <div key={msg.id} className={`${isLast ? 'flex-1' : ''}`}>
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => setExpandedMsgIds(prev => {
                              const next = new Set(prev);
                              if (next.has(msg.id)) next.delete(msg.id);
                              else next.add(msg.id);
                              return next;
                            })}
                            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            <div className={`w-7 h-7 rounded-full glass-avatar flex items-center justify-center text-xs font-semibold shrink-0 ${msg.unread ? 'text-foreground' : 'text-text-muted'}`}>
                              {msg.initials}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={`text-[13px] font-semibold truncate block ${msg.unread ? 'text-foreground' : 'text-text-muted'}`}>{msg.sender}</span>
                            </div>
                            <span className="text-[12px] text-text-muted shrink-0 ml-2">{msg.time}</span>
                            <span className="material-symbols-outlined text-[18px] text-text-muted shrink-0 transition-transform" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none' }} aria-hidden="true">expand_more</span>
                          </button>
                          {isExpanded && (
                            <div className="px-5 pb-5 pt-2">
                              <pre className="text-sm text-foreground/85 whitespace-pre-wrap break-words font-sans leading-relaxed">{msg.body || '(empty)'}</pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 shrink-0 bg-background-elevated/70 backdrop-blur-md flex items-center justify-center gap-6 font-mono text-[11px] text-text-muted">
          {KEYBOARD_SHORTCUTS.map(([key, label]) => (
            <div key={key} className="flex items-center gap-2 group cursor-default">
              <span className="px-1.5 py-0.5 rounded border border-white/20 bg-white/5 text-white group-hover:border-primary group-hover:text-primary transition-colors">{key}</span>
              <span className="group-hover:text-foreground transition-colors">{label}</span>
            </div>
          ))}
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
              <button onClick={() => setCompose(null)} className="text-sm text-text-muted hover:text-white transition-colors">
                Discard
              </button>
              <button
                onClick={handleSend}
                disabled={compose.sending || !isValidEmail(compose.to) || !compose.subject.trim() || !compose.body.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-background-dark text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_14px_rgba(56,189,248,0.28)]"
              >
                {compose.sending ? (
                  <span className="w-4 h-4 rounded-full border-2 border-background-dark border-t-transparent animate-spin"></span>
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
