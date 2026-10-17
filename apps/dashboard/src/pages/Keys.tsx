import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { ShownOnce } from "./ShownOnce";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  owner: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : "request failed");
export const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");

export function Keys() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  // The plaintext key lives only here. Dismiss, unmount or the next Generate drops it.
  const [fresh, setFresh] = useState<string | null>(null);

  // Promise chain, not async/await: the lint rule wants state set only in callbacks.
  const load = useCallback((): Promise<void> => {
    return api<ApiKey[]>("/keys")
      .then((list) => {
        setKeys(list);
      })
      .catch((err: unknown) => setError(messageOf(err)));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setFresh(null);
    try {
      const created = await api<{ key: string }>("/keys", { method: "POST", body: { name } });
      setFresh(created.key);
      setName("");
    } catch (err) {
      setError(messageOf(err));
    }
    await load();
  }

  async function revoke(k: ApiKey) {
    if (!window.confirm(`Revoke key '${k.name}' (${k.prefix}…)? Anything using it stops working.`)) return;
    setError("");
    try {
      await api(`/keys/${encodeURIComponent(k.id)}`, { method: "DELETE" });
    } catch (err) {
      setError(messageOf(err));
    }
    await load();
  }

  return (
    <>
      <h1>My Keys</h1>
      {error && <p role="alert">{error}</p>}
      {fresh && (
        <>
          <ShownOnce label="New API key" value={fresh} />
          <button onClick={() => setFresh(null)}>I&apos;ve saved it</button>
        </>
      )}
      {keys === null ? (
        !error && <p>Loading…</p>
      ) : keys.length === 0 ? (
        <p>No keys yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Created</th>
              <th>Last used</th>
              <th>State</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>{k.prefix}…</td>
                <td>{when(k.createdAt)}</td>
                <td>{when(k.lastUsedAt)}</td>
                <td>{k.revokedAt ? `revoked ${when(k.revokedAt)}` : "active"}</td>
                <td className="actions">{!k.revokedAt && <button onClick={() => void revoke(k)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="panel" onSubmit={(e) => void generate(e)}>
        <h2>Generate a key</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </label>
        <button type="submit">Generate key</button>
      </form>
    </>
  );
}
