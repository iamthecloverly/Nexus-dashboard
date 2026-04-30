export const STORAGE_KEYS = {
  tasks: 'dashboard_tasks',
  profileName: 'dashboard_profile_name',
  onboardingDismissed: 'dashboard_onboarding_dismissed',
  ytVideoId: 'dashboard_yt_video',
  ytVolume: 'dashboard_yt_volume',
  ytRecent: 'dashboard_yt_recent',
  ytPositions: 'dashboard_yt_positions',
  ytResumeEnabled: 'dashboard_yt_resume_enabled',
  autoProcessedEmailIds: 'auto_processed_email_ids',
  /** JSON `{ "lat": number, "lon": number }` for Open-Meteo `/api/weather` */
  weatherCoords: 'dashboard_weather_coords',
  notificationsEnabled: 'dashboard_notifications_enabled',
  /** JSON `{ "date": "YYYY-MM-DD", "text": string }` — today's AI brief, cached to avoid regenerating on tab switch */
  dailyBrief: 'dashboard_daily_brief',
  /** 'primary' | 'secondary' */
  calendarAccount: 'dashboard_calendar_account',
  /** CalendarListItem.id */
  calendarMainId: 'dashboard_calendar_main_id',
  /** JSON string array of calendar IDs to include (optional). */
  calendarIncludedIds: 'dashboard_calendar_included_ids',
} as const;

/** sessionStorage keys (tab-scoped); not cleared by Settings → Clear All Data */
export const SESSION_KEYS = {
  viewportDesktopOverride: 'dashboard_viewport_desktop_override',
} as const;

