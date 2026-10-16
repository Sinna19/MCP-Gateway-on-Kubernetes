// A secret shown once (new API key, invite link) in a read-only input that selects its text on focus.
// navigator.clipboard only exists in a secure context, so the Copy button is shown only if it is there.
export function ShownOnce({ label, value }: { label: string; value: string }) {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  return (
    <div className="panel">
      <label>
        {label}
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} autoComplete="off" />
      </label>
      {clipboard && (
        <button type="button" onClick={() => void clipboard.writeText(value).catch(() => undefined)}>
          Copy
        </button>
      )}
      <p>Shown once. It cannot be looked up again.</p>
    </div>
  );
}
