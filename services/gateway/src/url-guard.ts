import dns from "node:dns/promises";
import net from "node:net";

// Addresses an admin-supplied upstream URL may never point at (SSRF): this machine, the cloud metadata
// address and other link-local hosts, and "unspecified" (which connects to localhost on Linux).
// Private ranges (10/8, 172.16/12, 192.168/16) stay allowed on purpose: in-cluster upstreams live there.
const blocked = new net.BlockList();
blocked.addSubnet("127.0.0.0", 8, "ipv4");
blocked.addSubnet("0.0.0.0", 8, "ipv4");
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addAddress("::1", "ipv6");
blocked.addAddress("::", "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");

type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;

const resolveAll: Lookup = (hostname) => dns.lookup(hostname, { all: true });

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  return family !== 0 && blocked.check(address, family === 4 ? "ipv4" : "ipv6"); // ::ffff:127.0.0.1 is checked as 127.0.0.1
}

// For a hostname as URL.hostname gives it (IPv6 in brackets; odd IPv4 spellings are already normalised).
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || isBlockedAddress(host);
}

// Run again at connect time: a name that was fine at registration can resolve somewhere else later.
export async function assertAllowedHost(hostname: string, lookup: Lookup = resolveAll): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const notAllowed = new Error("host is not allowed (loopback, link-local or unspecified address)");
  if (isBlockedHost(hostname)) throw notAllowed;
  if (net.isIP(host)) return;
  if ((await lookup(host)).some((a) => isBlockedAddress(a.address))) throw notAllowed;
}
