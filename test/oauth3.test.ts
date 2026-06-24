import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { OtterViaOauth3 } from "../src/otter-oauth3.ts";

// A tiny stand-in for an OAuth3 instance: implements exactly the endpoints the
// oauth3-sdk hits — the connect handshake plus the plugin read API. It returns
// the otter PluginItem / {transcript} shapes OtterViaOauth3 consumes.
const ITEMS = [
  { id: "OAAA", title: "Owned Meeting", date: "2023-11-14T22:13:20.000Z", meta: { hasPhotos: 0, live: "ended" } },
  { id: "OBBB", title: "Shared Meeting", date: "2023-11-14T22:21:40.000Z", meta: {} },
];
const TRANSCRIPTS: Record<string, string> = {
  OAAA: "Andrew Miller  0:05\nHello everyone.\n\nSri  0:12\nThanks for joining.\n",
  OBBB: "Bo  0:01\nShared content here.\n",
};

let instance: ReturnType<typeof Bun.serve>;
let node: string;
let approveRequests = 0;
let authSeen: string[] = []; // Authorization headers the instance received

beforeAll(() => {
  instance = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      if (auth) authSeen.push(auth);

      if (url.pathname === "/api/connect" && req.method === "POST") {
        approveRequests += 1;
        return Response.json({ requestId: "req-1", approveUrl: `${node}/approve/req-1` });
      }
      if (url.pathname === "/api/connect/req-1") {
        return Response.json({ status: "approved", token: "scoped-token-from-approval" });
      }
      if (url.pathname === "/api/otter/items" && req.method === "GET") {
        return Response.json({ data: ITEMS });
      }
      const m = url.pathname.match(/^\/api\/otter\/items\/(.+)$/);
      if (m && req.method === "GET") {
        const id = decodeURIComponent(m[1]!);
        const transcript = TRANSCRIPTS[id];
        if (!transcript) return new Response("not found", { status: 404 });
        return Response.json({ data: { transcript } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  node = `http://localhost:${instance.port}`;
});

afterAll(() => instance.stop(true));

// Spy on global fetch for the duration of a call; prove no otter.ai request and
// no Otter session cookie ever leaves this process. This is the token-only proof.
async function withFetchSpy<T>(fn: () => Promise<T>): Promise<{ result: T; urls: string[]; cookies: string[] }> {
  const real = globalThis.fetch;
  const urls: string[] = [];
  const cookies: string[] = [];
  globalThis.fetch = ((input: any, init?: any) => {
    const u = typeof input === "string" ? input : input.url;
    urls.push(u);
    const hdrs = new Headers(init?.headers ?? (typeof input === "object" ? input.headers : undefined));
    const cookie = hdrs.get("cookie");
    if (cookie) cookies.push(cookie);
    return real(input, init);
  }) as typeof fetch;
  try {
    const result = await fn();
    return { result, urls, cookies };
  } finally {
    globalThis.fetch = real;
  }
}

function assertTokenOnly(urls: string[], cookies: string[]): void {
  expect(urls.some((u) => u.includes("otter.ai"))).toBe(false);
  expect(cookies).toEqual([]);
  for (const u of urls) expect(u.startsWith(node)).toBe(true);
}

describe("OtterViaOauth3 — token-only (delegated, no Otter cookie)", () => {
  test("with a scoped token in hand, scan/pull go only through the OAuth3 instance", async () => {
    const src = new OtterViaOauth3(node, { token: "scoped-read-token" });

    const { result: speeches, urls, cookies } = await withFetchSpy(() => src.listAllSpeeches());
    expect(speeches.map((s) => s.otid)).toEqual(["OAAA", "OBBB"]);
    expect(speeches[0]!.title).toBe("Owned Meeting");
    expect(speeches[0]!.start_time).toBe(1700000000);
    expect(speeches[0]!.hasPhotos).toBe(0);
    expect(speeches[0]!.live_status).toBe("ended");

    const txt = await withFetchSpy(() => src.exportTxt("OAAA"));
    expect(txt.result).toContain("Hello everyone.");

    assertTokenOnly([...urls, ...txt.urls], [...cookies, ...txt.cookies]);
    // the token, not a cookie, is the credential the instance receives
    expect(authSeen).toContain("Bearer scoped-read-token");
  });

  test("user() reports it holds a scoped token, not a cookie", async () => {
    const src = new OtterViaOauth3(node, { token: "scoped-read-token" });
    const u = await src.user();
    expect(u.via).toBe("oauth3");
    expect(String(u.note)).toContain("no Otter cookie");
  });

  test("without a token, connect() handshake yields one — still no otter.ai / cookie", async () => {
    approveRequests = 0;
    authSeen = [];
    const src = new OtterViaOauth3(node, {}); // no token: must run the handshake
    const { result: speeches, urls, cookies } = await withFetchSpy(() => src.listAllSpeeches());
    expect(speeches.map((s) => s.otid)).toEqual(["OAAA", "OBBB"]);
    expect(approveRequests).toBe(1); // handshake ran
    assertTokenOnly(urls, cookies);
    // after approval the instance receives the approval-minted token as a bearer
    expect(authSeen).toContain("Bearer scoped-token-from-approval");
  });
});
