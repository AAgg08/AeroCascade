import { Component, type ReactNode } from 'react';

export class WorkspaceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold">This workspace could not load</h2>
          <p className="mt-2 text-sm text-gray-700">Check your connection, then reload AeroCascade to try again. You can also use the navigation to open another workspace.</p>
          <button type="button" onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm text-white">Reload AeroCascade</button>
        </section>
      );
    }
    return this.props.children;
  }
}
