// Auto-DM flow: comment -> private reply (follow-check button) -> link DM.
export const CHECK = "CHECK";
export const DEFAULT_ASK = "아래 버튼을 눌러 팔로우 여부를 확인해주세요. 확인 후 요청하신 정보를 보내드립니다!";
export const DEFAULT_LINK = "안녕하세요!\n요청하신 정보를 공유해 드립니다! 아래 링크 참고해 주세요 :>";
export const DEFAULT_FOLLOW = "아직 팔로우가 확인되지 않았어요. 팔로우 후 다시 눌러주세요!";
export const DEFAULT_REPLIES = ["감사합니다! DM 보내드렸어요 😊", "DM 확인해 주세요! 💌", "DM으로 보내드렸어요! 확인 부탁드려요 🙌",
  "관심 가져주셔서 감사해요! DM 확인해 주세요 :)", "DM 보내드렸습니다! 좋은 하루 보내세요 ☺️"];

export const button = (text, payload) => ({ attachment: { type: "template", payload: {
  template_type: "button", text,
  buttons: [{ type: "postback", title: "팔로우 확인 🙌", payload }] } } });

// Link DM: text + up to 3 web_url buttons, plain text when there are none.
export function linkMessage(rule) {
  const buttons = rule.link_buttons || [];
  if (!buttons.length) return { text: rule.link_text };
  return { attachment: { type: "template", payload: {
    template_type: "button", text: rule.link_text,
    buttons: buttons.map(b => ({ type: "web_url", url: b.url, title: b.title })) } } };
}

const str = v => (v === undefined || v === null ? "" : String(v));

function cleanButtons(r) {
  let raw = r.link_buttons;
  if (raw == null && r.link_url) raw = [{ title: r.link_title, url: r.link_url }]; // older single-button rules
  const out = [];
  for (const b of Array.isArray(raw) ? raw : []) {
    const url = str(b?.url).trim().slice(0, 2000);
    if (/^https?:\/\//.test(url)) out.push({ title: str(b.title).trim().slice(0, 20) || "링크 열기", url }); // Meta: title <= 20 chars
  }
  return out.slice(0, 3); // Meta: at most 3 buttons
}

// Whitelist fields coming from the admin GUI.
export function cleanRule(r) {
  const text = (k, d) => (str(r[k]) || d).slice(0, 640); // Meta: button template text <= 640 chars
  return {
    id: (str(r.id) || crypto.randomUUID().replace(/-/g, "").slice(0, 8)).slice(0, 16),
    enabled: r.enabled === undefined ? true : Boolean(r.enabled),
    media_id: str(r.media_id), // "" = every post
    media_caption: str(r.media_caption).slice(0, 200),
    media_thumb: str(r.media_thumb).slice(0, 2000),
    keywords: (Array.isArray(r.keywords) ? r.keywords : []).map(k => str(k).trim().slice(0, 50)).filter(Boolean).slice(0, 30), // [] = every comment
    require_follow: r.require_follow === undefined ? true : Boolean(r.require_follow),
    ask_text: text("ask_text", DEFAULT_ASK),
    link_text: text("link_text", DEFAULT_LINK),
    follow_text: text("follow_text", DEFAULT_FOLLOW),
    link_buttons: cleanButtons(r),
    comment_reply: Boolean(r.comment_reply),
    // one is picked at random per comment, so the account doesn't post the same text over and over
    reply_texts: (Array.isArray(r.reply_texts) ? r.reply_texts : DEFAULT_REPLIES).map(t => str(t).trim().slice(0, 300)).filter(Boolean).slice(0, 30),
    send_mode: ["scheduled", "bulk"].includes(r.send_mode) ? r.send_mode : "instant",
    send_at: str(r.send_at).slice(0, 40), // scheduled: ISO time to send
    armed_at: str(r.armed_at).slice(0, 40) || new Date().toISOString(), // the GUI clears it when post/mode/time change
  };
}

const DAY = 864e5;
const hit = (r, text) => !r.keywords?.length || r.keywords.some(k => text.includes(k));
const isInstant = r => !r.send_mode || r.send_mode === "instant";

export function match(rules, mediaId, text) {
  // post-specific rules win over "every post" rules
  const ordered = [...rules].sort((a, b) => !a.media_id - !b.media_id);
  return ordered.find(r => r.enabled && (!r.media_id || r.media_id === mediaId) && hit(r, text)) || null;
}

// media_id "next": attach to the oldest post published after the rule was armed.
// ponytail: rewrites the whole rules row, a GUI save in the same instant can be overwritten
async function bindNext(acct, store, rules, waiting) {
  if (!waiting.length) return;
  const res = await acct.call("GET", "me/media", undefined, { fields: "id,caption,media_type,media_url,thumbnail_url,timestamp", limit: 10 });
  const posts = (res?.data || []).reverse(); // API lists newest first
  let changed = false;
  for (const r of waiting) {
    const m = posts.find(m => Date.parse(m.timestamp) > Date.parse(r.armed_at));
    if (!m) continue;
    Object.assign(r, { media_id: m.id, media_caption: (m.caption || "").slice(0, 200),
      media_thumb: (m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url) || "" });
    changed = true;
  }
  if (changed) await store.setRules(acct.id, rules);
}

// acct: {id, username, call(method, path, body, params)}; store: {rules, once, bump}
export async function handle(entry, acct, store) {
  for (const ch of entry.changes || []) {
    if (ch.field === "comments") await onComment(ch.value || {}, acct, store);
  }
  for (const m of entry.messaging || []) {
    const pb = m.postback || {};
    const [kind, ruleId = ""] = (pb.payload || "").split(":");
    // mid dedupe: the same event can arrive via several subscribed apps and Meta retries
    if (kind === CHECK && await store.once("p:" + (pb.mid || m.timestamp))) {
      // rate limited: the person can tap the button again
      await onCheck(m.sender.id, ruleId, acct, store).catch(e => { if (!(e instanceof RateLimited)) throw e; console.log(`[${acct.username}] rate limited, follow check dropped`); });
    }
  }
}

export class RateLimited extends Error {} // thrown by acct.call when Meta says "too many calls"
export const PER_MINUTE = 12; // 12/min = 720/hour, under Meta's 750 private replies/hour per account

async function onComment(v, acct, store) {
  const cid = v.id, author = v.from?.id;
  if (!cid || author === acct.id) return;
  const all = await store.rules(acct.id), live = all.filter(isInstant); // scheduled/bulk rules are sent by sendDue
  await bindNext(acct, store, all, live.filter(r => r.enabled && r.media_id === "next"));
  const rule = match(live, v.media?.id, v.text || "");
  if (!rule || !await store.once("c:" + cid)) return;
  console.log(`[${acct.username}] comment ${cid} by @${v.from?.username} -> rule ${rule.id}`);
  const res = await deliver(rule, cid, acct);
  if (res === "sent") await store.commit({ bumps: counts(rule) });
  if (res === "limited") await store.commit({ retryAdd: [[acct.id, rule.id, cid]] });
}

// "sent" | "failed" | "limited". Only the private reply decides; the public comment reply is best effort.
async function deliver(rule, cid, acct) {
  const msg = rule.require_follow ? button(rule.ask_text, `${CHECK}:${rule.id}`) : linkMessage(rule);
  try {
    if (!await acct.call("POST", "me/messages", { recipient: { comment_id: cid }, message: msg })) return "failed";
  } catch (e) {
    if (!(e instanceof RateLimited)) throw e;
    console.log(`[${acct.username}] rate limited, comment ${cid} will be retried`);
    return "limited";
  }
  const texts = rule.comment_reply ? rule.reply_texts || [] : [];
  if (texts.length) await acct.call("POST", `${cid}/replies`, { message: texts[Math.floor(Math.random() * texts.length)] }).catch(() => {});
  return "sent";
}
const counts = rule => (rule.require_follow ? ["sent"] : ["sent", "links"]).map(k => [rule.id, k]);

// Run every minute by the cron trigger: rate-limited retries first, then scheduled / bulk rules.
// Sends at most PER_MINUTE private replies; D1 work is batched so one run stays under the free plan's
// 50 subrequests. Returns how many sends were tried.
export async function sendDue(acct, store, now = Date.now(), budget = PER_MINUTE) {
  const oldest = now - 7 * DAY + 36e5; // private replies only work within 7 days of the comment
  const win = r => r.send_mode === "bulk" ? [Date.parse(r.armed_at) - 7 * DAY, Date.parse(r.armed_at)]
    : [Date.parse(r.armed_at), Date.parse(r.send_at)];
  const doneKey = r => `d:${r.id}:${r.armed_at}`;
  const rules = await store.rules(acct.id), byId = Object.fromEntries(rules.map(r => [r.id, r]));
  const out = { bumps: [], retryAdd: [], retryDel: [], done: [] };
  const jobs = []; // {rule, cid, retry}
  for (const x of await store.retryList(acct.id, budget, oldest)) {
    if (byId[x.rule_id]?.enabled) jobs.push({ rule: byId[x.rule_id], cid: x.cid, retry: true });
    else out.retryDel.push(x.cid); // rule was deleted or turned off
  }

  let due = rules.filter(r => r.enabled && !isInstant(r) && win(r)[1] <= now && win(r)[1] > oldest);
  const done = due.length ? await store.seenMany(due.map(doneKey)) : new Set();
  due = due.filter(r => !done.has(doneKey(r)));
  await bindNext(acct, store, rules, due.filter(r => r.media_id === "next"));
  for (const r of due) {
    if (r.media_id === "next" || !r.media_id || jobs.length >= budget) continue;
    const [from, to] = win(r), picked = [], uid = c => `u:${r.id}:${c.from?.id || c.id}`;
    let ok = true;
    // ponytail: reads at most 6 pages (300 comments) per post, add more pages if a post gets bigger
    for (let n = 0, after; n < 6; n++) {
      const page = await acct.call("GET", `${r.media_id}/comments`, undefined, { fields: "id,text,timestamp,from", limit: 50, ...(after && { after }) }).catch(() => null);
      if (!page) { ok = false; break; } // API error: try again next minute instead of marking done
      for (const c of page.data || []) {
        const t = Date.parse(c.timestamp);
        if (t >= Math.max(from, oldest) && t <= to && c.from?.id !== acct.id && hit(r, c.text || "")) picked.push(c);
      }
      if (!page.paging?.next) break;
      after = page.paging.cursors?.after;
    }
    const seen = await store.seenMany(picked.flatMap(c => ["c:" + c.id, uid(c)]));
    const fresh = [];
    for (const c of picked.reverse()) { // oldest first; one per comment, one per person for this rule
      if (seen.has("c:" + c.id) || seen.has(uid(c))) continue;
      seen.add(uid(c));
      fresh.push(c);
    }
    const take = fresh.slice(0, budget - jobs.length);
    const claimed = await store.claim(take.flatMap(c => ["c:" + c.id, uid(c)]));
    for (const c of take) if (claimed.has("c:" + c.id)) {
      console.log(`[${acct.username}] ${r.send_mode} comment ${c.id} by @${c.from?.username} -> rule ${r.id}`);
      jobs.push({ rule: r, cid: c.id });
    }
    if (ok && take.length === fresh.length) out.done.push(doneKey(r));
  }

  for (let i = 0; i < jobs.length; i++) {
    const { rule, cid, retry } = jobs[i];
    const res = await deliver(rule, cid, acct);
    if (res === "limited") { // stop now; this and the rest go to the retry queue
      for (const j of jobs.slice(i)) if (!j.retry) out.retryAdd.push([acct.id, j.rule.id, j.cid]);
      break;
    }
    if (res === "sent") out.bumps.push(...counts(rule));
    if (retry) out.retryDel.push(cid); // sent, or failed for good
  }
  await store.commit(out);
  return jobs.length;
}

async function onCheck(igsid, ruleId, acct, store) {
  const rule = (await store.rules(acct.id)).find(r => r.id === ruleId);
  if (!rule) return;
  const prof = await acct.call("GET", igsid, undefined, { fields: "is_user_follow_business" }) || {};
  const follows = prof.is_user_follow_business === true;
  console.log(`[${acct.username}] check ${igsid} follows=${follows}`);
  await store.bump(ruleId, "checks");
  const msg = follows ? linkMessage(rule) : button(rule.follow_text, `${CHECK}:${ruleId}`);
  if (await acct.call("POST", "me/messages", { recipient: { id: igsid }, message: msg }) && follows) await store.bump(ruleId, "links");
}
