import { getDb } from "./firebase";
import { isAdmin } from "./config";

export type Role = "super" | "moderator" | "finance";

const PERMS: Record<Role, string[] | "*"> = {
  super: "*",
  moderator: ["users.view", "users.ban", "tasks", "tickets", "fraud", "audit"],
  finance: ["users.view", "balance", "stats", "promo", "audit"],
};

export async function getRole(id: number): Promise<Role | null> {
  if (isAdmin(id)) return "super";
  const s = await getDb().collection("admins").doc(String(id)).get();
  return s.exists ? ((s.data() as { role: Role }).role ?? null) : null;
}

export const can = (role: Role, perm: string) =>
  PERMS[role] === "*" || (PERMS[role] as string[]).includes(perm);

export async function audit(adminId: number, action: string, target: string, details: unknown = {}) {
  try {
    await getDb().collection("audit").add({ adminId, action, target, details, at: Date.now() });
  } catch (e) {
    console.error("audit failed", e);
  }
}
