import { Keyboard } from "grammy";
import type { ChatAdministratorRights } from "grammy/types";

/** Builds a full rights object (Telegram wants every flag) with only the named ones set to true. */
export function rights(on: (keyof ChatAdministratorRights)[]): ChatAdministratorRights {
  const base: ChatAdministratorRights = {
    is_anonymous: false, can_manage_chat: false, can_delete_messages: false, can_manage_video_chats: false,
    can_restrict_members: false, can_promote_members: false, can_change_info: false, can_invite_users: false,
    can_post_stories: false, can_edit_stories: false, can_delete_stories: false, can_send_welcome_messages: false,
  };
  const out = base as unknown as Record<string, boolean>;
  for (const k of on) out[k as string] = true;
  return base;
}

export type PickerPurpose = "promote" | "register" | "required";

/**
 * Telegram's own chat picker: it only lists chats where the user is an admin, and it offers to add the bot as admin
 * with the rights we ask for. The shared chat arrives as a `chat_shared` message.
 */
export function pickerKeyboard(kind: "channel" | "group", purpose: PickerPurpose) {
  const botRights =
    kind === "channel"
      ? purpose === "register" ? rights(["can_invite_users", "can_post_messages" as never, "can_delete_messages"]) : rights(["can_invite_users"])
      : purpose === "promote" ? rights(["can_invite_users"]) : rights(["can_invite_users", "can_delete_messages", "can_restrict_members"]);
  const userRights = { ...botRights, can_invite_users: true };
  const id = ({ promote: 10, register: 20, required: 30 } as const)[purpose] + (kind === "channel" ? 1 : 2);
  return new Keyboard()
    .requestChat("I'm an admin", id, {
      chat_is_channel: kind === "channel",
      user_administrator_rights: userRights,
      bot_administrator_rights: botRights,
    })
    .row()
    .text("I'm not an admin")
    .row()
    .text("⬅️ Back")
    .resized()
    .oneTime();
}

export const NOT_ADMIN_HELP =
  "To use a chat you must be its admin, and this bot must be an admin there too.\n\n1. Open your channel or group.\n2. Administrators → Add administrator.\n3. Search for this bot and add it.\n4. Come back and press “I'm an admin”.";
