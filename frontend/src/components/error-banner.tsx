'use client';

import { uiText } from '@/lib/ui-copy';
import { useLang } from '@/lib/use-lang';

export function ErrorBanner({
  message,
  onRetry,
  retryLabel = 'Retry',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const [lang] = useLang();
  return (
    <div className="error-banner" role="alert" aria-live="assertive">
      <span className="error-symbol" aria-hidden="true">
        !
      </span>
      <p>{uiText(message, lang)}</p>
      {onRetry ? (
        <button type="button" className="button button-small" onClick={onRetry}>
          {uiText(retryLabel, lang)}
        </button>
      ) : null}
    </div>
  );
}
