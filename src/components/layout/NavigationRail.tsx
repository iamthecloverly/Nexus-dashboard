import { Fragment, useCallback } from 'react';
import { WORKSPACE_NAV, RAIL_WIDTH_PX, type SetViewFn, type ViewId } from '../../config/navigation';

function RailIconButton({
  label,
  icon,
  active,
  onClick,
  className = '',
  onHoverIntent,
}: {
  label: string;
  icon: string;
  active?: boolean;
  onClick: () => void;
  className?: string;
  /** e.g. preload YouTube iframe when user aims at Music */
  onHoverIntent?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onMouseEnter={onHoverIntent}
      onFocus={onHoverIntent}
      className={[
        'nav-link group relative flex h-12 w-full shrink-0 items-center justify-center rounded-[0.65rem]',
        'transition-all duration-200 ease-out',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2',
        active
          ? 'active bg-gradient-to-br from-primary/[0.22] via-primary/[0.09] to-transparent text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
          : 'text-text-muted hover:bg-white/[0.07] hover:text-foreground active:scale-[0.96]',
        className,
      ].join(' ')}
    >
      <span
        className={`material-symbols-outlined nav-ms text-[24px] leading-none ${active ? 'nav-ms--active' : ''}`}
        aria-hidden="true"
      >
        {icon}
      </span>
    </button>
  );
}

export function NavigationRail({
  currentView,
  setCurrentView,
  onOpenMusic,
  onPreloadMusic,
  musicActive,
}: {
  currentView: ViewId;
  setCurrentView: SetViewFn;
  onOpenMusic: () => void;
  onPreloadMusic?: () => void;
  musicActive: boolean;
}) {
  const go = useCallback(
    (id: ViewId) => {
      setCurrentView(id);
    },
    [setCurrentView]
  );

  const active = (id: string) => currentView === id;

  return (
    <aside
      className="hidden lg:flex flex-none flex-col relative z-[60]"
      style={{ width: RAIL_WIDTH_PX }}
      aria-label="Primary navigation"
    >
      <div
        className="pointer-events-none absolute inset-y-8 right-0 w-px opacity-70"
        style={{
          background:
            'linear-gradient(180deg, transparent 0%, rgba(56,189,248,0.28) 45%, rgba(167,139,250,0.2) 55%, transparent 100%)',
        }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col h-full bg-[linear-gradient(190deg,rgba(18,23,34,0.92)_0%,rgba(6,7,13,0.98)_55%,rgba(6,7,13,1)_100%)] backdrop-blur-xl border-r border-white/[0.06] shadow-[16px_0_48px_rgba(0,0,0,0.55)]">
        <div className="px-3 pt-7 pb-2 flex justify-center">
          <button
            type="button"
            onClick={() => go('MainHub')}
            aria-label="Nexus — Main hub"
            className="relative outline-none rounded-2xl focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background-dark"
          >
            <span className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-primary/35 via-accent-secondary/25 to-transparent blur-md opacity-70" aria-hidden="true" />
            <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-sky-400 to-accent-secondary text-background-dark shadow-[0_12px_28px_rgba(56,189,248,0.35)] ring-1 ring-white/15">
              <span className="material-symbols-outlined font-bold text-[26px] leading-none" aria-hidden="true">
                hub
              </span>
            </span>
            <span className="sr-only">Nexus</span>
          </button>
        </div>

        <nav className="flex-1 px-3 pt-3 flex flex-col min-h-0" aria-label="Workspace">
          <div className="nav-rail-pod p-1.5 flex flex-col gap-1">
            {WORKSPACE_NAV.map(item => (
              <Fragment key={item.id}>
                <RailIconButton
                  label={item.label}
                  icon={item.icon}
                  active={active(item.id)}
                  onClick={() => go(item.id)}
                />
              </Fragment>
            ))}
          </div>
        </nav>

        <div className="px-3 pb-7 flex shrink-0 flex-col gap-3 mt-auto min-w-0">
          <div className="nav-rail-pod flex flex-col gap-1.5 min-w-0 w-full shrink-0 p-1.5">
            <RailIconButton
              label={musicActive ? 'Now playing — YouTube Music' : 'Open YouTube Music'}
              icon="music_note"
              active={musicActive}
              onClick={onOpenMusic}
              onHoverIntent={onPreloadMusic}
            />
            <RailIconButton label="Settings" icon="settings" active={active('Settings')} onClick={() => go('Settings')} />
          </div>
        </div>
      </div>
    </aside>
  );
}
