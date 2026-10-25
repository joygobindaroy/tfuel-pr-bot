import type { UserDoc } from "./users";

declare module "grammy" {
  interface Context {
    user: UserDoc;
    botId: string;
    /** Set by the More menu so handlers send a new message instead of editing the menu. */
    fresh?: boolean;
  }
}
