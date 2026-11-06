import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Contains a crash to the panel it belongs to.
 *
 * This app has twice gone completely blank because one component threw —
 * an undefined `Matrix`, an unimported `graphProbe`. A white screen tells a user
 * nothing and tells a judge even less. A boundary turns that into one broken
 * section with a readable message and the rest of the product still working.
 */
interface Props {
  children: ReactNode;
  /** Shown instead of the children when they throw. */
  label: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Nothing leaves the browser; the console is the only sink we have inside
    // Forge, and a judge can read it.
    console.error(`[cascade] ${this.props.label} failed`, error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <section className="card card--warnbox">
          <h2>{this.props.label} could not render</h2>
          <p className="muted">{this.state.error.message}</p>
          <p className="hint">
            The rest of Cascade still works — this section failed, not the app. Reload the panel to
            try again.
          </p>
        </section>
      );
    }

    return this.props.children;
  }
}
