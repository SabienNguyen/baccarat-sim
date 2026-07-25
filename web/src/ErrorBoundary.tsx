import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  failed: boolean;
}

/**
 * Last line of defense against a render-time throw. Without it, one bad
 * server payload (or a protocol-skewed build) that trips an unguarded
 * `.reduce`/`.map` in the render tree unmounts the whole React root to a
 * blank white page. Here it becomes a legible, recoverable notice instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("render error caught by boundary:", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ maxWidth: "36rem", margin: "20vh auto 0", padding: "0 1.5rem", textAlign: "center" }}>
        <h1>The table hit a snag</h1>
        <p>Something went wrong rendering the game. A refresh should bring it back.</p>
        <button type="button" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
