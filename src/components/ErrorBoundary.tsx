import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: string;
}

/**
 * A render error must never leave a blank screen with the work apparently
 * gone. The project lives in local storage, so it survives; this says so,
 * shows what actually broke, and offers a way back without wiping anything.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? '' });
    // Keep the real stack in the console for anyone reading it.
    console.error('Cabinetry render error:', error, info.componentStack);
  }

  private downloadProject = () => {
    try {
      const raw = localStorage.getItem('cabinetry.project.v1');
      if (!raw) return;
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cabinetry-recovered.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* nothing further we can do from here */
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{ padding: 32, maxWidth: 760, margin: '0 auto' }}>
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Something in the drawing broke</h2>
          <p className="muted">
            Your project is still saved in this browser — nothing has been lost. Reloading usually clears it. If it
            keeps happening, save a copy first and send the message below.
          </p>

          <div className="section-title">What went wrong</div>
          <pre
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--line)',
              borderRadius: 6,
              padding: 10,
              fontSize: 11,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {this.state.error.message}
            {this.state.info ? `\n${this.state.info.split('\n').slice(0, 6).join('\n')}` : ''}
          </pre>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button onClick={this.downloadProject}>Save a copy of the project</button>
          </div>
        </div>
      </div>
    );
  }
}
