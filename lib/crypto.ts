import crypto from "crypto";

// Prefer a dedicated BOT_ENC_KEY. Changing it makes stored mirror-bot tokens unreadable.
const key = () =>
  crypto
    .createHash("sha256")
    .update(process.env.BOT_ENC_KEY || (process.env.HASH_SALT || "") + (process.env.WEBHOOK_SECRET || ""))
    .digest();

export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

export function decrypt(s: string) {
  const [iv, tag, ct] = s.split(".").map((x) => Buffer.from(x, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
