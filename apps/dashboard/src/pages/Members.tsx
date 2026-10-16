import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { when, type ApiKey } from "./Keys";
import { ShownOnce } from "./ShownOnce";

interface Member {
  id: string;
  email: string;
  role: "admin" | "member";
  disabled: boolean;
  activeKeys: number;
}

interface Invite {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : "request failed");

export function Members() {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [error, setError] = useState("");
  // The invite link lives only here. The next invite or leaving the page drops it.
  const [link, setLink] = useState<string | null>(null);

  // No polling: nothing here changes unless an admin acts, so every write reloads once.
  const load = useCallback((): Promise<void> => {
    return Promise.all([api<Member[]>("/members"), api<Invite[]>("/invites"), api<ApiKey[]>("/keys?all=true")])
      .then(([m, i, k]) => {
        setMembers(m);
        setInvites(i);
        setKeys(k);
      })
      .catch((err: unknown) => setError(messageOf(err)));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
    }
    await load();
  }

  const patch = (m: Member, body: object) => run(() => api(`/members/${m.id}`, { method: "PATCH", body }));
  const cancelInvite = (i: Invite) => run(() => api(`/invites/${i.id}`, { method: "DELETE" }));
  const revokeKey = (k: ApiKey) => {
    if (!window.confirm(`Revoke key '${k.name}' of ${k.owner}? Anything using it stops working.`)) return Promise.resolve();
    return run(() => api(`/keys/${k.id}`, { method: "DELETE" }));
  };

  // GET /keys?all=true gives the owner's email, not an id. Emails are unique (case-insensitive), so match on that.
  const keysOf = (m: Member) => keys.filter((k) => k.owner.toLowerCase() === m.email.toLowerCase());

  return (
    <>
      <h1>Members</h1>
      {error && <p role="alert">{error}</p>}
      <p>Disable blocks all their keys and ends their sessions now. Revoke below cuts off one key only.</p>
      {members === null ? (
        !error && <p>Loading…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Active keys</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              // The API refuses this too (400); disabling the buttons just saves the round trip.
              const self = Number(m.id) === Number(user?.id);
              const theirs = keysOf(m);
              return (
                <Fragment key={m.id}>
                  <tr>
                    <td>{m.email}</td>
                    <td>
                      <select
                        aria-label={`Role of ${m.email}`}
                        value={m.role}
                        disabled={self}
                        onChange={(e) => void patch(m, { role: e.target.value })}
                      >
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td>{m.disabled ? "disabled" : "enabled"}</td>
                    <td>{m.disabled ? "blocked" : m.activeKeys}</td>
                    <td className="actions">
                      <button disabled={self} onClick={() => void patch(m, { disabled: !m.disabled })}>
                        {m.disabled ? "Enable" : "Disable"}
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={5}>
                      {theirs.length === 0 ? (
                        "no keys"
                      ) : (
                        <details>
                          <summary>{theirs.length === 1 ? "1 key" : `${theirs.length} keys`}</summary>
                          <table>
                            <tbody>
                              {theirs.map((k) => (
                                <tr key={k.id}>
                                  <td>{k.name}</td>
                                  <td>{k.prefix}…</td>
                                  <td>created {when(k.createdAt)}</td>
                                  <td>last used {when(k.lastUsedAt)}</td>
                                  <td>{k.revokedAt ? `revoked ${when(k.revokedAt)}` : "active"}</td>
                                  <td>{!k.revokedAt && <button onClick={() => void revokeKey(k)}>Revoke</button>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </details>
                      )}
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Pending invites</h2>
      {invites.length === 0 ? (
        <p>No pending invites</p>
      ) : (
        <table>
          <tbody>
            {invites.map((i) => (
              <tr key={i.id}>
                <td>{i.email}</td>
                <td>{i.role}</td>
                <td>expires {when(i.expiresAt)}</td>
                <td className="actions">
                  <button onClick={() => void cancelInvite(i)}>Cancel</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {link && <ShownOnce label="Invite link" value={link} />}
      <InviteForm
        onCreated={(path) => {
          setLink(`${window.location.origin}${path}`);
          void load();
        }}
        onStart={() => setLink(null)}
      />
    </>
  );
}

function InviteForm({ onCreated, onStart }: { onCreated: (path: string) => void; onStart: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    onStart();
    try {
      const created = await api<{ path: string }>("/invites", { method: "POST", body: { email, role } });
      setEmail("");
      onCreated(created.path);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  return (
    <form className="panel" onSubmit={(e) => void submit(e)}>
      <h2>Invite a member</h2>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")}>
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Create invite</button>
    </form>
  );
}
