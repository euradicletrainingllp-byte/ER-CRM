export function LoadingState({ message = 'Loading data from Excel…' }) {
  return (
    <div className="loading-state">
      <div className="loading-spinner" />
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{message}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
        Fetching live data via Power Automate
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  const isNotConfigured = error?.message?.startsWith('FLOW_NOT_CONFIGURED');
  const flowKey = isNotConfigured ? error.message.split(':')[1] : null;

  if (isNotConfigured) {
    return (
      <div className="not-configured">
        <h3>⚠️ Flow Not Configured — {flowKey}</h3>
        <p>
          Paste your Power Automate HTTP URL for <strong>{flowKey}</strong> into{' '}
          <code>src/config/powerAutomate.js</code> to connect live Excel data.
        </p>
        <p style={{ fontSize: 12 }}>See README.md for step-by-step setup instructions.</p>
      </div>
    );
  }

  return (
    <div className="error-state">
      <div className="error-icon">⚠️</div>
      <div className="error-title">Could not load data</div>
      <div className="error-desc">{error?.message || 'Unknown error occurred'}</div>
      {onRetry && (
        <button className="btn btn-primary" onClick={onRetry}>
          ↺ Retry
        </button>
      )}
    </div>
  );
}
