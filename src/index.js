// Cloudflare Worker: Instagram webhook (/webhook) + admin GUI (/, Basic auth). State lives in D1 (schema.sql).
import ADMIN_HTML from "./admin.html";
import { cleanRule, handle, sendDue, RateLimited } from "./logic.js";

const BASE = "https://graph.instagram.com/v23.0";
const KEEP_MS = 30 * 864e5; // privacy policy: delivery log kept up to 30 days
const enc = s => new TextEncoder().encode(s);
const LIMIT_CODES = [4, 17, 32, 613]; // Meta "too many calls" error codes (80000-80099 too)

const api = token => async (method, path, body, params = {}) => {
  const url = `${BASE}/${path}?` + new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) {
    const text = await r.text();
    console.log(`API ${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
    let code;
    try { code = JSON.parse(text).error?.code; } catch {}
    if (r.status === 429 || LIMIT_CODES.includes(code) || (code >= 80000 && code < 80100)) throw new RateLimited();
    return null;
  }
  return r.json();
};

let accountsCache; // per isolate; {user_id: {id, username, picture, call}}
async function accounts(env) {
  if (accountsCache) return accountsCache;
  const names = (env.AUTODM_EXTRA || "").split(",").map(s => s.trim()).filter(Boolean);
  const tokens = [env.IG_ACCESS_TOKEN, ...names.map(n => env[`IG_ACCESS_TOKEN_${n}`])].filter(Boolean);
  const out = {};
  let ok = true;
  for (const token of tokens) {
    const call = api(token);
    const me = await call("GET", "me", undefined, { fields: "user_id,username,profile_picture_url" });
    // one expired token must not stop the other accounts; retry it on the next request
    if (!me?.user_id) { ok = false; console.log("token check failed for an account, skipped"); continue; }
    out[me.user_id] = { id: me.user_id, username: me.username || "", picture: me.profile_picture_url || "", call };
  }
  if (ok) accountsCache = out;
  return out;
}

const d1Store = db => ({
  async rules(acct) {
    const row = await db.prepare("SELECT json FROM rules WHERE account = ?").bind(acct).first();
    return row ? JSON.parse(row.json) : [];
  },
  setRules: (acct, rules) => db.prepare("INSERT INTO rules VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET json = excluded.json")
    .bind(acct, JSON.stringify(rules)).run(),
  async once(key) {
    const r = await db.prepare("INSERT OR IGNORE INTO seen VALUES (?, ?)").bind(key, Date.now()).run();
    return r.meta.changes === 1;
  },
  // each method below is one D1 round trip (batch), to stay under the free plan's 50 subrequests per run
  async seenMany(keys) {
    const parts = [];
    for (let i = 0; i < keys.length; i += 90) parts.push(keys.slice(i, i + 90)); // D1: at most 100 bound parameters
    if (!parts.length) return new Set();
    const res = await db.batch(parts.map(p => db.prepare(`SELECT key FROM seen WHERE key IN (${p.map(() => "?").join()})`).bind(...p)));
    return new Set(res.flatMap(r => r.results.map(x => x.key)));
  },
  async claim(keys) { // returns the keys that were not taken yet
    if (!keys.length) return new Set();
    const now = Date.now(), res = await db.batch(keys.map(k => db.prepare("INSERT OR IGNORE INTO seen VALUES (?, ?)").bind(k, now)));
    return new Set(keys.filter((k, i) => res[i].meta.changes === 1));
  },
  async retryList(acct, n, since) {
    return (await db.prepare("SELECT cid, rule_id FROM retry WHERE account = ? AND at > ? ORDER BY at LIMIT ?").bind(acct, since, n).all()).results;
  },
  async commit({ bumps = [], retryAdd = [], retryDel = [], done = [] }) {
    const now = Date.now(), q = [
      ...bumps.map(([id, k]) => db.prepare("INSERT INTO stats VALUES (?, ?, 1) ON CONFLICT(rule_id, key) DO UPDATE SET n = n + 1").bind(id, k)),
      ...retryAdd.map(([a, id, cid]) => db.prepare("INSERT OR REPLACE INTO retry VALUES (?, ?, ?, ?)").bind(cid, a, id, now)),
      ...retryDel.map(cid => db.prepare("DELETE FROM retry WHERE cid = ?").bind(cid)),
      ...done.map(k => db.prepare("INSERT OR IGNORE INTO seen VALUES (?, ?)").bind(k, now))];
    if (q.length) await db.batch(q);
  },
  bump: (ruleId, key) => db.prepare("INSERT INTO stats VALUES (?, ?, 1) ON CONFLICT(rule_id, key) DO UPDATE SET n = n + 1")
    .bind(ruleId, key).run(),
  async snapshot() {
    const [rules, stats] = await db.batch([db.prepare("SELECT * FROM rules"), db.prepare("SELECT * FROM stats")]);
    const out = { rules: {}, stats: {} };
    for (const r of rules.results) out.rules[r.account] = JSON.parse(r.json);
    for (const s of stats.results) (out.stats[s.rule_id] ||= {})[s.key] = s.n;
    return out;
  },
});

async function validSignature(secret, body, header) {
  const hex = (header || "").replace(/^sha256=/, "");
  if (!secret || !/^[0-9a-f]{64}$/.test(hex)) return false;
  const key = await crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, Uint8Array.from(hex.match(/../g), h => parseInt(h, 16)), body);
}

async function route(env, payload) {
  const store = d1Store(env.DB);
  const accts = await accounts(env);
  for (const entry of payload.entry || []) {
    const acct = accts[entry.id];
    if (acct) await handle(entry, acct, store);
  }
  await env.DB.batch([env.DB.prepare("DELETE FROM seen WHERE at < ?").bind(Date.now() - KEEP_MS),
    env.DB.prepare("DELETE FROM retry WHERE at < ?").bind(Date.now() - 7 * 864e5)]);
}

async function authed(request, env) {
  const [scheme, b64] = (request.headers.get("Authorization") || "").split(" ");
  if (scheme !== "Basic" || !b64 || !env.ADMIN_PASSWORD) return false;
  let pass;
  try { pass = atob(b64).split(":").slice(1).join(":"); } catch { return false; }
  const [a, b] = await Promise.all([pass, env.ADMIN_PASSWORD].map(s => crypto.subtle.digest("SHA-256", enc(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function admin(request, env, url) {
  if (!await authed(request, env)) {
    return new Response("login required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="autodm", charset="UTF-8"' } });
  }
  const store = d1Store(env.DB);
  if (request.method === "GET") {
    if (url.pathname === "/") return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    if (url.pathname === "/api/state") {
      const accts = Object.values(await accounts(env)).map(({ id, username, picture }) => ({ id, username, picture }));
      return json({ accounts: accts, ...await store.snapshot() });
    }
    const acct = (await accounts(env))[url.searchParams.get("account")];
    if (url.pathname === "/api/media" && acct) {
      const res = await acct.call("GET", "me/media", undefined, { limit: 30,
        fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count" });
      return json(res?.data || [], res ? 200 : 502);
    }
    return json({ error: "not found" }, 404);
  }
  // cross-site guard: same origin only, JSON only (forces a CORS preflight)
  const origin = request.headers.get("Origin");
  if (request.method !== "POST" || (origin && origin !== url.origin)
      || (request.headers.get("Content-Type") || "").split(";")[0] !== "application/json") return json({ error: "forbidden" }, 403);
  if (url.pathname !== "/api/rules") return json({ error: "not found" }, 404);
  let acct, rules;
  try {
    const body = await request.json();
    acct = String(body.account);
    rules = body.rules.map(cleanRule);
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!(acct in await accounts(env))) return json({ error: "unknown account" }, 400);
  await store.setRules(acct, rules);
  return json({ rules });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/webhook") {
      if (request.method === "GET") {
        const ok = url.searchParams.get("hub.verify_token") === env.AUTODM_VERIFY_TOKEN;
        return new Response(ok ? url.searchParams.get("hub.challenge") || "" : "no", { status: ok ? 200 : 403 });
      }
      const body = await request.arrayBuffer();
      if (!await validSignature(env.IG_APP_SECRET, body, request.headers.get("X-Hub-Signature-256"))) {
        console.log("bad signature, dropped");
        return new Response("forbidden", { status: 403 });
      }
      ctx.waitUntil(route(env, JSON.parse(new TextDecoder().decode(body))));
      return new Response("ok");
    }
    return admin(request, env, url);
  },
  async scheduled(event, env) {
    const store = d1Store(env.DB), list = Object.values(await accounts(env));
    // free plan: 50 subrequests per run fit one busy account, so stop after the first one that sent; rotate who goes first
    const start = Math.floor(event.scheduledTime / 6e4);
    for (let i = 0; i < list.length; i++) if (await sendDue(list[(start + i) % list.length], store)) break;
  },
};
