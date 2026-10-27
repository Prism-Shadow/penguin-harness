/**
 * A render error stops at this boundary instead of unmounting the whole page. The app wraps
 * the shell's root in one whose fallback is the rescue panel, and wraps each rescue surface
 * (the palette, the safe-mode marker) in its own, so neither failure domain can take the other
 * down. There is no reset: the panel's way out is a reload.
 */
import { Component } from "react";
import type { ReactNode } from "react";

interface Props {
  /** What to draw once a descendant has thrown during render. */
  fallback: (error: unknown) => ReactNode;
  children: ReactNode;
}

type State = { failed: false } | { failed: true; error: unknown };

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.state.error) : this.props.children;
  }
}
