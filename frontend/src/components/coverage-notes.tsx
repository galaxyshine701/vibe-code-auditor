import { COVERAGE } from '@/lib/coverage';

export function CoverageNotes({ summary }: { summary: string }) {
  return (
    <details className="disclosure">
      <summary>{summary}</summary>
      <div className="disclosure-body">
        <h3>Checked</h3>
        <p>{COVERAGE.checked}</p>
        <p>{COVERAGE.inconclusive}</p>
        <h3>Not covered</h3>
        <ul>
          {COVERAGE.notCovered.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h3>Limits</h3>
        <ul>
          {COVERAGE.limits.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}
