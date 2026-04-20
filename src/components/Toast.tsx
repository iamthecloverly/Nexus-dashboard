import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const ICONS: Record<ToastType, string> = {
  success: 'check_circle',
  error: 'error',
  info: 'info',
};

const STYLES: Record<ToastType, string> = {
  success: 'bg-green-500/20 border-green-500/30 text-green-300 shadow-[0_0_20px_rgba(34,197,94,0.15)]',
  error:   'bg-red-500/20   border-red-500/30   text-red-300   shadow-[0_0_20px_rgba(239,68,68,0.15)]',
  info:    'bg-primary/20   border-primary/30   text-primary   shadow-[0_0_20px_rgba(6,232,249,0.15)]',
};

let _toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++_toastCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
  }, []);

  const dismiss = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="fixed top-6 right-6 z-[200] flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            style={{ animation: 'toast-in 0.18s ease-out' }}
            className={`pointer-events-auto flex items-center gap-2.5 pl-3.5 pr-2.5 py-2.5 rounded-xl text-sm font-medium border backdrop-blur-md ${STYLES[toast.type]}`}
          >
            <span className="material-symbols-outlined !text-[16px] flex-shrink-0" aria-hidden="true">{ICONS[toast.type]}</span>
            <span className="max-w-[340px] break-words">{toast.message}</span>
            <button
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="ml-1 opacity-60 hover:opacity-100 transition-opacity flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
            >
              <span className="material-symbols-outlined !text-[14px]" aria-hidden="true">close</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
