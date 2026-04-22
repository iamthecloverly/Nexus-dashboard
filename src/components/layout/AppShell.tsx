import { type CSSProperties, type ReactNode } from 'react';
import { NavigationRail } from './NavigationRail';
import { MobileBottomNav } from './MobileBottomNav';
import { MOBILE_BOTTOM_NAV_HEIGHT_PX, RAIL_WIDTH_PX, type SetViewFn, type ViewId } from '../../config/navigation';

/** `desktopNav`: matches Tailwind `lg` — rail visible vs bottom nav padding. */
export function AppShell({
  desktopNav,
  currentView,
  setCurrentView,
  onOpenMusic,
  onPreloadMusic,
  musicActive,
  children,
}: {
  desktopNav: boolean;
  currentView: ViewId;
  setCurrentView: SetViewFn;
  onOpenMusic: () => void;
  onPreloadMusic?: () => void;
  musicActive: boolean;
  children: ReactNode;
}) {
  const shellStyle = {
    '--app-nav-width': desktopNav ? `${RAIL_WIDTH_PX}px` : '0px',
    '--app-bottom-nav-height': desktopNav ? '0px' : `${MOBILE_BOTTOM_NAV_HEIGHT_PX}px`,
  } as CSSProperties;

  return (
    <div className="flex flex-row flex-1 min-h-0 min-w-0 w-full h-full" style={shellStyle}>
      <NavigationRail
        currentView={currentView}
        setCurrentView={setCurrentView}
        onOpenMusic={onOpenMusic}
        onPreloadMusic={onPreloadMusic}
        musicActive={musicActive}
      />
      <div
        className="flex-1 flex flex-col min-w-0 min-h-0 relative z-10 overflow-hidden
          pb-[length(var(--app-bottom-nav-height))] lg:pb-0"
      >
        {children}
      </div>
      <MobileBottomNav
        currentView={currentView}
        setCurrentView={setCurrentView}
        onOpenMusic={onOpenMusic}
      />
    </div>
  );
}
