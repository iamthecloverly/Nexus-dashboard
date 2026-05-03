import { useState, useEffect, useCallback } from 'react';

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

/**
 * Hook for managing browser notification permission.
 * Returns the current permission state and a function to request permission.
 */
export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermissionState>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission as NotificationPermissionState;
  });

  useEffect(() => {
    if (!('Notification' in window)) return;
    let permissionStatus: PermissionStatus | null = null;
    let cancelled = false;

    // Some browsers support permission change events
    const handleChange = () => {
      setPermission(Notification.permission as NotificationPermissionState);
    };

    // Try to listen for permission changes (not widely supported)
    try {
      void navigator.permissions?.query({ name: 'notifications' as PermissionName }).then(status => {
        if (cancelled) return;
        permissionStatus = status;
        status.addEventListener('change', handleChange);
      }).catch(() => {
        // Permission API not available or query failed
      });
    } catch {
      // Permission API not supported
    }

    return () => {
      cancelled = true;
      permissionStatus?.removeEventListener('change', handleChange);
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';

    try {
      const result = await Notification.requestPermission();
      setPermission(result as NotificationPermissionState);
      return result as NotificationPermissionState;
    } catch {
      setPermission('denied');
      return 'denied';
    }
  }, []);

  const isSupported = typeof window !== 'undefined' && 'Notification' in window;

  return {
    permission,
    isSupported,
    isGranted: permission === 'granted',
    isDenied: permission === 'denied',
    isDefault: permission === 'default',
    requestPermission,
  };
}
