export function CleanupWarning({ note }: { note?: string }) {
  return (
    <div className="warning-card" role="alert">
      <div className="warning-icon" aria-hidden="true">
        !
      </div>
      <div>
        <strong>Cleanup did not finish.</strong>
        <p>
          {note ??
            'Some temporary test users or canary rows may still be in your test project. Check Supabase Auth and your tables.'}
        </p>
      </div>
    </div>
  );
}
