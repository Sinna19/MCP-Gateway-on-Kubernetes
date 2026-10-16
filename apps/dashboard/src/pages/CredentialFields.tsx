export interface Cred {
  mode: "none" | "keep" | "replace" | "remove";
  kind: "bearer" | "header";
  token: string;
  name: string;
  value: string;
}

export const EMPTY_CRED: Cred = { mode: "none", kind: "bearer", token: "", name: "", value: "" };

// The shape the API wants: undefined = leave alone, null = remove, object = set.
export function authFor(c: Cred) {
  if (c.mode === "remove") return null;
  if (c.mode !== "replace") return undefined;
  return c.kind === "bearer" ? { type: "bearer" as const, token: c.token } : { type: "header" as const, name: c.name, value: c.value };
}

interface Props {
  variant: "add" | "edit";
  hasCredential: boolean;
  urlChanged: boolean;
  cred: Cred;
  onChange: (c: Cred) => void;
}

// Write-only: nothing here is ever filled from the server. The secret inputs are
// type=password with autocomplete=new-password, so the browser does not offer the
// saved dashboard login password for them.
export function CredentialFields({ variant, hasCredential, urlChanged, cred, onChange }: Props) {
  const set = (patch: Partial<Cred>) => onChange({ ...cred, ...patch });
  const group = `cred-${variant}`;

  const kinds = (
    <>
      <label>
        <input type="radio" name={`${group}-kind`} checked={cred.kind === "bearer"} onChange={() => set({ kind: "bearer" })} />
        Bearer token
      </label>
      <label>
        <input type="radio" name={`${group}-kind`} checked={cred.kind === "header"} onChange={() => set({ kind: "header" })} />
        Header
      </label>
    </>
  );

  const inputs =
    cred.mode === "replace" &&
    (cred.kind === "bearer" ? (
      <label>
        Token
        <input type="password" autoComplete="new-password" value={cred.token} onChange={(e) => set({ token: e.target.value })} required />
      </label>
    ) : (
      <>
        <label>
          Header name
          <input value={cred.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" required />
        </label>
        <label>
          Header value
          <input type="password" autoComplete="new-password" value={cred.value} onChange={(e) => set({ value: e.target.value })} required />
        </label>
      </>
    ));

  if (variant === "add") {
    const pick = (kind: Cred["kind"]) => set({ mode: "replace", kind });
    return (
      <fieldset>
        <legend>Credential (write-only)</legend>
        <label>
          <input type="radio" name={group} checked={cred.mode === "none"} onChange={() => set({ mode: "none" })} />
          No credential
        </label>
        <label>
          <input type="radio" name={group} checked={cred.mode === "replace" && cred.kind === "bearer"} onChange={() => pick("bearer")} />
          Bearer token
        </label>
        <label>
          <input type="radio" name={group} checked={cred.mode === "replace" && cred.kind === "header"} onChange={() => pick("header")} />
          Header
        </label>
        {inputs}
      </fieldset>
    );
  }

  return (
    <fieldset>
      <legend>Credential (write-only)</legend>
      {hasCredential ? (
        <label>
          <input type="radio" name={group} disabled={urlChanged} checked={cred.mode === "keep"} onChange={() => set({ mode: "keep" })} />
          Keep the stored credential
        </label>
      ) : (
        <label>
          <input type="radio" name={group} checked={cred.mode === "remove"} onChange={() => set({ mode: "remove" })} />
          No credential
        </label>
      )}
      <label>
        <input type="radio" name={group} checked={cred.mode === "replace"} onChange={() => set({ mode: "replace" })} />
        Replace
      </label>
      {hasCredential && (
        <label>
          <input type="radio" name={group} checked={cred.mode === "remove"} onChange={() => set({ mode: "remove" })} />
          Remove
        </label>
      )}
      {urlChanged && hasCredential && <p>A new URL needs the credential again: replace it or remove it.</p>}
      {cred.mode === "replace" && kinds}
      {inputs}
    </fieldset>
  );
}
