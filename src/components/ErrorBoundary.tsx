import { Component, ReactNode } from 'react';

interface Props { children: ReactNode; label?: string; }
interface State { hasError: boolean; message: string; }

export default class ErrorBoundary extends Component<Props, State> {
  // Explicit declarations needed because @types/react is not installed
  declare props: Readonly<Props>;
  declare state: Readonly<State>;
  declare setState: (state: State) => void;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: { componentStack: string }) {
    console.error(`[ErrorBoundary: ${this.props.label}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
          <span className="material-symbols-outlined text-5xl text-accent">error</span>
          <p className="font-heading text-xl text-foreground">{this.props.label ?? 'View'} crashed</p>
          <p className="text-sm text-text-muted max-w-sm">{this.state.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: '' })}
            className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-foreground border border-white/10 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
