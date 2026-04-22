import { useRef, useState, useCallback } from 'react';
import { MOBILE_TAB_BAR, MOBILE_MORE_VIEWS, type SetViewFn, type ViewId } from '../../config/navigation';
import { useDismissibleLayer } from '../../hooks/useDismissibleLayer';

export function MobileBottomNav({
  currentView,
  setCurrentView,
  onOpenMusic,
}: {
  currentView: ViewId;
  setCurrentView: SetViewFn;
  onOpenMusic: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const moreSheetRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (id: ViewId) => {
      setCurrentView(id);
      setMoreOpen(false);
    },
    [setCurrentView]
  );

  useDismissibleLayer({
    open: moreOpen,
    onDismiss: () => setMoreOpen(false),
    refs: [moreBtnRef, moreSheetRef],
  });

  const active = (id: string) => currentView === id;
  const moreHasActive = MOBILE_MORE_VIEWS.some(i => active(i.id));

  return (
    <div className="lg:hidden fixed inset-x-0 bottom-0 z-[60] pointer-events-none flex justify-center px-3 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2">
      <nav
        className="pointer-events-auto w-full max-w-md rounded-[1.75rem] border border-white/[0.09] bg-background-elevated/[0.72] backdrop-blur-2xl backdrop-saturate-150 shadow-[0_12px_48px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.07)] ring-1 ring-white/[0.04]"
        aria-label="Mobile navigation"
      >
        {/* Top highlight */}
        <div
          className="h-px mx-6 mt-2 rounded-full bg-gradient-to-r from-transparent via-white/25 to-transparent opacity-80"
          aria-hidden="true"
        />

        <div className="flex items-stretch justify-between gap-0.5 px-1.5 py-2">
          {MOBILE_TAB_BAR.map(item => {
            const isActive = active(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => go(item.id)}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-2xl min-w-0 min-h-[52px]',
                  'transition-all duration-200 ease-out active:scale-[0.96]',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
                  isActive
                    ? 'bg-gradient-to-b from-primary/20 to-primary/[0.06] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] ring-1 ring-primary/25'
                    : 'text-text-muted hover:text-foreground',
                ].join(' ')}
              >
                <span
                  className={`material-symbols-outlined text-[26px] leading-none nav-ms ${isActive ? 'nav-ms--active' : ''}`}
                  aria-hidden="true"
                >
                  {item.icon}
                </span>
                <span className="text-[10px] font-semibold tracking-wide truncate max-w-full">{item.label}</span>
              </button>
            );
          })}

          <div className="relative flex flex-1 flex-col items-stretch min-w-0">
            <button
              ref={moreBtnRef}
              type="button"
              aria-label="More destinations"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(o => !o)}
              className={[
                'flex flex-col items-center justify-center gap-0.5 py-2 px-1 rounded-2xl w-full min-h-[52px]',
                'transition-all duration-200 ease-out active:scale-[0.96]',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
                moreOpen || moreHasActive
                  ? 'bg-gradient-to-b from-primary/20 to-primary/[0.06] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.15)] ring-1 ring-primary/25'
                  : 'text-text-muted hover:text-foreground',
              ].join(' ')}
            >
              <span
                className={`material-symbols-outlined text-[26px] leading-none nav-ms ${moreOpen || moreHasActive ? 'nav-ms--active' : ''}`}
                aria-hidden="true"
              >
                more_horiz
              </span>
              <span className="text-[10px] font-semibold tracking-wide">More</span>
            </button>

            {moreOpen && (
              <div
                ref={moreSheetRef}
                role="menu"
                aria-label="More"
                className="nav-sheet-pop absolute bottom-[calc(100%+10px)] left-1/2 z-[70] min-w-[220px] max-w-[min(92vw,280px)] -translate-x-1/2 rounded-2xl border border-white/[0.12] bg-background-elevated/[0.96] backdrop-blur-xl py-2 shadow-[0_20px_56px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.06]"
              >
                {MOBILE_MORE_VIEWS.map(item => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    onClick={() => go(item.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left text-foreground hover:bg-white/[0.06] transition-colors rounded-lg mx-1.5"
                  >
                    <span className="material-symbols-outlined text-[22px] text-text-muted nav-ms" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="font-medium">{item.label}</span>
                  </button>
                ))}
                <div className="mx-3 my-1 h-px bg-white/[0.06]" aria-hidden="true" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenMusic();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left text-foreground hover:bg-white/[0.06] transition-colors rounded-lg mx-1.5"
                >
                  <span className="material-symbols-outlined text-[22px] text-text-muted nav-ms" aria-hidden="true">
                    music_note
                  </span>
                  <span className="font-medium">Music</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>
    </div>
  );
}
