import { vi } from "vitest";

type File = { content: string; sha: string };
export type FakeGithub = ReturnType<typeof installFakeGithub>;

/**
 * A small in-memory stand-in for the GitHub "contents" API (list, get raw, put, delete), installed with
 * `vi.stubGlobal("fetch")`. Failure modes can be toggled per test.
 */
export function installFakeGithub(repo = "owner/repo") {
  const files = new Map<string, File>();
  let n = 0;
  const calls: { method: string; path: string; headers: Record<string, string> }[] = [];
  const mode = {
    /** 403 + x-ratelimit-remaining: 0 for these methods ("*" = all) */
    rateLimit: null as null | string,
    /** 500 for these methods ("*" = all) */
    serverError: null as null | string,
    /** reject the fetch promise (network down) */
    networkDown: false,
    /** artificial latency per request */
    delayMs: 0,
  };
  const hit = (m: string, spec: string | null) => spec !== null && (spec === "*" || spec === m);
  const base = `https://api.github.com/repos/${repo}/contents/`;

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const path = decodeURIComponent(url.slice(base.length).split("?")[0] ?? "");
    calls.push({ method, path, headers });
    if (mode.delayMs) await new Promise((r) => setTimeout(r, mode.delayMs));
    if (mode.networkDown) throw new TypeError("fetch failed");
    if (!url.startsWith(base)) return new Response("unexpected host", { status: 599 });
    if (hit(method, mode.rateLimit)) {
      return new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 120) } });
    }
    if (hit(method, mode.serverError)) return new Response("boom", { status: 500 });

    if (method === "GET" && path === "snapshots") {
      if (!files.size) return Response.json({ message: "Not Found" }, { status: 404 });
      return Response.json([...files].map(([p, f]) => ({ name: p.split("/").pop(), path: p, sha: f.sha, size: f.content.length })));
    }
    if (method === "GET" && path.startsWith("snapshots/")) {
      const f = files.get(path);
      return f ? new Response(f.content, { status: 200 }) : new Response("nope", { status: 404 });
    }
    if (method === "PUT") {
      const b = JSON.parse(String(init?.body)) as { content: string };
      files.set(path, { content: Buffer.from(b.content, "base64").toString("utf8"), sha: `sha${++n}` });
      return Response.json({ content: { path } }, { status: 201 });
    }
    if (method === "DELETE") {
      const b = JSON.parse(String(init?.body)) as { sha: string };
      const f = files.get(path);
      if (!f || f.sha !== b.sha) return new Response("sha mismatch", { status: 409 });
      files.delete(path);
      return Response.json({}, { status: 200 });
    }
    return new Response("unhandled", { status: 400 });
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    files,
    calls,
    mode,
    fetch: fetchMock,
    puts: () => calls.filter((c) => c.method === "PUT").length,
    /** Seed an already-uploaded snapshot file. */
    seed(name: string, content = "{}") {
      files.set(`snapshots/${name}`, { content, sha: `sha${++n}` });
    },
    names: () => [...files.keys()].map((p) => p.slice("snapshots/".length)).sort(),
    reset() {
      files.clear();
      calls.length = 0;
      mode.rateLimit = mode.serverError = null;
      mode.networkDown = false;
      mode.delayMs = 0;
      fetchMock.mockClear();
    },
  };
}
