import type { Bot, Context } from "grammy";
import { L, LEGACY } from "../labels";

export type Action = (ctx: Context) => Promise<unknown> | unknown;

/** Every menu action by key, so both the keyboard button and the inline "More" menu can run it. */
export const actions = new Map<string, Action>();

export function action(bot: Bot, key: string, label: string, fn: Action) {
  actions.set(key, fn);
  const triggers = [label, ...(LEGACY[key] ?? [])];
  bot.hears(triggers, fn);
}

export const labelSet = () => new Set<string>([...Object.values(L), ...Object.values(LEGACY).flat()]);
