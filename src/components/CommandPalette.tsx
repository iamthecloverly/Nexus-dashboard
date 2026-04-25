import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ViewId, SetViewFn } from '../config/navigation';

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  setCurrentView: SetViewFn;
  /** Same behavior as rail music control (toggle player or open load panel). */
  onToggleMusic: () => void;
  /** Navigate to MainHub and open the quick-add FAB. */
  onOpenQuickAdd: () => void;
  /** Navigate to Communications and open the compose panel. */
  onComposeEmail: () => void;
  /** Mark all unread emails as read. */
  onMarkAllRead: () => void;
  /** Trigger a calendar refresh and navigate to MainHub. */
  onRefreshCalendar: () => void;
};

type Cmd =
  | { kind: 'view'; id: ViewId; label: string; icon: string }
  | { kind: 'music'; label: string; icon: string }
  | { kind: 'action'; id: string; label: string; icon: string };

const COMMANDS: Cmd[] = [
  { kind: 'view', id: 'MainHub', label: 'Main Hub', icon: 'dashboard' },
  { kind: 'view', id: 'FocusMode', label: 'Focus Mode', icon: 'target' },
  { kind: 'view', id: 'Communications', label: 'Communications', icon: 'chat_bubble' },
  { kind: 'view', id: 'Integrations', label: 'Integrations', icon: 'extension' },
  { kind: 'view', id: 'Settings', label: 'Settings', icon: 'settings' },
  { kind: 'music', label: 'Music — toggle player or open library', icon: 'library_music' },
  { kind: 'action', id: 'add-task', label: 'Add task', icon: 'add_task' },
  { kind: 'action', id: 'compose-email', label: 'Compose email', icon: 'edit_square' },
  { kind: 'action', id: 'mark-all-read', label: 'Mark all emails as read', icon: 'drafts' },
  { kind: 'action', id: 'refresh-calendar', label: 'Refresh calendar', icon: 'event_available' },
];

function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return (el as HTMLElement).isContentEditable === true;
}

function cmdKey(c: Cmd): string {
  if (c.kind === 'view') return `view-${c.id}`;
  if (c.kind === 'action') return `action-${c.id}`;
  return 'music';
}

export function CommandPalette({
  open,
  onClose,
  setCurrentView,
  onToggleMusic,
  onOpenQuickAdd,
  onComposeEmail,
  onMarkAllRead,
  onRefreshCalendar,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(c => c.label.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1));
  }, [filtered.length, highlight]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHighlight(0);
      return;
    }
    const id = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(id);
  }, [open]);

  const run = useCallback(
    (c: Cmd) => {
      if (c.kind === 'view') {
        setCurrentView(c.id);
      } else if (c.kind === 'music') {
        onToggleMusic();
      } else {
        switch (c.id) {
          case 'add-task':
            onOpenQuickAdd();
            break;
          case 'compose-email':
            onComposeEmail();
            break;
          case 'mark-all-read':
            onMarkAllRead();
            break;
          case 'refresh-calendar':
            onRefreshCalendar();
            break;
        }
      }
      onClose();
    },
    [setCurrentView, onToggleMusic, onOpenQuickAdd, onComposeEmail, onMarkAllRead, onRefreshCalendar, onClose],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight(h => Math.min(h + 1, Math.max(0, filtered.length - 1)));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight(h => Math.max(h - 1, 0));
      }
      if (e.key === 'Enter' && filtered[highlight]) {
        e.preventDefault();
        run(filtered[highlight]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, highlight, run, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[600] flex items-start justify-center pt-[15vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        type="button"
        className="absolute inset-0 bg-background-dark/75 backdrop-blur-sm"
        aria-label="Close command palette"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg glass-panel rounded-2xl border border-white/15 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <span className="material-symbols-outlined text-text-muted text-[20px]" aria-hidden="true">
            search
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Type a command or jump to a view…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-text-muted/60 focus:outline-none py-2"
            aria-label="Filter commands"
          />
          <kbd className="hidden sm:inline text-[10px] text-text-muted border border-white/15 rounded px-1.5 py-0.5 font-mono">Esc</kbd>
        </div>
        <ul className="max-h-[min(50vh,320px)] overflow-y-auto custom-scrollbar py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-sm text-text-muted text-center">No matches</li>
          ) : (
            filtered.map((c, i) => (
              <li key={cmdKey(c)}>
                <button
                  type="button"
                  onClick={() => run(c)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                    i === highlight ? 'bg-white/10 text-foreground' : 'text-foreground/90 hover:bg-white/5'
                  }`}
                >
                  <span className="material-symbols-outlined text-text-muted text-[20px]" aria-hidden="true">
                    {c.icon}
                  </span>
                  <span className="flex-1">{c.label}</span>
                  {c.kind === 'action' && (
                    <span className="text-[10px] text-text-muted/60 border border-white/10 rounded px-1.5 py-0.5 font-mono shrink-0">action</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="text-[10px] text-text-muted px-4 py-2 border-t border-white/10">
          <kbd className="font-mono">⌘K</kbd> / <kbd className="font-mono">Ctrl+K</kbd> / <kbd className="font-mono">/</kbd> to open
        </p>
      </div>
    </div>
  );
}

/** Global shortcut listener: opens palette when closed. Call from `AppContent`. */
export function useCommandPaletteShortcut(onOpen: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpen();
        return;
      }
      if (e.key === '/' && !mod && !e.altKey) {
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen, enabled]);
}
