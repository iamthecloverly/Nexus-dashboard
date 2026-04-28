// Augment React's CSSProperties to include newer CSS containment properties
// that are not yet part of the TypeScript DOM lib.
export {};

declare module 'react' {
  interface CSSProperties {
    contentVisibility?: 'auto' | 'hidden' | 'visible';
    containIntrinsicSize?: string;
  }
}
