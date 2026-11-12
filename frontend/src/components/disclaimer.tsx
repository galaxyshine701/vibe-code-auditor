import { DISCLAIMER } from '@/lib/config';

export function Disclaimer() {
  return (
    <div className="disclaimer-card">
      <span className="disclaimer-label">Evidence, not a guarantee</span>
      <p>{DISCLAIMER}</p>
    </div>
  );
}
