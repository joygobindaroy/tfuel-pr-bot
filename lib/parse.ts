/** "@name", "name", "https://t.me/name_bot?start=abc" -> the bot's username and a start link. Returns null if it is not a bot. */
export function parseBotRef(input: string): { username: string; link: string } | null {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:t\.me\/|telegram\.me\/)?@?([A-Za-z][A-Za-z0-9_]{3,31})(\?start=[\w-]{1,64})?$/i);
  if (!m || !/bot$/i.test(m[1])) return null;
  return { username: m[1], link: `https://t.me/${m[1]}${m[2] ?? ""}` };
}

/** "https://t.me/channel/123" or ".../c/12345/678" -> a clean post link. */
export function parsePostLink(input: string): { link: string; messageId: number } | null {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(c\/\d+|[A-Za-z][A-Za-z0-9_]{3,31})\/(\d+)(?:\?.*)?$/);
  if (!m) return null;
  return { link: `https://t.me/${m[1]}/${m[2]}`, messageId: Number(m[2]) };
}
