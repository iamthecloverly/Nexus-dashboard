import type { Dispatch, SetStateAction } from 'react';

/** View ids used by App state (`currentView`). */
export const VIEW_IDS = ['MainHub', 'FocusMode', 'Communications', 'Integrations', 'Settings'] as const;
export type ViewId = (typeof VIEW_IDS)[number];

/** Matches `useState<ViewId>[1]` — avoids ad-hoc wrappers when passing navigation through props. */
export type SetViewFn = Dispatch<SetStateAction<ViewId>>;

export interface NavItem {
  id: ViewId;
  label: string;
  /** Material SymbolsOutlined ligature name */
  icon: string;
}

/** All workspace views shown on the desktop rail (top section). */
export const WORKSPACE_NAV: NavItem[] = [
  { id: 'MainHub', label: 'Main Hub', icon: 'dashboard' },
  { id: 'FocusMode', label: 'Focus Mode', icon: 'target' },
  { id: 'Communications', label: 'Communications', icon: 'chat_bubble' },
  { id: 'Integrations', label: 'Integrations', icon: 'extension' },
];

/** Mobile bottom bar: first three routes + “More” — these items appear inside the overflow sheet. */
export const MOBILE_MORE_VIEWS: NavItem[] = [
  { id: 'Integrations', label: 'Integrations', icon: 'extension' },
  { id: 'Settings', label: 'Settings', icon: 'settings' },
];

/** First row of the mobile tab bar (ids must be valid ViewIds). */
export const MOBILE_TAB_BAR: NavItem[] = [
  { id: 'MainHub', label: 'Hub', icon: 'dashboard' },
  { id: 'FocusMode', label: 'Focus', icon: 'target' },
  { id: 'Communications', label: 'Mail', icon: 'chat_bubble' },
];

/** Pixel width of the icon rail (keep in sync with `NavigationRail` width class). */
export const RAIL_WIDTH_PX = 80;

/**
 * Space reserved below main content on small screens: floating bottom bar + margin + typical safe-area.
 * Keep in sync with `MobileBottomNav` vertical footprint.
 */
export const MOBILE_BOTTOM_NAV_HEIGHT_PX = 96;
