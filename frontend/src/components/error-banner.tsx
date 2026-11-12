export function ErrorBanner({
  message,
  onRetry,
  retryLabel = 'Retry',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="error-banner" role="alert" aria-live="assertive">
      <span className="error-symbol" aria-hidden="true">
        !
      </span>
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="button button-small" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
