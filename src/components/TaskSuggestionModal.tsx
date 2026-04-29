import { useState } from 'react';
import { TaskSuggestion } from '../types/taskSuggestion';

interface Props {
  suggestions: TaskSuggestion[];
  context: string; // email subject or "N unread emails"
  onAdd: (accepted: TaskSuggestion[]) => void;
  onClose: () => void;
}

const PRIORITY_CYCLE: TaskSuggestion['priority'][] = ['Normal', 'Priority', 'Critical'];

const priorityStyle = (p: TaskSuggestion['priority']) => {
  if (p === 'Critical') return 'text-rose-400 border-rose-400/40 bg-rose-400/10';
  if (p === 'Priority') return 'text-primary border-primary/40 bg-primary/10';
  return 'text-text-muted border-white/10 bg-white/5';
};

export default function TaskSuggestionModal({ suggestions: initial, context, onAdd, onClose }: Props) {
  const [items, setItems] = useState<TaskSuggestion[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const acceptedCount = items.filter(i => i.accepted).length;

  const toggle = (id: string) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, accepted: !i.accepted } : i));

  const cyclePriority = (id: string) =>
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i;
      const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(i.priority) + 1) % PRIORITY_CYCLE.length];
      return { ...i, priority: next };
    }));

  const toggleGroup = (id: string) =>
    setItems(prev => prev.map(i => i.id === id ? { ...i, group: i.group === 'now' ? 'next' : 'now' } : i));

  const commitEdit = (id: string) => {
    if (editDraft.trim()) {
      setItems(prev => prev.map(i => i.id === id ? { ...i, title: editDraft.trim() } : i));
    }
    setEditingId(null);
  };

  const handleAdd = () => onAdd(items.filter(i => i.accepted));

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center p-4"
      style={{ background: 'rgba(5,8,18,0.85)', backdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="AI task suggestions"
    >
      <div className="glass-panel w-full max-w-[560px] flex flex-col rounded-xl overflow-hidden shadow-2xl max-h-[85vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-primary text-[22px] mt-0.5" aria-hidden="true">auto_awesome</span>
            <div>
              <h2 className="font-heading text-[17px] font-semibold text-white">AI Task Suggestions</h2>
              <p className="text-xs text-text-muted mt-0.5 truncate max-w-[360px]">From: {context}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-white hover:bg-white/5 transition-colors flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Suggestions list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3 flex flex-col gap-2">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <span className="material-symbols-outlined text-3xl text-text-muted" aria-hidden="true">task_alt</span>
              <p className="text-sm text-text-muted">No actionable tasks found.</p>
            </div>
          ) : items.map(item => (
            <div
              key={item.id}
              className={`rounded-xl border p-3 transition-[background-color,border-color,opacity] ${item.accepted ? 'border-white/10 bg-white/[0.03]' : 'border-white/5 opacity-40'}`}
            >
              <div className="flex items-start gap-3">
                {/* Accept toggle */}
                <button
                  onClick={() => toggle(item.id)}
                  role="checkbox"
                  aria-checked={item.accepted}
                  aria-label={item.accepted ? 'Deselect task' : 'Select task'}
                  className={`mt-0.5 w-5 h-5 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                    item.accepted ? 'bg-primary/20 border-primary/60' : 'border-white/20'
                  }`}
                >
                  {item.accepted && (
                    <span className="material-symbols-outlined !text-[13px] text-primary" aria-hidden="true">check</span>
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  {/* Title */}
                  {editingId === item.id ? (
                    <input
                      className="w-full bg-white/5 border border-primary/40 rounded px-2 py-0.5 text-sm text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 mb-1"
                      value={editDraft}
                      onChange={e => setEditDraft(e.target.value)}
                      onBlur={() => commitEdit(item.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitEdit(item.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="text-left w-full text-sm font-medium text-white cursor-text hover:text-primary transition-colors mb-1 leading-snug rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      onClick={() => { setEditingId(item.id); setEditDraft(item.title); }}
                      aria-label="Edit task title"
                      title="Click to edit"
                    >
                      {item.title}
                    </button>
                  )}

                  {/* Reason */}
                  {item.reason && (
                    <p className="text-[11px] text-text-muted leading-snug mb-2">{item.reason}</p>
                  )}

                  {/* Badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => cyclePriority(item.id)}
                      aria-label={`Priority: ${item.priority} — click to change`}
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${priorityStyle(item.priority)}`}
                    >
                      {item.priority}
                    </button>
                    <button
                      onClick={() => toggleGroup(item.id)}
                      aria-label={`Timing: ${item.group === 'now' ? 'Now' : 'Next'} — click to toggle`}
                      className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-text-muted hover:text-white hover:border-white/20 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      {item.group === 'now' ? '⚡ Now' : '→ Next'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <button
            onClick={handleAdd}
            disabled={acceptedCount === 0}
            className="flex-1 py-2.5 rounded-xl bg-primary/20 border border-primary/40 text-sm font-semibold text-primary hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined !text-sm" aria-hidden="true">add_task</span>
            Add {acceptedCount} task{acceptedCount !== 1 ? 's' : ''}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-white/10 text-sm font-medium text-text-muted hover:text-white hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
