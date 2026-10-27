import { InlineKeyboard } from "grammy";
import { esc } from "./ui";

const n = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** The warning a worker gets when they leave a task chat: what happens, and two buttons to put it right. */
export function leaveWarning(o: {
  title: string; payout: number; penalty: number; currency: string; retentionDays: number; graceHours: number; link: string; compId: string;
}) {
  const text = [
    `<b>You left ${esc(o.title)}</b>`,
    ``,
    `You were paid <b>${n(o.payout)} ${esc(o.currency)}</b> for joining, and you need to stay for ${o.retentionDays} days to keep it.`,
    ``,
    `<b>Join again within ${o.graceHours} hour${o.graceHours === 1 ? "" : "s"}</b>, then press “Check again”.`,
    `If you don't, <b>${n(o.penalty)} ${esc(o.currency)}</b> will be taken from your balance.`,
  ].join("\n");
  const kb = new InlineKeyboard();
  if (o.link) kb.url("🔔 Subscribe again", o.link).row();
  kb.text("🔄 Check again", `lv:${o.compId}`);
  return { text, kb };
}
