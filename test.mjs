// node test.mjs — offline check of the flow
import assert from "node:assert/strict";
import { button, cleanRule, handle, sendDue, RateLimited, PER_MINUTE, DEFAULT_ASK } from "./src/logic.js";

const calls = [];
const call = async (method, path, body, params) => { calls.push({ method, path, body, params }); return { is_user_follow_business: path === "fan" }; };
const rules = {}, stats = {}, seen = new Set(), retry = new Map();
const bump = (id, k) => { (stats[id] ||= {})[k] = (stats[id][k] || 0) + 1; };
const store = {
  rules: async a => structuredClone(rules[a] || []),
  setRules: async (a, r) => { rules[a] = structuredClone(r); },
  once: async k => !seen.has(k) && !!seen.add(k),
  bump: async (id, k) => bump(id, k),
  seenMany: async keys => new Set(keys.filter(k => seen.has(k))),
  claim: async keys => new Set(keys.filter(k => !seen.has(k) && seen.add(k))),
  retryList: async (a, n) => [...retry.values()].filter(x => x.account === a).slice(0, n),
  commit: async ({ bumps = [], retryAdd = [], retryDel = [], done = [] }) => {
    bumps.forEach(([id, k]) => bump(id, k));
    retryAdd.forEach(([account, rule_id, cid]) => retry.set(cid, { account, rule_id, cid }));
    retryDel.forEach(cid => retry.delete(cid));
    done.forEach(k => seen.add(k));
  },
};
rules.ME = [
  cleanRule({ id: "post", media_id: "M1", keywords: ["링크"], link_text: "LINK", follow_text: "FOLLOW",
    link_buttons: [{ title: "장난감 추천", url: "https://example.com/a" }, { title: "블로그", url: "https://example.com/b" }] }),
  cleanRule({ id: "all", keywords: ["정보"], require_follow: false, link_text: "DIRECT" }),
  cleanRule({ id: "off", enabled: false, keywords: [] }),
];
const ME = { id: "ME", username: "me", call };
const comment = (cid, who, text = "링크 주세요", media = "M1") => ({ changes: [{ field: "comments", value: { id: cid, from: { id: who }, text, media: { id: media } } }] });
const postback = (who, mid) => ({ messaging: [{ sender: { id: who }, postback: { payload: "CHECK:post", mid } }] });

await handle(comment("c1", "ME"), ME, store);
await handle(comment("c2", "u1", "예뻐요"), ME, store);
await handle(comment("c3", "u1", "링크", "M2"), ME, store);
assert.equal(calls.length, 0, "own comment, no keyword, other post, disabled rule: no DM");
await handle(comment("c1", "u1"), ME, store);
await handle(comment("c1", "u1"), ME, store);
assert.equal(calls.length, 1, "one private reply per comment");
assert.deepEqual(calls[0].body, { recipient: { comment_id: "c1" }, message: button(DEFAULT_ASK, "CHECK:post") });
calls.length = 0;
await handle(comment("c4", "u1", "정보 주세요", "M2"), ME, store);
assert.deepEqual(calls[0].body.message, { text: "DIRECT" }, "no-follow rule sends link right away");
calls.length = 0;
await handle(postback("fan", "m1"), ME, store);
await handle(postback("fan", "m1"), ME, store);
assert.equal(calls.length, 2);
assert.deepEqual(calls[1].body.message.attachment.payload, { template_type: "button", text: "LINK", buttons: [
  { type: "web_url", url: "https://example.com/a", title: "장난감 추천" },
  { type: "web_url", url: "https://example.com/b", title: "블로그" }] }, "follower gets link buttons once");
calls.length = 0;
await handle(postback("stranger", "m2"), ME, store);
assert.deepEqual(calls[1].body.message, button("FOLLOW", "CHECK:post"), "non-follower gets follow prompt");
assert.deepEqual(stats, { post: { sent: 1, checks: 2, links: 1 }, all: { sent: 1, links: 1 } });
assert.deepEqual(Object.keys(cleanRule({ keywords: [" a ", "", 3], evil: 1 })), Object.keys(cleanRule({})));
assert.deepEqual(cleanRule({ link_buttons: [{ url: "javascript:alert(1)" }] }).link_buttons, [], "only http(s) links");
assert.equal(cleanRule({ link_buttons: Array(5).fill({ url: "https://a" }) }).link_buttons.length, 3, "max 3 buttons");
calls.length = 0;
rules.ME.push(cleanRule({ id: "rep", keywords: ["답글"], require_follow: false, comment_reply: true, reply_texts: ["고마워요"] }));
await handle(comment("c5", "u1", "답글 주세요", "M2"), ME, store);
assert.deepEqual(calls.map(c => [c.path, c.body.message?.text ?? c.body.message]), [["me/messages", rules.ME[3].link_text], ["c5/replies", "고마워요"]], "DM then public reply");
assert.equal(cleanRule({}).comment_reply, false, "reply is off by default");
assert.ok(cleanRule({}).reply_texts.length > 1, "default reply texts");
assert.deepEqual(cleanRule({ link_url: "https://old", link_title: "옛날" }).link_buttons, [{ title: "옛날", url: "https://old" }]);

// scheduled / bulk / next post
const T = Date.parse("2026-10-20T00:00:00Z"), H = 36e5, iso = t => new Date(t).toISOString();
const api = {}; // path -> response
const call2 = async (method, path, body, params) => { calls.push({ method, path, body, params }); return api[path] ?? { ok: 1 }; };
const ME2 = { id: "ME2", username: "me2", call: call2 };
const cm = (id, t, who, text = "받을게요") => ({ id, timestamp: iso(t).replace(".000Z", "+0000"), from: { id: who, username: who }, text });
api["M9/comments"] = { data: [cm("k5", T + 2 * H, "u7"), cm("k4", T - H, "u6"), cm("k3", T - H, "ME2"), cm("k2", T - 2 * H, "u5"),
  cm("k1", T - 3 * H, "u5"), cm("k0", T - 8 * 24 * H, "u4"), cm("kx", T - H, "u8", "아니요")], paging: { cursors: {} } };
rules.ME2 = [cleanRule({ id: "bulk", media_id: "M9", keywords: ["받을"], require_follow: false, send_mode: "bulk", armed_at: iso(T) })];
calls.length = 0;
await handle(comment("k9", "u9", "받을게요", "M9"), ME2, store);
assert.equal(calls.length, 0, "webhook ignores bulk rules");
await sendDue(ME2, store, T + 60e3);
assert.deepEqual(calls.filter(c => c.method === "POST").map(c => c.body.recipient.comment_id), ["k1", "k4"],
  "bulk: last 7 days before saving, oldest first, one per person, skips own/old/later/no-keyword");
calls.length = 0;
await sendDue(ME2, store, T + 120e3);
assert.equal(calls.length, 0, "bulk runs once");

rules.ME2 = [cleanRule({ id: "sch", media_id: "M9", keywords: ["받을"], require_follow: false, send_mode: "scheduled", armed_at: iso(T - 2.5 * H), send_at: iso(T + 3 * H) })];
calls.length = 0;
await sendDue(ME2, store, T + 2 * H);
assert.equal(calls.length, 0, "scheduled waits for its time");
await sendDue(ME2, store, T + 3 * H);
assert.deepEqual(calls.filter(c => c.method === "POST").map(c => c.body.recipient.comment_id), ["k2", "k5"], "scheduled: comments after saving, until send time");

api["me/media"] = { data: [{ id: "P3", timestamp: iso(T + 2 * H) }, { id: "P2", timestamp: iso(T + H) }, { id: "P1", timestamp: iso(T - H) }] };
rules.ME2 = [cleanRule({ id: "nxt", media_id: "next", require_follow: false, armed_at: iso(T) })];
calls.length = 0;
await handle(comment("n1", "u1", "hi", "P1"), ME2, store);
assert.equal(rules.ME2[0].media_id, "P2", "next binds to the first post after saving");
assert.equal(calls.filter(c => c.method === "POST").length, 0, "comment on an older post is ignored");
await handle(comment("n2", "u1", "hi", "P2"), ME2, store);
assert.equal(calls.filter(c => c.method === "POST").length, 1, "comment on the bound post gets a DM");
assert.equal(cleanRule({}).send_mode, "instant");

// rate limit: stop, queue the rest, send them next minute
let limitAfter = Infinity;
const call3 = async (method, path, body, params) => {
  calls.push({ method, path, body, params });
  if (path === "me/messages" && limitAfter-- <= 0) throw new RateLimited();
  return api[path] ?? { ok: 1 };
};
const ME3 = { id: "ME3", username: "me3", call: call3 };
api["M8/comments"] = { data: Array.from({ length: 15 }, (_, i) => cm("r" + i, T - (i + 1) * 60e3, "p" + i)) };
rules.ME3 = [cleanRule({ id: "big", media_id: "M8", require_follow: false, send_mode: "bulk", armed_at: iso(T) })];
const sentTo = () => calls.filter(c => c.path === "me/messages").map(c => c.body.recipient.comment_id);
calls.length = 0; limitAfter = 5;
assert.equal(await sendDue(ME3, store, T + 60e3), PER_MINUTE, "12 per minute");
assert.equal(sentTo().length, 6, "5 sent, 6th hit the limit");
assert.equal(retry.size, 7, "the limited one and the 6 not tried yet are queued");
calls.length = 0; limitAfter = Infinity;
await sendDue(ME3, store, T + 120e3);
assert.equal(sentTo().length, 10, "next minute: 7 retries + 3 comments left over");
assert.equal(retry.size, 0);
calls.length = 0;
await sendDue(ME3, store, T + 180e3);
assert.equal(calls.length, 0, "all 15 done, nothing more");
assert.equal(stats.big.sent, 15);
rules.ME3 = [cleanRule({ id: "now", require_follow: false })];
calls.length = 0; limitAfter = 0;
await handle(comment("w1", "u1", "hi", "M1"), ME3, store);
assert.ok(retry.has("w1"), "instant DM that hit the limit is queued");
limitAfter = Infinity;
await sendDue(ME3, store, Date.now());
assert.ok(!retry.has("w1") && sentTo().length === 2, "and sent by the next cron run");
console.log("selftest ok");
