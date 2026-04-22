import { acknowledgeDesktopViewportOverride } from '../hooks/useViewportDesktopGate';

/**
 * Playful full-screen gate for phone / tablet / ultra-narrow windows.
 * Desktop is treated as viewport width ≥ Tailwind `xl` (1280px), unless user acknowledges below.
 */
export function DesktopOnlyNotice() {
  return (
    <main
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center overflow-hidden px-6 py-12 text-center bg-background-dark text-foreground"
      aria-labelledby="desktop-only-title"
    >
      {/* Background ambience */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-[20%] left-1/2 h-[55vmin] w-[55vmin] -translate-x-1/2 rounded-full blur-[120px] opacity-90"
          style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.22) 0%, transparent 68%)' }}
        />
        <div
          className="absolute bottom-[-25%] right-[-15%] h-[60vmin] w-[60vmin] rounded-full blur-[140px] opacity-80"
          style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.18) 0%, transparent 70%)' }}
        />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.5\'/%3E%3C/svg%3E")', backgroundSize: '256px' }} />
      </div>

      {/* Floating “windows” */}
      <div className="relative mb-10 flex items-end justify-center gap-3 sm:gap-4" aria-hidden="true">
        <span className="desktop-only-float panel-delay-0 inline-flex h-14 w-20 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-sm">
          <span className="material-symbols-outlined text-2xl text-primary/90">dashboard</span>
        </span>
        <span className="desktop-only-float panel-delay-1 inline-flex h-20 w-28 items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-br from-primary/15 to-transparent shadow-[0_16px_48px_rgba(56,189,248,0.25)] backdrop-blur-md ring-1 ring-white/10">
          <span className="material-symbols-outlined text-4xl text-primary neon-text-glow">hub</span>
        </span>
        <span className="desktop-only-float panel-delay-2 inline-flex h-14 w-20 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-sm">
          <span className="material-symbols-outlined text-2xl text-accent-secondary/90">calendar_month</span>
        </span>
      </div>

      <div className="relative z-10 max-w-md">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/95 shadow-inner">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_rgba(56,189,248,0.8)]" />
          </span>
          Desktop radar
        </p>

        <h1 id="desktop-only-title" className="font-heading text-3xl font-bold leading-tight sm:text-4xl">
          Your dashboard got{' '}
          <span className="bg-gradient-to-r from-primary via-sky-300 to-accent-secondary bg-clip-text text-transparent">
            stage fright
          </span>{' '}
          on this screen
        </h1>

        <p className="mt-5 text-[15px] leading-relaxed text-text-muted">
          Nexus is choreographed for <strong className="text-foreground/90">wide layouts, keyboard shortcuts, and room to think</strong> — not thumbs on a subway. Open it in a desktop browser when
          you’re at HQ and we’ll roll out the full mission control.
        </p>

        <ul className="mt-8 space-y-2.5 text-left text-sm text-text-muted">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[12px]" aria-hidden="true">
              🖥️
            </span>
            <span>
              <span className="font-medium text-foreground/85">Chrome, Firefox, Safari, Edge</span> on a laptop or monitor at{' '}
              <span className="font-mono text-[12px] text-primary/90">≥1280px</span> wide works best.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-secondary/15 text-[12px]" aria-hidden="true">
              📱
            </span>
            <span>
              Phones &amp; tablets make our panels feel like a sweater two sizes too small — adorable, but cramped.
            </span>
          </li>
        </ul>

        <div className="mt-10 flex flex-col items-center gap-4">
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-5 py-4 text-[13px] text-text-muted">
            <span className="font-medium text-foreground/80">Pro tip:</span> send yourself the link, AirDrop it to your Mac, or summon a browser window worth of horizontal pixels — then tap refresh.
          </div>

          <button
            type="button"
            onClick={() => acknowledgeDesktopViewportOverride()}
            className="text-[12px] font-medium text-text-muted underline decoration-white/15 underline-offset-4 transition-colors hover:text-primary hover:decoration-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:rounded"
          >
            Actually I&apos;m on desktop — just a skinny window (show anyway)
          </button>
        </div>
      </div>
    </main>
  );
}
