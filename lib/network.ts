import { FieldValue } from "firebase-admin/firestore";
import { GrammyError, type Api } from "grammy";
import { notifyAdmins, botUsername } from "./botInstance";
import { apiFor } from "./bots";
import { chatsCol, withChatDefaults, type ChatDoc } from "./chats";
import { getConfig, type AppConfig } from "./config";
import { getDb } from "./firebase";
import { sendToUser } from "./notify";
import { incStats } from "./stats";
import { credit, dayKey, round, usersCol, withDefaults } from "./users";

export type BonusRule = { mode: "fixed" | "per1000"; amount: number; min: number; max: number };
export type TargetSpec = {
  mode: "ids" | "filter" | "all";
  ids?: number[]; minMembers?: number; types?: string[]; tags?: string[]; exclude?: number[];
};
export type CampaignDoc = {
  id: string; title: string; text: string; photoUrl: string | null;
  buttons: { text: string; url: string }[]; pin: boolean; deleteAfterHours: number; releaseAfterHours: number;
  bonus: BonusRule; target: TargetSpec; status: "pending_approval" | "scheduled" | "running" | "done" | "cancelled";
  scheduledAt: number | null; createdBy: number; createdAt: number; approvedBy: number | null;
  queue: number[]; resumeAt: number;
  totals: { targets: number; sent: number; failed: number; bonusPromised: number; bonusPaid: number; starts: number; verified: number };
};

const campaigns = () => getDb().collection("net_campaigns");
const deliveries = () => getDb().collection("net_deliveries");

export function calcBonus(rule: BonusRule, members: number) {
  if (!(rule.amount > 0)) return 0;
  let b = rule.mode === "fixed" ? rule.amount : (rule.amount * members) / 1000;
  if (rule.max > 0) b = Math.min(b, rule.max);
  b = Math.max(b, rule.min || 0);
  return round(b);
}

export function isEligible(c: ChatDoc, spec: TargetSpec, cfg: AppConfig, today = dayKey(Date.now())) {
  if (c.status !== "active" || !c.botAdmin || !c.ads.enabled || c.blacklisted) return false;
  if (c.type === "channel" && !c.rights.canPost) return false;
  if (c.memberCount < Math.max(spec.minMembers ?? 0, cfg.network.minMembers)) return false;
  if (spec.types?.length && !spec.types.includes(c.type)) return false;
  if (spec.tags?.length && !spec.tags.some((t) => c.tags.includes(t))) return false;
  if (spec.exclude?.includes(c.id)) return false;
  if (spec.mode === "ids" && !spec.ids?.includes(c.id)) return false;
  const postsToday = c.ads.postsDay === today ? c.ads.postsToday : 0;
  return postsToday < c.ads.maxPerDay;
}

/** Chats that can be posted to right now. Owners must be verified, unbanned users. */
export async function resolveTargets(spec: TargetSpec) {
  const cfg = await getConfig();
  const snap = await chatsCol().where("status", "==", "active").where("ads.enabled", "==", true).limit(3000).get();
  const list = snap.docs.map((d) => withChatDefaults(d.data())).filter((c) => isEligible(c, spec, cfg));
  const ownerIds = [...new Set(list.map((c) => c.ownerId).filter((x): x is number => !!x))];
  const ok = new Set<number>();
  for (let i = 0; i < ownerIds.length; i += 300) {
    const docs = await getDb().getAll(...ownerIds.slice(i, i + 300).map((id) => usersCol().doc(String(id))));
    docs.forEach((d) => { if (d.exists) { const u = withDefaults(d.data()); if (u.verified && !u.banned) ok.add(u.id); } });
  }
  return list.filter((c) => c.ownerId && ok.has(c.ownerId));
}

export async function estimate(spec: TargetSpec, rule: BonusRule) {
  const list = await resolveTargets(spec);
  const total = round(list.reduce((s, c) => s + calcBonus(rule, c.memberCount), 0));
  return { count: list.length, totalBonus: total, members: list.reduce((s, c) => s + c.memberCount, 0), sample: list.slice(0, 5).map((c) => c.title) };
}

export type NewCampaign = {
  title: string; text: string; photoUrl?: string | null; buttons: { text: string; url: string }[]; pin: boolean;
  deleteAfterHours: number; releaseAfterHours: number; bonus: BonusRule; target: TargetSpec; scheduledAt?: number | null;
};

export async function createCampaign(adminId: number, n: NewCampaign) {
  const cfg = await getConfig();
  if (!n.text.trim() || n.text.length > 3500) throw new Error("Message must be 1-3500 characters.");
  if (!n.buttons.length) throw new Error("Add at least one button (use {BOT} to link to the bot with tracking).");
  for (const b of n.buttons) {
    if (!b.text.trim() || !(b.url === "{BOT}" || /^https:\/\/\S+$/.test(b.url))) throw new Error("Buttons need a label and an https:// link (or {BOT}).");
  }
  const scheduled = n.scheduledAt && n.scheduledAt > Date.now() + 30_000 ? n.scheduledAt : null;
  const queue = scheduled ? [] : (await resolveTargets(n.target)).map((c) => c.id);
  const est = scheduled ? null : await estimate(n.target, n.bonus);
  const needsApproval = !!est && est.totalBonus > cfg.network.approvalAbove;

  const ref = campaigns().doc();
  const doc: CampaignDoc = {
    id: ref.id, title: n.title.slice(0, 80) || "Campaign", text: n.text, photoUrl: n.photoUrl || null, buttons: n.buttons,
    pin: !!n.pin, deleteAfterHours: n.deleteAfterHours, releaseAfterHours: n.releaseAfterHours, bonus: n.bonus, target: n.target,
    status: scheduled ? "scheduled" : needsApproval ? "pending_approval" : "running", scheduledAt: scheduled,
    createdBy: adminId, createdAt: Date.now(), approvedBy: null, queue, resumeAt: 0,
    totals: { targets: queue.length, sent: 0, failed: 0, bonusPromised: est?.totalBonus ?? 0, bonusPaid: 0, starts: 0, verified: 0 },
  };
  await ref.set(doc);
  return { id: ref.id, status: doc.status, count: queue.length, totalBonus: est?.totalBonus ?? 0 };
}

export async function approveCampaign(id: string, adminId: number) {
  const ref = campaigns().doc(id);
  const s = await ref.get();
  if (!s.exists) throw new Error("Campaign not found.");
  const c = s.data() as CampaignDoc;
  if (c.status !== "pending_approval") throw new Error("This campaign doesn't need approval.");
  if (c.createdBy === adminId) throw new Error("Another super admin must approve it.");
  await ref.update({ status: "running", approvedBy: adminId });
}

export async function cancelCampaign(id: string) {
  await campaigns().doc(id).update({ status: "cancelled", queue: [] });
}

/** Scheduled campaigns that are due: resolve their audience and start them. */
export async function startDue() {
  const snap = await campaigns().where("status", "==", "scheduled").limit(20).get();
  const cfg = await getConfig();
  for (const d of snap.docs) {
    const c = d.data() as CampaignDoc;
    if (!c.scheduledAt || c.scheduledAt > Date.now()) continue;
    const queue = (await resolveTargets(c.target)).map((x) => x.id);
    const est = await estimate(c.target, c.bonus);
    await d.ref.update({
      queue, status: est.totalBonus > cfg.network.approvalAbove ? "pending_approval" : "running",
      "totals.targets": queue.length, "totals.bonusPromised": est.totalBonus,
    });
  }
}

const buildMarkup = (c: CampaignDoc, botUser: string, deliveryId: string) => ({
  inline_keyboard: c.buttons.map((b) => [{
    text: b.text,
    url: b.url === "{BOT}" ? `https://t.me/${botUser}?start=net_${deliveryId}` : b.url,
  }]),
});

async function sendOne(c: CampaignDoc, chat: ChatDoc, cfg: AppConfig) {
  const api = await apiFor(chat.botId);
  const botUser = await botUsername(chat.botId);
  const dRef = deliveries().doc();
  const markup = buildMarkup(c, botUser, dRef.id);
  const text = `${cfg.network.sponsoredLabel}\n\n${c.text}`;
  const sent = c.photoUrl
    ? await api.sendPhoto(chat.id, c.photoUrl, { caption: text.slice(0, 1024), reply_markup: markup })
    : await api.sendMessage(chat.id, text, { reply_markup: markup, link_preview_options: { is_disabled: true } });
  if (c.pin && chat.rights.canPin) await api.pinChatMessage(chat.id, sent.message_id, { disable_notification: true }).catch(() => {});

  const now = Date.now();
  const bonus = calcBonus(c.bonus, chat.memberCount);
  await dRef.set({
    id: dRef.id, campaignId: c.id, chatId: chat.id, botId: chat.botId, ownerId: chat.ownerId, messageId: sent.message_id,
    kind: c.photoUrl ? "photo" : "text", markup, status: "sent", bonus, sentAt: now,
    releaseAt: now + c.releaseAfterHours * 3_600_000,
    ...(c.deleteAfterHours > 0 ? { deleteAt: now + c.deleteAfterHours * 3_600_000 } : {}),
    starts: 0, verified: 0,
  });
  const today = dayKey(now);
  await chatsCol().doc(String(chat.id)).update({
    "ads.lastPostAt": now, "ads.postsDay": today,
    "ads.postsToday": chat.ads.postsDay === today ? chat.ads.postsToday + 1 : 1,
  });
}

/** Sends queued posts until the deadline. Returns true when the campaign finished. */
export async function runCampaign(id: string, deadline: number): Promise<boolean> {
  const cfg = await getConfig();
  const ref = campaigns().doc(id);
  const snap = await ref.get();
  if (!snap.exists) return true;
  let c = snap.data() as CampaignDoc;
  if (c.status !== "running") return true;
  if (c.resumeAt > Date.now()) return false;

  let queue = [...c.queue];
  let sent = 0, failed = 0, rateLimited = 0;

  while (queue.length && Date.now() < deadline - 2500) {
    const batch = queue.splice(0, 20);
    const started = Date.now();
    await Promise.all(batch.map(async (chatId) => {
      const docSnap = await chatsCol().doc(String(chatId)).get();
      if (!docSnap.exists) { failed++; return; }
      const chat = withChatDefaults(docSnap.data());
      if (!isEligible(chat, { ...c.target, mode: "all" }, cfg)) { failed++; return; }
      try {
        await sendOne(c, chat, cfg);
        sent++;
      } catch (e) {
        if (e instanceof GrammyError && e.error_code === 429) {
          rateLimited = Math.max(rateLimited, e.parameters?.retry_after ?? 10);
          queue.push(chatId);
        } else {
          failed++;
          const msg = String((e as Error).message);
          if (/chat not found|kicked|forbidden|not enough rights|have no rights/i.test(msg)) {
            await chatsCol().doc(String(chatId)).update({ botAdmin: false, updatedAt: Date.now() }).catch(() => {});
          }
        }
      }
    }));
    if (rateLimited) break;
    const wait = 1000 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  const done = queue.length === 0;
  await ref.update({
    queue, status: done ? "done" : "running", resumeAt: rateLimited ? Date.now() + rateLimited * 1000 : 0,
    "totals.sent": FieldValue.increment(sent), "totals.failed": FieldValue.increment(failed),
  });
  if (done) {
    c = (await ref.get()).data() as CampaignDoc;
    await notifyAdmins(`📡 Network campaign "${c.title}" finished. Sent ${c.totals.sent}, failed ${c.totals.failed}. Promised bonus: ${c.totals.bonusPromised}.`);
  }
  return done;
}

export async function runningCampaigns() {
  const s = await campaigns().where("status", "==", "running").limit(5).get();
  return s.docs.map((d) => d.id);
}

/* ---------- bonus release & cleanup ---------- */

type Delivery = {
  id: string; campaignId: string; chatId: number; botId: string; ownerId: number | null; messageId: number;
  kind: string; markup: Record<string, unknown>; bonus: number;
};

/** A cheap "does this message still exist?" probe: re-applying the same markup says "not modified" if it exists. */
async function messageExists(api: Api, d: Delivery) {
  try {
    await api.editMessageReplyMarkup(d.chatId, d.messageId, { reply_markup: d.markup as never });
    return true;
  } catch (e) {
    const msg = String((e as Error).message);
    if (/not modified/i.test(msg)) return true;
    if (/message to edit not found|MESSAGE_ID_INVALID|message can't be edited|chat not found/i.test(msg)) return false;
    return true; // unknown error: don't punish the owner
  }
}

export async function releaseBonuses(deadline: number) {
  const cfg = await getConfig();
  const snap = await deliveries().where("releaseAt", "<=", Date.now()).limit(60).get();
  let n = 0;
  for (const doc of snap.docs) {
    if (Date.now() > deadline) break;
    const d = doc.data() as Delivery & { campaignId: string };
    const chatDoc = await chatsCol().doc(String(d.chatId)).get();
    const chat = chatDoc.exists ? withChatDefaults(chatDoc.data()) : null;
    const api = await apiFor(d.botId);
    const alive = chat && chat.status === "active" && chat.botAdmin && (await messageExists(api, d));

    let paid = 0;
    if (alive && d.bonus > 0 && d.ownerId) {
      const day = dayKey(Date.now());
      const capRef = getDb().collection("net_owner_day").doc(`${d.ownerId}_${day}`);
      const used = ((await capRef.get()).data()?.amount as number) || 0;
      paid = Math.max(0, Math.min(d.bonus, cfg.network.maxBonusPerOwnerPerDay - used));
      if (paid > 0) {
        try {
          await credit(d.ownerId, paid, "network_bonus", { campaignId: d.campaignId, chatId: d.chatId });
          await capRef.set({ amount: FieldValue.increment(paid) }, { merge: true });
          await chatsCol().doc(String(d.chatId)).update({ earned: FieldValue.increment(paid) });
          void incStats({ networkBonus: paid });
          const owner = await usersCol().doc(String(d.ownerId)).get();
          if (owner.exists && withDefaults(owner.data()).notif.news) {
            await sendToUser(d.ownerId, `💰 +${paid} ${cfg.currency} for the sponsored post in ${chat?.title ?? "your chat"}.`);
          }
        } catch (e) {
          console.error("network bonus credit failed", e);
          paid = 0;
        }
      }
    }
    await doc.ref.update({
      status: alive ? "released" : "forfeited", paid, releaseAt: FieldValue.delete(), releasedAt: Date.now(),
    });
    if (paid > 0) await campaigns().doc(d.campaignId).update({ "totals.bonusPaid": FieldValue.increment(paid) }).catch(() => {});
    n++;
  }
  return { processed: n, more: snap.size >= 60 };
}

export async function deleteDue(deadline: number) {
  const snap = await deliveries().where("deleteAt", "<=", Date.now()).limit(60).get();
  for (const doc of snap.docs) {
    if (Date.now() > deadline) break;
    const d = doc.data() as Delivery;
    const api = await apiFor(d.botId);
    await api.deleteMessage(d.chatId, d.messageId).catch(() => {});
    await doc.ref.update({ deleteAt: FieldValue.delete(), deletedAt: Date.now() });
  }
}

export async function runScheduledDeletes(deadline: number) {
  const snap = await getDb().collection("scheduled_deletes").where("at", "<=", Date.now()).limit(100).get();
  for (const doc of snap.docs) {
    if (Date.now() > deadline) break;
    const d = doc.data() as { botId: string; chatId: number; messageId: number };
    await (await apiFor(d.botId)).deleteMessage(d.chatId, d.messageId).catch(() => {});
    await doc.ref.delete();
  }
}

/** A user started the bot from a tracked post. */
export async function netStart(deliveryId: string, verified = false) {
  try {
    const ref = deliveries().doc(deliveryId);
    const s = await ref.get();
    if (!s.exists) return;
    const d = s.data() as { campaignId: string; chatId: number };
    const f = verified ? "verified" : "starts";
    await ref.update({ [f]: FieldValue.increment(1) });
    await campaigns().doc(d.campaignId).update({ [`totals.${f}`]: FieldValue.increment(1) });
    await chatsCol().doc(String(d.chatId)).update({ [f]: FieldValue.increment(1) }).catch(() => {});
  } catch (e) {
    console.error("netStart", e);
  }
}
