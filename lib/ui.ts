import { InlineKeyboard, Keyboard, type Context } from "grammy";
import { L } from "./labels";

export const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const mainMenu = new Keyboard()
  .text(L.earn).text(L.promote).row()
  .text(L.deposit).text(L.daily).row()
  .text(L.checks).text(L.cabinet).row()
  .text(L.board).text(L.ach).row()
  .text(L.refs).text(L.promo).row()
  .text(L.chats).text(L.app).row()
  .text(L.support).text(L.stats).row()
  .text(L.settings).text(L.help).row()
  .text(L.links)
  .resized()
  .persistent();

/** Edits the message when answering a button press, otherwise sends a new one. */
export async function show(ctx: Context, text: string, kb?: InlineKeyboard) {
  const other = { ...(kb ? { reply_markup: kb } : {}), link_preview_options: { is_disabled: true } };
  if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, other);
      return;
    } catch (e) {
      if (String((e as Error).message).includes("not modified")) return;
    }
  }
  await ctx.reply(text, other);
}
