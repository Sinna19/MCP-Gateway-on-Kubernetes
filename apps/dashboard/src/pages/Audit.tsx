import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { when } from "./Keys";

interface AuditRow {
  id: string;
  user: string | null;
  server: string | null;
  tool: string;
  startedAt: string;
  durationMs: number;
  outcome: "ok" | "error";
  error: string | null;
  source: "mcp" | "chat";
}

interface MemberOption {
  id: string;
  email: string;
}

interface Filters {
  user: string;
  server: string;
  outcome: string;
  source: string;
}

const PAGE = 50;
const noFilters: Filters = { user: "", server: "", outcome: "", source: "" };
const messageOf = (err: unknown) => (err instanceof Error ? err.message : "request failed");

// Only filters that are set go into the query. `before` is the id of the last row we hold.
function queryFor(f: Filters, before?: string): string {
  const p = new URLSearchParams();
  if (f.user) p.set("user", f.user);
  if (f.server) p.set("server", f.server);
  if (f.outcome) p.set("outcome", f.outcome);
  if (f.source) p.set("source", f.source);
  if (before) p.set("before", before);
  p.set("limit", String(PAGE));
  return p.toString();
}

export function Audit() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [people, setPeople] = useState<MemberOption[]>([]);
  // Every fetch takes a number. Only the newest one may write state, so a slow answer
  // for old filters (or an old "Load older") can never overwrite the current list.
  const latest = useRef(0);

  // Promise chains, not async/await: the lint rule wants state set only in callbacks.
  const fetchPage = useCallback((f: Filters, before?: string): Promise<void> => {
    const mine = ++latest.current;
    return api<AuditRow[]>(`/audit?${queryFor(f, before)}`)
      .then((page) => {
        if (mine !== latest.current) return;
        setError("");
        setRows((old) => (before && old ? [...old, ...page] : page));
        setMore(page.length === PAGE);
      })
      .catch((err: unknown) => {
        if (mine === latest.current) setError(messageOf(err));
      });
  }, []);

  useEffect(() => {
    void fetchPage(filters);
  }, [fetchPage, filters]);

  // The User filter is for admins; a member's API scope is their own rows whatever they send.
  useEffect(() => {
    if (!isAdmin) return;
    api<MemberOption[]>("/members")
      .then(setPeople)
      .catch((err: unknown) => setError(messageOf(err)));
  }, [isAdmin]);

  const set = (key: keyof Filters) => (value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const last = rows?.at(-1);

  return (
    <>
      <h1>Audit log</h1>
      <div className="panel">
        {isAdmin && (
          <label>
            User
            <select value={filters.user} onChange={(e) => set("user")(e.target.value)}>
              <option value="">All</option>
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.email}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Server
          <input value={filters.server} onChange={(e) => set("server")(e.target.value)} maxLength={20} />
        </label>
        <label>
          Outcome
          <select value={filters.outcome} onChange={(e) => set("outcome")(e.target.value)}>
            <option value="">Any</option>
            <option value="ok">ok</option>
            <option value="error">error</option>
          </select>
        </label>
        <label>
          Source
          <select value={filters.source} onChange={(e) => set("source")(e.target.value)}>
            <option value="">Any</option>
            <option value="mcp">mcp</option>
            <option value="chat">chat</option>
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {rows === null ? (
        !error && <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No calls match</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>User</th>
              <th>Source</th>
              <th>Server</th>
              <th>Tool</th>
              <th>Duration</th>
              <th>Outcome</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {/* Server, tool and error come from upstreams and callers: plain text children only. */}
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{when(r.startedAt)}</td>
                <td>{r.user ?? "(deleted)"}</td>
                <td>{r.source}</td>
                <td>{r.server ?? "-"}</td>
                <td>{r.tool}</td>
                <td>{r.durationMs} ms</td>
                <td>{r.outcome}</td>
                <td>{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {more && last && <button onClick={() => void fetchPage(filters, last.id)}>Load older</button>}
    </>
  );
}
