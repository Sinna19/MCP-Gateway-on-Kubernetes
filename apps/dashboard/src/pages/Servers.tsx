import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { CredentialFields, EMPTY_CRED, authFor, type Cred } from "./CredentialFields";

export interface Server {
  slug: string;
  enabled: boolean;
  status: "connected" | "unreachable" | "disabled";
  tools: Array<{ name: string; description: string }>;
  url: string;
  headerName: string | null;
  hasCredential: boolean;
}

const POLL_MS = 5000;

const messageOf = (err: unknown) => (err instanceof Error ? err.message : "request failed");

export function Servers() {
  const [servers, setServers] = useState<Server[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  // A snapshot taken when Edit is clicked. The poll replaces `servers` but never this,
  // so the form keeps what the admin is typing.
  const [editing, setEditing] = useState<Server | null>(null);
  const inFlight = useRef(false);
  const latest = useRef(0);

  // force = after a write: always fetch, and only the newest answer is applied.
  // Written as a promise chain (like auth.tsx) so state is only set in callbacks.
  const load = useCallback((force = false): Promise<void> => {
    if (inFlight.current && !force) return Promise.resolve();
    inFlight.current = true;
    const mine = ++latest.current;
    return api<Server[]>("/servers")
      .then((list) => {
        if (mine !== latest.current) return;
        setServers(list);
        setLoadError("");
      })
      .catch((err: unknown) => {
        if (mine === latest.current) setLoadError(messageOf(err));
      })
      .finally(() => {
        if (mine === latest.current) inFlight.current = false;
      });
  }, []);

  useEffect(() => {
    void load();
    const visible = () => document.visibilityState !== "hidden";
    const timer = setInterval(() => {
      if (visible()) void load();
    }, POLL_MS);
    const onVisible = () => {
      if (visible()) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setActionError("");
    try {
      await action();
    } catch (err) {
      setActionError(messageOf(err));
    }
    await load(true);
  }

  const toggle = (s: Server) => run(() => api(`/servers/${encodeURIComponent(s.slug)}`, { method: "PATCH", body: { enabled: !s.enabled } }));
  const remove = (s: Server) => {
    if (!window.confirm(`Delete server '${s.slug}'? Its audit history is kept.`)) return Promise.resolve();
    return run(() => api(`/servers/${encodeURIComponent(s.slug)}`, { method: "DELETE" }));
  };

  return (
    <>
      <h1>Servers</h1>
      {loadError && <p role="alert">{loadError}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {servers === null ? (
        !loadError && <p>Loading…</p>
      ) : servers.length === 0 ? (
        <p>No servers yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>URL</th>
              <th>Status</th>
              <th>Tools</th>
              <th>Credential</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.slug}>
                <td>{s.slug}</td>
                <td>{s.url}</td>
                <td>
                  <span className={`badge ${s.status}`}>{s.status}</span>
                </td>
                <td>
                  <details>
                    <summary>{s.tools.length} tools</summary>
                    <ul>
                      {s.tools.map((t) => (
                        <li key={t.name}>{t.name}</li>
                      ))}
                    </ul>
                  </details>
                </td>
                <td>{s.hasCredential ? `set (${s.headerName})` : "none"}</td>
                <td className="actions">
                  <button onClick={() => setEditing(s)}>Edit</button>
                  <button onClick={() => void toggle(s)}>{s.enabled ? "Disable" : "Enable"}</button>
                  <button onClick={() => void remove(s)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing ? (
        <EditForm
          key={editing.slug}
          server={editing}
          onDone={() => {
            setEditing(null);
            void load(true);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        servers !== null && <AddForm onDone={() => void load(true)} />
      )}
    </>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");
  const [cred, setCred] = useState<Cred>(EMPTY_CRED);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const auth = authFor(cred);
    try {
      await api("/servers", { method: "POST", body: { slug, url, ...(auth ? { auth } : {}) } });
      setSlug("");
      setUrl("");
      onDone();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setCred(EMPTY_CRED); // the secret does not stay in memory, success or not
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)}>
      <h2>Add a server</h2>
      <label>
        Slug
        <input value={slug} onChange={(e) => setSlug(e.target.value)} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={20} required />
      </label>
      <label>
        URL
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
      </label>
      <CredentialFields variant="add" hasCredential={false} urlChanged={false} cred={cred} onChange={setCred} />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Add server</button>
    </form>
  );
}

function EditForm({ server, onDone, onCancel }: { server: Server; onDone: () => void; onCancel: () => void }) {
  const [url, setUrl] = useState(server.url);
  const [cred, setCred] = useState<Cred>({ ...EMPTY_CRED, mode: server.hasCredential ? "keep" : "remove" });
  const [error, setError] = useState("");
  const urlChanged = url !== server.url;

  function changeUrl(value: string) {
    setUrl(value);
    // The API refuses a new url with the old credential, so Keep can no longer be chosen.
    if (value !== server.url && cred.mode === "keep") setCred({ ...cred, mode: "replace" });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const body: Record<string, unknown> = {};
    if (urlChanged) body.url = url;
    // No stored credential and no url change: "remove" has nothing to remove.
    const auth = cred.mode === "remove" && !server.hasCredential && !urlChanged ? undefined : authFor(cred);
    if (auth !== undefined) body.auth = auth;
    if (Object.keys(body).length === 0) {
      setError("nothing to save");
      return;
    }
    try {
      await api(`/servers/${server.slug}`, { method: "PATCH", body });
      onDone();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setCred({ ...cred, token: "", value: "" });
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)}>
      <h2>
        Edit <span data-testid="edit-slug">{server.slug}</span>
      </h2>
      <label>
        URL
        <input type="url" value={url} onChange={(e) => changeUrl(e.target.value)} required />
      </label>
      <CredentialFields variant="edit" hasCredential={server.hasCredential} urlChanged={urlChanged} cred={cred} onChange={setCred} />
      {error && <p role="alert">{error}</p>}
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
