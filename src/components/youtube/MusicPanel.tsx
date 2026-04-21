import React, { useEffect, useMemo, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { useToast } from '../Toast';
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer';
import { extractYouTubeVideoId } from './youtube';

const MAX_RECENT = 10;

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ytRecent);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v: any) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: string[]) {
  try { localStorage.setItem(STORAGE_KEYS.ytRecent, JSON.stringify(ids.slice(0, MAX_RECENT))); } catch { /* quota */ }
}

export function MusicPanel({
  open,
  onClose,
  onLoadVideoId,
}: {
  open: boolean;
  onClose: () => void;
  onLoadVideoId: (id: string) => void;
}) {
  const { showToast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());

  useDismissibleLayer({ open, onDismiss: onClose, refs: [panelRef] });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const canSubmit = useMemo(() => !!extractYouTubeVideoId(value), [value]);

  const commit = () => {
    const id = extractYouTubeVideoId(value);
    if (!id) {
      setError('Paste a valid YouTube link or 11‑char video ID.');
      showToast('Invalid YouTube link or ID', 'error');
      return;
    }
    const nextRecent = [id, ...recent.filter(x => x !== id)];
    setRecent(nextRecent);
    saveRecent(nextRecent);
    onLoadVideoId(id);
    setValue('');
    setError(null);
    onClose();
  };

  const clearRecent = () => {
    setRecent([]);
    saveRecent([]);
    showToast('Music history cleared', 'info');
  };

  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const root = panelRef.current;
    if (!root) return;
    const focusables = (Array.from(root.querySelectorAll(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
    )) as HTMLElement[]).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
  };

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className="fixed bottom-[5.25rem] left-[17rem] z-[300] rounded-xl overflow-hidden shadow-[0_25px_80px_rgba(0,0,0,0.55)] border backdrop-blur-md max-[900px]:left-4 max-[900px]:right-4 max-[900px]:bottom-24 max-[900px]:w-auto"
      style={{ background: 'rgba(12,15,30,0.94)', borderColor: 'rgba(255,255,255,0.12)', width: 300 }}
      role="dialog"
      aria-modal="true"
      aria-label="YouTube Music"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
        trapTab(e);
      }}
    >
      <div className="px-3 py-2 border-b flex items-center gap-2 bg-white/[0.03]" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        <span className="material-symbols-outlined !text-[16px] text-primary" aria-hidden="true">music_note</span>
        <span className="text-[12px] text-white/60 font-medium">YouTube Music</span>
        <button
          ref={closeBtnRef}
          onClick={onClose}
          aria-label="Close music panel"
          className="ml-auto text-white/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
        >
          <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
        </button>
      </div>

      <div className="p-3 flex flex-col gap-2.5">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            aria-label="YouTube link or video ID"
            className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 transition-colors"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
            placeholder="Paste YouTube URL or ID…"
            value={value}
            onChange={e => { setValue(e.target.value); setError(null); }}
            onKeyDown={e => {
              if (e.key === 'Enter') commit();
            }}
          />
          <button
            aria-label="Play"
            disabled={!canSubmit}
            className="px-2.5 py-1.5 rounded-lg text-[11px] flex-shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'rgba(0,217,255,0.12)', border: '1px solid rgba(6,232,249,0.2)', color: '#00D9FF' }}
            onClick={commit}
          >
            <span className="material-symbols-outlined !text-sm" aria-hidden="true">play_arrow</span>
          </button>
        </div>

        {error && <p className="text-[11px] text-red-300/90" aria-live="polite">{error}</p>}
        {!error && (
          <p className="text-[10px] text-white/30">
            Tip: you can paste the raw 11‑char video ID too.
          </p>
        )}

        {recent.length > 0 && (
          <div className="pt-2 mt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-widest text-white/30 font-semibold">Recent</span>
              <button
                onClick={clearRecent}
                className="text-[10px] text-white/30 hover:text-white/60 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
              >
                Clear
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {recent.slice(0, MAX_RECENT).map(id => (
                <button
                  key={id}
                  onClick={() => { onLoadVideoId(id); onClose(); }}
                  className="w-full text-left px-2 py-1 rounded-md hover:bg-white/5 text-[11px] font-mono text-white/70 hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

