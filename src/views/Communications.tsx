import React, { useState, useEffect, useRef, useMemo } from 'react';

import { Email } from '../types/email';
import { useEmailContext } from '../contexts/EmailContext';
import { useTaskContext } from '../contexts/TaskContext';
import { useToast } from '../components/Toast';
import TaskSuggestionModal from '../components/TaskSuggestionModal';
import { TaskSuggestion } from '../types/taskSuggestion';
import { csrfHeaders } from '../lib/csrf';

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

interface EmailDetail {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  time: string;
  body: string;
  loading: boolean;
}

export default function Communications({ setCurrentView }: { setCurrentView: (view: string) => void }) {
  const { state: { emails, gmailConnected, emailsLoading, serverError }, actions: { toggleRead, archiveEmail, deleteEmail, refreshEmails } } = useEmailContext();
  const { actions: { addTask } } = useTaskContext();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const stateRef = React.useRef({ visibleEmails: [] as Email[], selectedIndex: 0, compose: null as ComposeState | null });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
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
        if (data.code === 'NO_AI_KEY') showToast('OpenAI key not configured — add it in Settings.', 'error');
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
      addTask({ id: s.id, title: s.title, priority: s.priority === 'Normal' ? undefined : s.priority, completed: false, group: s.group });
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

  // Keep a ref in sync so the keyboard handler never needs to re-register
  stateRef.current.visibleEmails = visibleEmails;
  stateRef.current.selectedIndex = selectedIndex;
  stateRef.current.compose = compose;

  const openCompose = (prefill?: Partial<ComposeState>) => {
    setCompose({ ...EMPTY_COMPOSE, ...prefill });
  };

  const openDetail = async (email: Email) => {
    setDetail({ id: email.id, subject: email.subject, sender: email.sender, senderEmail: email.senderEmail ?? '', time: email.time, body: '', loading: true });
    if (email.unread) {
      toggleRead(email.id); // no event needed — programmatic call
    }
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
    <div className="flex-1 flex flex-col min-w-0 p-8">
      <div className="glass-panel w-full max-w-[1200px] h-full mx-auto flex flex-col rounded-xl relative overflow-hidden">
        {/* Header */}
        <div className="flex flex-col border-b border-white/10 shrink-0 bg-[#0B0C10]/40">
          <div className="flex items-center justify-between px-6 pt-5 pb-4">
            <div className="flex items-center gap-4 group">
              <h1 className="font-heading font-semibold text-2xl text-[#F4F4F5] group-hover:text-primary transition-colors cursor-default">Inbox Triage</h1>
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                style={{ color: '#00D9FF', background: 'rgba(0,217,255,0.08)', border: '1px solid rgba(0,217,255,0.2)' }}
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
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors text-[#A1A1AA] hover:text-[#F4F4F5] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className={`material-symbols-outlined text-[20px] ${emailsLoading ? 'animate-spin' : ''}`} aria-hidden="true">refresh</span>
              </button>
              <button
                onClick={() => setCurrentView('MainHub')}
                aria-label="Close communications"
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors hover:rotate-90 text-[#A1A1AA] hover:text-[#F4F4F5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="px-6 pb-5">
            <div className="glass-search flex items-center gap-3 px-4 py-2.5 rounded-xl">
              <span className="material-symbols-outlined text-[#A1A1AA] text-[20px]" aria-hidden="true">search</span>
              <input
                ref={searchRef}
                aria-label="Search emails"
                name="email-search"
                autoComplete="off"
                className="bg-transparent border-none focus:ring-0 text-[14px] text-[#F4F4F5] placeholder-[#A1A1AA] w-full p-0"
                placeholder="Search emails, people, or keywords…"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="flex items-center gap-1.5" aria-hidden="true">
                <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[#A1A1AA] text-[10px] font-mono">⌘</span>
                <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[#A1A1AA] text-[10px] font-mono">K</span>
              </div>
            </div>
          </div>
        </div>

        {/* Email List + Detail Split */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Left: Email List */}
          <div className={`flex flex-col overflow-hidden transition-[width,flex] duration-300 ${detail ? 'w-80 flex-none border-r border-white/10' : 'flex-1'}`}>
            <div
              className="flex-1 overflow-y-auto overflow-x-hidden p-2 relative"
              style={{ contentVisibility: 'auto' as any, containIntrinsicSize: '900px 700px' as any }}
            >
              {!gmailConnected ? (
                <div className="flex flex-col items-center justify-center h-full text-[#A1A1AA] gap-4">
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
                <div className="flex flex-col items-center justify-center h-full text-[#A1A1AA] gap-4">
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
                        ${email.urgent ? 'hover:border-white/10 bg-[#FF0055]/5' : 'hover:border-white/5'}
                        ${!email.unread ? 'opacity-70 hover:opacity-100' : ''}
                        focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
                      onClick={() => { setSelectedIndex(index); openDetail(email); }}
                    >
                      <div aria-hidden="true" className={`w-2 h-2 rounded-full mt-3 shrink-0 ${email.urgent ? 'bg-[#FF0055] shadow-[0_0_12px_rgba(255,0,85,0.6)]' : email.unread ? 'bg-primary neon-pulse-unread' : 'bg-transparent'}`}></div>
                      <div className={`w-8 h-8 rounded-full glass-avatar flex items-center justify-center text-sm font-semibold shrink-0 mt-0.5 hover:scale-110 transition-transform ${email.urgent ? 'border-[#FF0055]/30 text-[#FF0055]' : email.unread ? 'text-white' : 'text-[#A1A1AA]'}`}>
                        {email.initials}
                      </div>
                      <div className={`flex-1 min-w-0 ${detail ? '' : 'pr-32'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={`font-semibold text-[15px] truncate ${email.unread ? 'text-[#F4F4F5]' : 'text-[#A1A1AA] font-medium'}`}>{email.sender}</span>
                          <span className={`text-[13px] font-medium flex-shrink-0 ml-2 ${email.urgent ? 'text-[#FF0055]' : email.unread ? 'text-primary' : 'text-[#A1A1AA]'}`}>{email.time}</span>
                        </div>
                        <h3 className={`font-medium text-[14px] mb-0.5 truncate ${email.unread ? 'text-[#F4F4F5]' : 'text-[#A1A1AA]'}`}>{email.subject}</h3>
                        {!detail && <p className={`text-[13px] truncate leading-relaxed ${email.unread ? 'text-[#A1A1AA]' : 'text-[#A1A1AA]/70'}`}>{email.preview}</p>}
                      </div>

                      {/* Hover Action Bar — hidden in split view to save space */}
                      {!detail && (
                        <div className="action-bar absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 bg-[#1a1b20]/90 backdrop-blur-md p-1.5 rounded-lg border border-white/10 shadow-2xl z-20">
                          <button onClick={(e) => handleReply(email, e)} aria-label="Reply" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">reply</span>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); archiveEmail(email.id, e); showToast('Email archived', 'info'); }} aria-label="Archive" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">archive</span>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); toggleRead(email.id, e); }} aria-label={email.unread ? 'Mark as read' : 'Mark as unread'} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{email.unread ? 'mark_email_read' : 'mark_as_unread'}</span>
                          </button>
                          <div className="w-px h-4 bg-white/10 mx-1" aria-hidden="true"></div>
                          <button onClick={(e) => { e.stopPropagation(); deleteEmail(email.id, e); }} aria-label="Move to trash" className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[#FF0055]/20 text-[#A1A1AA] hover:text-[#FF0055] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
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
              className="fab-compose absolute bottom-8 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-primary text-[#0B0C10] flex items-center justify-center shadow-lg hover:scale-110 hover:shadow-[0_0_20px_rgba(6,232,249,0.5)] active:scale-95 transition-transform z-30 group focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              <span className="material-symbols-outlined text-[28px] font-bold" aria-hidden="true">edit</span>
            </button>
          </div>

          {/* Right: Email Detail */}
          {detail && (
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0B0C10]/20">
              {/* Detail Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
                <div className="flex-1 min-w-0">
                  <h3 className="font-heading font-semibold text-lg text-white truncate">{detail.subject}</h3>
                  <p className="text-sm text-[#A1A1AA] mt-0.5 truncate">{detail.sender} &lt;{detail.senderEmail}&gt;</p>
                </div>
                <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                  <button
                    onClick={() => openCompose({ to: detail.senderEmail, subject: `Re: ${detail.subject}` })}
                    aria-label="Reply to this email"
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">reply</span>
                  </button>
                  <button
                    onClick={() => setDetail(null)}
                    aria-label="Close email"
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
                  </button>
                </div>
              </div>
              {/* Detail Body */}
              <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                {detail.loading ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                  </div>
                ) : (
                  <pre className="text-sm text-[#D4D4D8] whitespace-pre-wrap break-words font-sans leading-relaxed">{detail.body || '(empty)'}</pre>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 shrink-0 bg-[#0B0C10]/60 backdrop-blur-md flex items-center justify-center gap-6 font-mono text-[11px] text-[#A1A1AA]">
          {KEYBOARD_SHORTCUTS.map(([key, label]) => (
            <div key={key} className="flex items-center gap-2 group cursor-default">
              <span className="px-1.5 py-0.5 rounded border border-white/20 bg-white/5 text-white group-hover:border-primary group-hover:text-primary transition-colors">{key}</span>
              <span className="group-hover:text-[#F4F4F5] transition-colors">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Compose Modal */}
      {compose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-[600px] rounded-xl overflow-hidden flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0B0C10]/60">
              <h2 className="font-heading font-semibold text-lg text-white" id="compose-title">New Message</h2>
              <button onClick={() => setCompose(null)} aria-label="Discard and close" className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-colors hover:rotate-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center gap-3 border-b border-white/10 pb-3">
                <label htmlFor="compose-to" className="text-xs text-[#A1A1AA] w-12 shrink-0">To</label>
                <input
                  id="compose-to"
                  type="email"
                  autoComplete="email"
                  className="flex-1 bg-transparent text-sm text-white placeholder-[#A1A1AA] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
                  placeholder="recipient@example.com"
                  value={compose.to}
                  onChange={e => setCompose(c => c ? { ...c, to: e.target.value } : null)}
                />
              </div>
              <div className="flex items-center gap-3 border-b border-white/10 pb-3">
                <label htmlFor="compose-subject" className="text-xs text-[#A1A1AA] w-12 shrink-0">Subject</label>
                <input
                  id="compose-subject"
                  name="subject"
                  autoComplete="off"
                  className="flex-1 bg-transparent text-sm text-white placeholder-[#A1A1AA] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded"
                  placeholder="Subject…"
                  value={compose.subject}
                  onChange={e => setCompose(c => c ? { ...c, subject: e.target.value } : null)}
                />
              </div>
              <textarea
                id="compose-body"
                aria-label="Message body"
                className="w-full bg-transparent text-sm text-white placeholder-[#A1A1AA] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 rounded resize-none h-40 custom-scrollbar"
                placeholder="Write your message…"
                value={compose.body}
                onChange={e => setCompose(c => c ? { ...c, body: e.target.value } : null)}
              />
              {compose.error && (
                <p className="text-xs text-red-400" aria-live="polite">{compose.error}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-white/10 bg-[#0B0C10]/40 flex items-center justify-between">
              <button onClick={() => setCompose(null)} className="text-sm text-[#A1A1AA] hover:text-white transition-colors">
                Discard
              </button>
              <button
                onClick={handleSend}
                disabled={compose.sending || !isValidEmail(compose.to) || !compose.subject.trim() || !compose.body.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-[#0B0C10] text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_10px_rgba(6,232,249,0.3)]"
              >
                {compose.sending ? (
                  <span className="w-4 h-4 rounded-full border-2 border-[#0B0C10] border-t-transparent animate-spin"></span>
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
