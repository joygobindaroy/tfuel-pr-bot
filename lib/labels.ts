/** Menu labels. Only the six on the main keyboard are shown there; the rest live under "More". */
export const L = {
  earn: "💰 Earn",
  promote: "📣 Promote",
  deposit: "💳 Deposit",
  daily: "🎁 Bonus",
  cabinet: "👤 Profile",
  more: "⋯ More",
  checks: "🧾 Checks",
  board: "🏆 Leaderboard",
  ach: "🏅 Achievements",
  refs: "🤝 Referrals",
  promo: "🎟 Promo Code",
  app: "🌐 Open App",
  support: "🆘 Support",
  chats: "📡 My Chats",
  stats: "📊 Statistics",
  settings: "⚙️ Settings",
  help: "ℹ️ Instruction",
  links: "🔗 Useful Links",
};

/** Old keyboard labels still cached on people's phones keep working. */
export const LEGACY: Record<string, string[]> = {
  earn: ["💰 Earnings"],
  daily: ["🎁 Daily Bonus"],
  cabinet: ["👤 My Cabinet", "👤 Account"],
};

/** The "More" menu: plain words, two per row. */
export const MORE: [string, string][] = [
  ["checks", "Checks"], ["board", "Leaderboard"],
  ["ach", "Achievements"], ["refs", "Referrals"],
  ["promo", "Promo code"], ["chats", "My chats"],
  ["support", "Support"], ["stats", "Statistics"],
  ["settings", "Settings"], ["help", "How it works"],
  ["links", "Links"], ["app", "Web app"],
];
