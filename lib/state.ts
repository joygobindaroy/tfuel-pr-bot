import { usersCol } from "./users";

export async function setState(uid: number, step: string | null, data: Record<string, unknown> = {}) {
  await usersCol().doc(String(uid)).update({ state: step ? { step, data, at: Date.now() } : null });
}
