import { InlineKeyboard, Keyboard, type Context } from "grammy";
import { L, MORE } from "./labels";

export const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Compact main menu: 3 rows, collapsible (not persistent), everything else is under "More". */
export const mainMenu = new Keyboard()
  .text(L.earn).text(L.promote).row()
  .text(L.deposit).text(L.daily).row()
  .text(L.cabinet).text(L.more)
  .resized();

export function moreMenu() {
  const kb = new InlineKeyboard();
  MORE.forEach(([key, label], i) => {
    kb.text(label, `go:${key}`);
    if (i % 2 === 1 && i < MORE.length - 1) kb.row();
  });
  return kb;
}

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

/** The first thing people see: short, structured, with their numbers up front. */
export function welcomeText(
  cfg: { brand: string; currency: string },
  u: { firstName: string; balance: number; tasksDone: number },
  level: string
) {
  const name = esc((u.firstName || "there").slice(0, 24));
  return [
    `<b>${esc(cfg.brand)}</b>`,
    `<i>Earn, promote, grow.</i>`,
    ``,
    `${u.tasksDone > 0 ? "Welcome back" : "Welcome"}, ${name}.`,
    ``,
    `<b>Balance</b>   ${fmt(u.balance)} ${esc(cfg.currency)}`,
    `<b>Level</b>       ${esc(level)}`,
    ``,
    `<b>Earn</b>  join channels and groups, get paid at once`,
    `<b>Promote</b>  bring real users to your own channel`,
    `<b>Bonus</b>  claim free ${esc(cfg.currency)} every day`,
    ``,
    `Pick an option below.`,
  ].join("\n");
}

/** Edits the message when answering a button press, otherwise sends a new one. */
export async function show(ctx: Context, text: string, kb?: InlineKeyboard) {
  const other = { ...(kb ? { reply_markup: kb } : {}), link_preview_options: { is_disabled: true } };
  if (!ctx.fresh && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, other);
      return;
    } catch (e) {
      if (String((e as Error).message).includes("not modified")) return;
    }
  }
  await ctx.reply(text, other);
}
