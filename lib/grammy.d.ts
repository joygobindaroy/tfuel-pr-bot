import type { UserDoc } from "./users";

declare module "grammy" {
  interface Context {
    user: UserDoc;
  }
}
