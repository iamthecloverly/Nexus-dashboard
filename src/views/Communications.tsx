import React, { useState, useEffect, useRef, useMemo } from 'react';

import { Email } from '../App';
import { useEmailContext } from '../contexts/EmailContext';
import { useToast } from '../components/Toast';

interface ComposeState {
  to: string;
  subject: string;
  body: string;
  sending: boolean;
  error: string | null;
}

const EMPTY_COMPOSE: ComposeState = { to: '', subject: '', body: '', sending: false, error: null };
const KEYBOARD_SHORTCUTS = [['C', 'Compose'], ['E', 'Archive'], ['Esc', 'Close'], ['↑↓', 'Navigate']] as const;

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
  const { state: { emails, gmailConnected, emailsLoading }, actions: { toggleRead, archiveEmail, deleteEmail, refreshEmails } } = useEmailContext();
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const stateRef = React.useRef({ visibleEmails: [] as Email[], selectedIndex: 0, compose: null as ComposeState | null });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const lowerQuery = searchQuery.toLowerCase();
  const visibleEmails = useMemo(() => emails.filter(email =>
    !email.archived &&
    !email.deleted &&
    ((email.subject ?? '').toLowerCase().includes(lowerQuery) ||
     (email.sender ?? '').toLowerCase().includes(lowerQuery) ||
     (email.preview ?? '').toLowerCase().includes(lowerQuery))
  ), [emails, lowerQuery]);

  const unreadCount = useMemo(() => emails.filter(e => e.unread && !e.archived && !e.deleted).length, [emails]);

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
      const fakeEvent = { stopPropagation: () => {} } as React.MouseEvent;
      toggleRead(email.id, fakeEvent);
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
    setCompose(c => c ? { ...c, sending: true, error: null } : null);
    try {
      const res = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          const fakeEvent = { stopPropagation: () => {} } as React.MouseEvent;
          archiveEmail(email.id, fakeEvent);
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
                onClick={refreshEmails}
                disabled={emailsLoading}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-all text-[#A1A1AA] hover:text-[#F4F4F5] disabled:opacity-40"
                title="Refresh"
              >
                <span className={`material-symbols-outlined text-[20px] ${emailsLoading ? 'animate-spin' : ''}`}>refresh</span>
              </button>
              <button
                onClick={() => setCurrentView('MainHub')}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-all hover:rotate-90 text-[#A1A1AA] hover:text-[#F4F4F5]"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="px-6 pb-5">
            <div className="glass-search flex items-center gap-3 px-4 py-2.5 rounded-xl">
              <span className="material-symbols-outlined text-[#A1A1AA] text-[20px]">search</span>
              <input
                ref={searchRef}
                className="bg-transparent border-none focus:ring-0 text-[14px] text-[#F4F4F5] placeholder-[#A1A1AA] w-full p-0"
                placeholder="Search emails, people, or keywords..."
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[#A1A1AA] text-[10px] font-mono">⌘</span>
                <span className="px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[#A1A1AA] text-[10px] font-mono">K</span>
              </div>
            </div>
          </div>
        </div>

        {/* Email List + Detail Split */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Left: Email List */}
          <div className={`flex flex-col overflow-hidden transition-all duration-300 ${detail ? 'w-80 flex-none border-r border-white/10' : 'flex-1'}`}>
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 relative">
              {!gmailConnected ? (
                <div className="flex flex-col items-center justify-center h-full text-[#A1A1AA] gap-4">
                  <span className="material-symbols-outlined text-4xl">mail</span>
                  <p className="text-sm">Connect Gmail to see your inbox.</p>
                  <button
                    onClick={() => setCurrentView('Integrations')}
                    className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-all border border-white/10"
                  >
                    Go to Integrations
                  </button>
                </div>
              ) : visibleEmails.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-[#A1A1AA] gap-4">
                  <span className="material-symbols-outlined text-4xl">inbox</span>
                  <p>{searchQuery ? 'No emails match your search.' : 'Inbox zero!'}</p>
                </div>
              ) : (
                visibleEmails.map((email, index) => (
                  <div key={email.id}>
                    {index > 0 && visibleEmails[index - 1].unread && !email.unread && (
                      <div className="w-full h-px bg-white/5 my-2"></div>
                    )}
                    <div
                      className={`email-row group relative flex items-start gap-4 p-4 rounded-lg cursor-pointer mb-1 border transition-all
                        ${detail?.id === email.id ? 'border-primary/40 bg-primary/8' : index === selectedIndex ? 'border-primary/20 bg-primary/5' : 'border-transparent'}
                        ${email.urgent ? 'hover:border-white/10 bg-[#FF0055]/5' : 'hover:border-white/5'}
                        ${!email.unread ? 'opacity-70 hover:opacity-100' : ''}`}
                      onClick={() => { setSelectedIndex(index); openDetail(email); }}
                    >
                      <div className={`w-2 h-2 rounded-full mt-3 shrink-0 ${email.urgent ? 'bg-[#FF0055] shadow-[0_0_12px_rgba(255,0,85,0.6)]' : email.unread ? 'bg-primary neon-pulse-unread' : 'bg-transparent'}`}></div>
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
                          <button onClick={(e) => handleReply(email, e)} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-all hover:scale-110" title="Reply">
                            <span className="material-symbols-outlined text-[18px]">reply</span>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); archiveEmail(email.id, e); showToast('Email archived', 'info'); }} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-all hover:scale-110" title="Archive (E)">
                            <span className="material-symbols-outlined text-[18px]">archive</span>
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); toggleRead(email.id, e); }} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-all hover:scale-110" title={email.unread ? 'Mark Read' : 'Mark Unread'}>
                            <span className="material-symbols-outlined text-[18px]">{email.unread ? 'mark_email_read' : 'mark_as_unread'}</span>
                          </button>
                          <div className="w-px h-4 bg-white/10 mx-1"></div>
                          <button onClick={(e) => { e.stopPropagation(); deleteEmail(email.id, e); }} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[#FF0055]/20 text-[#A1A1AA] hover:text-[#FF0055] transition-all hover:scale-110" title="Trash">
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Compose FAB */}
            <button
              onClick={() => openCompose()}
              className="fab-compose absolute bottom-8 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-primary text-[#0B0C10] flex items-center justify-center shadow-lg hover:scale-110 hover:shadow-[0_0_20px_rgba(6,232,249,0.5)] active:scale-95 transition-all z-30 group"
            >
              <span className="material-symbols-outlined text-[28px] font-bold">edit</span>
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
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-all"
                    title="Reply"
                  >
                    <span className="material-symbols-outlined text-[18px]">reply</span>
                  </button>
                  <button
                    onClick={() => setDetail(null)}
                    className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-all"
                    title="Close"
                  >
                    <span className="material-symbols-outlined text-[18px]">close</span>
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
                  <pre className="text-sm text-[#D4D4D8] whitespace-pre-wrap font-sans leading-relaxed">{detail.body || '(empty)'}</pre>
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
              <h2 className="font-heading font-semibold text-lg text-white">New Message</h2>
              <button onClick={() => setCompose(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 text-[#A1A1AA] hover:text-white transition-all hover:rotate-90">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <div className="flex items-center gap-3 border-b border-white/10 pb-3">
                <span className="text-xs text-[#A1A1AA] w-12 shrink-0">To</span>
                <input
                  autoFocus
                  className="flex-1 bg-transparent text-sm text-white placeholder-[#A1A1AA] focus:outline-none"
                  placeholder="recipient@example.com"
                  value={compose.to}
                  onChange={e => setCompose(c => c ? { ...c, to: e.target.value } : null)}
                />
              </div>
              <div className="flex items-center gap-3 border-b border-white/10 pb-3">
                <span className="text-xs text-[#A1A1AA] w-12 shrink-0">Subject</span>
                <input
                  className="flex-1 bg-transparent text-sm text-white placeholder-[#A1A1AA] focus:outline-none"
                  placeholder="Subject"
                  value={compose.subject}
                  onChange={e => setCompose(c => c ? { ...c, subject: e.target.value } : null)}
                />
              </div>
              <textarea
                className="w-full bg-transparent text-sm text-white placeholder-[#A1A1AA] focus:outline-none resize-none h-40 custom-scrollbar"
                placeholder="Write your message..."
                value={compose.body}
                onChange={e => setCompose(c => c ? { ...c, body: e.target.value } : null)}
              />
              {compose.error && (
                <p className="text-xs text-red-400">{compose.error}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-white/10 bg-[#0B0C10]/40 flex items-center justify-between">
              <button onClick={() => setCompose(null)} className="text-sm text-[#A1A1AA] hover:text-white transition-colors">
                Discard
              </button>
              <button
                onClick={handleSend}
                disabled={compose.sending || !compose.to.trim() || !compose.subject.trim() || !compose.body.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-primary text-[#0B0C10] text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_10px_rgba(6,232,249,0.3)]"
              >
                {compose.sending ? (
                  <span className="w-4 h-4 rounded-full border-2 border-[#0B0C10] border-t-transparent animate-spin"></span>
                ) : (
                  <span className="material-symbols-outlined text-[18px]">send</span>
                )}
                {compose.sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
