import { DISCLAIMER } from '@/lib/config';

export function Disclaimer() {
  return (
    <div className="disclaimer-card">
      <span className="disclaimer-label">What these checks cover</span>
      <p>{DISCLAIMER}</p>
    </div>
  );
}
