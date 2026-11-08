import { env } from "../env";

export class GithubError extends Error {
  constructor(message: string, public status?: number, public retryAfter?: number) {
    super(message);
  }
}

const DIR = "snapshots";
export type RemoteSnapshot = { name: string; path: string; sha: string; size: number; createdAt: string; hash8: string };

/** `qr-20261108T120000Z-ab12cd34.qrbackup.json` → timestamp + content hash prefix. */
export const snapshotName = (createdAt: string, contentSha: string) =>
  `qr-${createdAt.replace(/[-:]/g, "").replace(/\.\d+/, "")}-${contentSha.slice(0, 8)}.qrbackup.json`;
const NAME_RE = /^qr-(\d{8}T\d{6}Z)-([a-f0-9]{8})\.qrbackup\.json$/;

function cfg() {
  const g = env.github();
  if (!g) throw new GithubError("GitHub backup is not configured (BACKUP_GITHUB_REPO / BACKUP_GITHUB_TOKEN)");
  if (!/^[\w.-]+\/[\w.-]+$/.test(g.repo)) throw new GithubError("BACKUP_GITHUB_REPO must look like owner/name");
  return g;
}

async function gh(path: string, init: RequestInit = {}, accept = "application/vnd.github+json"): Promise<Response> {
  const g = cfg();
  const url = `https://api.github.com/repos/${g.repo}/${path}`;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(25_000),
        headers: {
          Authorization: `Bearer ${g.token}`,
          Accept: accept,
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "qr-studio-backup",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      if (attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
      throw new GithubError("Could not reach GitHub");
    }
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const retry = Number(res.headers.get("retry-after") ?? 0) || Math.max(0, Number(res.headers.get("x-ratelimit-reset") ?? 0) - Math.floor(Date.now() / 1000));
      if (res.status === 429 || remaining === "0") throw new GithubError("GitHub rate limit reached", res.status, retry || 60);
    }
    if (res.status >= 500 && attempt < 2) { await sleep(500 * 2 ** attempt); continue; }
    return res;
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function expectOk(res: Response, what: string) {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  const hint = res.status === 401 ? "token invalid or expired" : res.status === 403 ? "token lacks Contents write access" : res.status === 404 ? "repository, branch or path not found (is the token scoped to this repo?)" : text.slice(0, 120);
  throw new GithubError(`${what} failed (${res.status}): ${hint}`, res.status);
}

export async function listRemote(): Promise<RemoteSnapshot[]> {
  const g = cfg();
  const res = await gh(`contents/${DIR}?ref=${encodeURIComponent(g.branch)}`);
  if (res.status === 404) return [];
  await expectOk(res, "Listing snapshots");
  const items = (await res.json()) as { name: string; path: string; sha: string; size: number }[];
  return items
    .map((i) => {
      const m = NAME_RE.exec(i.name);
      if (!m) return null;
      const t = m[1]!;
      return { ...i, createdAt: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`, hash8: m[2]! };
    })
    .filter((x): x is RemoteSnapshot => x !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function fetchRemote(name: string): Promise<string> {
  if (!NAME_RE.test(name)) throw new GithubError("Invalid snapshot name");
  const g = cfg();
  const res = await gh(`contents/${DIR}/${name}?ref=${encodeURIComponent(g.branch)}`, {}, "application/vnd.github.raw+json");
  await expectOk(res, "Downloading snapshot");
  return res.text();
}

export async function putRemote(name: string, text: string): Promise<void> {
  const g = cfg();
  const res = await gh(`contents/${DIR}/${name}`, {
    method: "PUT",
    body: JSON.stringify({ message: `backup ${name}`, content: Buffer.from(text).toString("base64"), branch: g.branch }),
  });
  if ((res.status === 409 || res.status === 422) && await fetchRemote(name).catch(() => null) === text) return;
  await expectOk(res, "Uploading snapshot");
}

export async function deleteRemote(s: RemoteSnapshot): Promise<void> {
  const g = cfg();
  const res = await gh(`contents/${s.path}`, { method: "DELETE", body: JSON.stringify({ message: `prune ${s.name}`, sha: s.sha, branch: g.branch }) });
  await expectOk(res, "Pruning snapshot");
}

/**
 * Retention: keep the newest KEEP_RECENT snapshots, plus the newest snapshot of each of the last
 * KEEP_MONTHS calendar months. Everything else is pruned (max MAX_PRUNE per run).
 */
export const KEEP_RECENT = 30;
export const KEEP_MONTHS = 12;
export const MAX_PRUNE = 25;
export function planPrune(all: RemoteSnapshot[]): RemoteSnapshot[] {
  const sorted = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keep = new Set(sorted.slice(0, KEEP_RECENT).map((s) => s.name));
  const months = new Map<string, RemoteSnapshot>();
  for (const s of sorted) if (!months.has(s.createdAt.slice(0, 7))) months.set(s.createdAt.slice(0, 7), s);
  [...months.values()].slice(0, KEEP_MONTHS).forEach((s) => keep.add(s.name));
  return sorted.filter((s) => !keep.has(s.name)).reverse().slice(0, MAX_PRUNE);
}
