import { InlineKeyboard, type Bot, type Context } from "grammy";
import { mainMenu } from "../ui";
import { approveProof, disputeProof, proofsCol, REJECT_REASONS, rejectProof, submitProof, type ProofDoc } from "../proofs";
import { setState } from "../state";
import type { UserState } from "../users";

/** Replace the promoter's proof message (a photo with a caption, or plain text) with a short result. */
async function finish(ctx: Context, text: string) {
  try { await ctx.editMessageCaption({ caption: text }); } catch {
    await ctx.editMessageText(text).catch(() => {});
  }
}

const mine = async (ctx: Context, id: string): Promise<ProofDoc | null> => {
  const s = await proofsCol().doc(id).get();
  const p = s.exists ? (s.data() as ProofDoc) : null;
  if (!p || p.ownerId !== ctx.from!.id) { await ctx.answerCallbackQuery({ text: "This isn't yours.", show_alert: true }); return null; }
  return p;
};

export function registerProofs(bot: Bot) {
  bot.callbackQuery(/^pfa:(\w+)$/, async (ctx) => {
    const p = await mine(ctx, ctx.match[1]);
    if (!p) return;
    const r = await approveProof(p.id, "owner");
    await ctx.answerCallbackQuery({ text: r ? "Approved. The worker was paid." : "Already decided." });
    await finish(ctx, r ? "✅ Approved. The worker was paid." : "This proof was already decided.");
  });

  bot.callbackQuery(/^pfr:(\w+)$/, async (ctx) => {
    const p = await mine(ctx, ctx.match[1]);
    if (!p) return;
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    REJECT_REASONS.forEach((r, i) => kb.text(r, `pfx:${p.id}:${i}`).row());
    kb.text("↩️ Back", `pfb:${p.id}`);
    await ctx.editMessageReplyMarkup({ reply_markup: kb }).catch(() => {});
  });

  bot.callbackQuery(/^pfb:(\w+)$/, async (ctx) => {
    const p = await mine(ctx, ctx.match[1]);
    if (!p) return;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text("✅ Approve", `pfa:${p.id}`).text("❌ Reject", `pfr:${p.id}`) }).catch(() => {});
  });

  bot.callbackQuery(/^pfx:(\w+):(\d)$/, async (ctx) => {
    const p = await mine(ctx, ctx.match[1]);
    if (!p) return;
    const r = await rejectProof(p.id, Number(ctx.match[2]));
    await ctx.answerCallbackQuery({ text: r ? "Rejected." : "Already decided." });
    await finish(ctx, r ? `❌ Rejected: ${REJECT_REASONS[Number(ctx.match[2])]}` : "This proof was already decided.");
  });

  bot.callbackQuery(/^pfd:(\w+)$/, async (ctx) => {
    const p = await disputeProof(ctx.match[1], ctx.from.id);
    if (!p) return void (await ctx.answerCallbackQuery({ text: "This can't be disputed (too late, or already handled).", show_alert: true }));
    await ctx.answerCallbackQuery({ text: "Sent to an admin." });
    await ctx.editMessageText("⚖️ Your dispute was sent to an admin. You'll get a message with the result.").catch(() => {});
  });
}

/** The worker sent a photo while we were waiting for their proof. */
export async function proofPhoto(ctx: Context, st: UserState) {
  const photo = ctx.message!.photo!.at(-1)!;
  const r = await submitProof(ctx.from!.id, String(st.data.taskId), photo.file_id, ctx.botId);
  await setState(ctx.from!.id, null);
  if (r.ok) {
    return void (await ctx.reply("✅ Sent to the promoter. You'll be paid when they approve it, or automatically after 24 hours if they don't answer.", { reply_markup: mainMenu }));
  }
  const msg = { done: "You already sent a proof for this task.", own: "You can't do your own task.", gone: "This task no longer exists.", unavailable: "This task just ran out of places. Try another." }[r.reason];
  await ctx.reply(msg, { reply_markup: mainMenu });
}
