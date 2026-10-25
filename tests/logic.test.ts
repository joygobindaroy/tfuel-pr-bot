import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../lib/config";
import { depositQuote, usdtQuote } from "../lib/payments";
import { levelFor } from "../lib/users";
import { validSegment } from "../lib/broadcast";
import { makeCaptcha } from "../lib/captcha";
import { calcBonus, isEligible } from "../lib/network";
import { taskPrice } from "../lib/tasks";
import { quote, starsFor } from "../lib/taskpay";
import { rights } from "../lib/picker";
import { allow, once } from "../lib/ratelimit";
import { weekKey } from "../lib/leaderboard";
import { memberLeft, type ChatDoc } from "../lib/chats";
import { L, LEGACY, MORE } from "../lib/labels";
import { esc, mainMenu, moreMenu, welcomeText } from "../lib/ui";

const cfg = DEFAULT_CONFIG;

describe("deposit quotes", () => {
  it("applies the right Stars bonus tier", () => {
    expect(depositQuote(50, cfg)).toMatchObject({ base: 5000, bonus: 0, total: 5000 });
    expect(depositQuote(250, cfg)).toMatchObject({ pct: 5, total: 26250 });
    expect(depositQuote(1000, cfg)).toMatchObject({ pct: 15, total: 115000 });
  });
  it("applies USDT tiers", () => {
    expect(usdtQuote(10, cfg).total).toBe(10000);
    expect(usdtQuote(50, cfg)).toMatchObject({ pct: 10, total: 55000 });
  });
});

describe("task pricing", () => {
  it("adds commission on top of the reward", () => {
    const p = taskPrice("channel", cfg);
    expect(p.reward).toBe(30);
    expect(p.commission).toBe(6);
    expect(p.cost).toBe(36);
  });
  it("premium audience pays the premium reward", () => {
    expect(taskPrice("channel", cfg, { premium: true }).reward).toBe(55);
  });
  it("country targeting adds the fee per unit", () => {
    expect(taskPrice("group", cfg, { targeted: true }).reward).toBe(25);
  });
});

describe("levels", () => {
  it("picks the level and next threshold", () => {
    expect(levelFor(0, cfg.levels).name).toBe("Rookie");
    const l = levelFor(2275, cfg.levels);
    expect(l.name).toBe("Task Master");
    expect(l.nextXp).toBe(5000);
    expect(levelFor(99999, cfg.levels).nextXp).toBeNull();
  });
});

describe("broadcast segments", () => {
  it("accepts only known shapes", () => {
    for (const ok of ["all", "premium", "country:BD", "active:7", "level:task_master"]) expect(validSegment(ok)).toBe(true);
    for (const bad of ["", "country:BDX", "active:abc", "everyone", "level:"]) expect(validSegment(bad)).toBe(false);
  });
});

describe("captcha", () => {
  it("always includes the right answer among 4 distinct options", () => {
    for (let i = 0; i < 200; i++) {
      const c = makeCaptcha();
      expect(c.options).toHaveLength(4);
      expect(new Set(c.options).size).toBe(4);
      expect(c.options).toContain(c.answer);
    }
  });
});

describe("network bonus", () => {
  it("is zero when the amount is zero, even with a minimum", () => {
    expect(calcBonus({ mode: "fixed", amount: 0, min: 50, max: 0 }, 5000)).toBe(0);
  });
  it("fixed and per-1000 modes respect min and max", () => {
    expect(calcBonus({ mode: "fixed", amount: 100, min: 0, max: 0 }, 10)).toBe(100);
    expect(calcBonus({ mode: "per1000", amount: 10, min: 0, max: 0 }, 5000)).toBe(50);
    expect(calcBonus({ mode: "per1000", amount: 10, min: 20, max: 0 }, 100)).toBe(20);
    expect(calcBonus({ mode: "per1000", amount: 10, min: 0, max: 30 }, 100000)).toBe(30);
  });
});

const chat = (over: Partial<ChatDoc> = {}): ChatDoc => ({
  id: -100, type: "supergroup", title: "t", username: null, inviteLink: null, memberCount: 500, botId: "1", botAdmin: true,
  rights: { canPost: true, canDelete: true, canRestrict: true, canInvite: true, canPin: true }, addedBy: 1, ownerId: 1, status: "active",
  ads: { enabled: true, acceptedAt: 1, acceptedBy: 1, maxPerDay: 1, lastPostAt: 0, postsDay: "", postsToday: 0 },
  mandatory: { enabled: false, mode: "delete", required: [] }, earned: 0, tags: [], blacklisted: false, promptedAt: null, createdAt: 0, updatedAt: 0, ...over,
});

describe("network eligibility", () => {
  const spec = { mode: "all" as const };
  it("accepts a normal opted-in chat", () => expect(isEligible(chat(), spec, cfg, "2026-10-24")).toBe(true));
  it("rejects when ads are off, blacklisted, or the bot is not admin", () => {
    expect(isEligible(chat({ ads: { ...chat().ads, enabled: false } }), spec, cfg)).toBe(false);
    expect(isEligible(chat({ blacklisted: true }), spec, cfg)).toBe(false);
    expect(isEligible(chat({ botAdmin: false }), spec, cfg)).toBe(false);
  });
  it("enforces the minimum member rule and the daily cap", () => {
    expect(isEligible(chat({ memberCount: 50 }), spec, cfg)).toBe(false);
    const posted = chat({ ads: { ...chat().ads, postsDay: "2026-10-24", postsToday: 1 } });
    expect(isEligible(posted, spec, cfg, "2026-10-24")).toBe(false);
    expect(isEligible(posted, spec, cfg, "2026-10-25")).toBe(true); // new day
  });
  it("channels need the post right", () => {
    expect(isEligible(chat({ type: "channel", rights: { ...chat().rights, canPost: false } }), spec, cfg)).toBe(false);
  });
  it("honours ids, exclude, types and tags", () => {
    expect(isEligible(chat(), { mode: "ids", ids: [-999] }, cfg)).toBe(false);
    expect(isEligible(chat(), { mode: "ids", ids: [-100] }, cfg)).toBe(true);
    expect(isEligible(chat(), { mode: "filter", exclude: [-100] }, cfg)).toBe(false);
    expect(isEligible(chat(), { mode: "filter", types: ["channel"] }, cfg)).toBe(false);
    expect(isEligible(chat({ tags: ["vip"] }), { mode: "filter", tags: ["vip"] }, cfg)).toBe(true);
  });
});

describe("chat picker rights", () => {
  it("sets only the requested flags", () => {
    const r = rights(["can_invite_users", "can_delete_messages"]) as unknown as Record<string, boolean>;
    expect(r.can_invite_users).toBe(true);
    expect(r.can_delete_messages).toBe(true);
    expect(r.can_restrict_members).toBe(false);
  });
});

describe("rate limit and dedupe (in-memory)", () => {
  it("blocks after the max", async () => {
    const k = "t:" + Math.random();
    expect(await allow(k, 2, 10)).toBe(true);
    expect(await allow(k, 2, 10)).toBe(true);
    expect(await allow(k, 2, 10)).toBe(false);
  });
  it("only lets a key through once", async () => {
    const k = "o:" + Math.random();
    expect(await once(k)).toBe(true);
    expect(await once(k)).toBe(false);
  });
});

describe("week key", () => {
  it("is stable inside a week and changes across weeks", () => {
    const a = weekKey(Date.UTC(2026, 9, 19)), b = weekKey(Date.UTC(2026, 9, 25)), c = weekKey(Date.UTC(2026, 9, 26));
    expect(a).toBe(b);
    expect(c).not.toBe(b);
  });
});

describe("crypto, sessions and webhook secrets", () => {
  beforeAll(() => { process.env.BOT_ENC_KEY = "k"; process.env.BOT_TOKEN = "1:x"; process.env.HASH_SALT = "s"; process.env.WEBHOOK_SECRET = "w"; });
  it("round-trips encrypted text and rejects tampering", async () => {
    const { encrypt, decrypt } = await import("../lib/crypto");
    const e = encrypt("123456:secret-token");
    expect(e).not.toContain("secret");
    expect(decrypt(e)).toBe("123456:secret-token");
    expect(() => decrypt(e.slice(0, -4) + "AAAA")).toThrow();
  });
  it("signs and verifies admin sessions", async () => {
    const { makeSession, readSession, COOKIE } = await import("../lib/session");
    const v = makeSession(42);
    expect(readSession(`${COOKIE}=${v}`)).toBe(42);
    expect(readSession(`${COOKIE}=${v.replace("42.", "43.")}`)).toBeNull();
    expect(readSession(`${COOKIE}=${makeSession(42, -1)}`)).toBeNull();
  });
  it("derives a stable per-bot webhook secret", async () => {
    const { mirrorSecret } = await import("../lib/bots");
    expect(mirrorSecret("5")).toBe(mirrorSecret("5"));
    expect(mirrorSecret("5")).not.toBe(mirrorSecret("6"));
  });
});

describe("menus", () => {
  it("main keyboard is compact and has no Deposit button (it lives in Profile)", () => {
    const rows = mainMenu.build();
    expect(rows.length).toBe(3);
    expect(rows.flat().some((b) => /deposit/i.test((b as { text: string }).text))).toBe(false);
    rows.forEach((r) => expect(r.length).toBeLessThanOrEqual(2));
  });
  it("is not persistent, so phones can collapse it", () => {
    expect((mainMenu as unknown as { is_persistent?: boolean }).is_persistent).toBeFalsy();
  });
  it("More menu has every secondary action, two per row, with unique callbacks", () => {
    const rows = moreMenu().inline_keyboard;
    const data = rows.flat().map((b) => (b as { callback_data: string }).callback_data);
    expect(data.length).toBe(MORE.length);
    expect(new Set(data).size).toBe(data.length);
    rows.forEach((r) => { expect(r.length).toBeGreaterThan(0); expect(r.length).toBeLessThanOrEqual(2); });
  });
  it("keeps old keyboard labels working", () => {
    for (const k of Object.keys(LEGACY)) { expect(L[k as keyof typeof L]).toBeTruthy(); expect(LEGACY[k].length).toBeGreaterThan(0); }
  });
  it("welcome text escapes HTML in names and shows the numbers", () => {
    const t = welcomeText({ brand: "TFUEL", currency: "TFUEL" }, { firstName: "<b>Eve</b>", balance: 1250.5, tasksDone: 3 }, "Pro");
    expect(t).not.toContain("<b>Eve</b>");
    expect(t).toContain("&lt;b&gt;Eve");
    expect(t).toContain("1,250.5");
    expect(t).toContain("Welcome back");
    expect(esc("a&b")).toBe("a&amp;b");
  });
});

describe("leave detection", () => {
  it("treats left, kicked and unjoined restricted members as gone", () => {
    expect(memberLeft({ status: "left" })).toBe(true);
    expect(memberLeft({ status: "kicked" })).toBe(true);
    expect(memberLeft({ status: "restricted", is_member: false })).toBe(true);
    expect(memberLeft({ status: "restricted", is_member: true })).toBe(false);
    expect(memberLeft({ status: "member" })).toBe(false);
    expect(memberLeft({ status: "administrator" })).toBe(false);
  });
});

describe("owner-set task price and Stars payment", () => {
  it("never lets the reward fall below the minimum, and adds commission on top", () => {
    expect(taskPrice("channel", cfg, { reward: 10 }).reward).toBe(30);
    const p = taskPrice("channel", cfg, { reward: 50 });
    expect(p).toMatchObject({ reward: 50, commission: 10, cost: 60, min: 30, recommended: 36 });
  });
  it("country targeting raises the floor", () => {
    expect(taskPrice("channel", cfg, { targeted: true, reward: 32 }).reward).toBe(35);
  });
  it("pays less in Stars than from balance by the configured discount", () => {
    // 1000 TFUEL at rate 100 = 10 Stars, minus 10% = 9
    expect(starsFor(1000, cfg)).toBe(9);
    expect(starsFor(1, cfg)).toBe(1);
  });
  it("quotes a draft consistently", () => {
    const q = quote({ type: "channel", chatId: 1, username: "x", title: "t", link: "l", premiumOnly: false, reward: 50, count: 100, countries: [], dailyBudget: 0, startAt: 0 }, cfg);
    expect(q.total).toBe(6000);
    expect(q.stars).toBe(starsFor(6000, cfg));
  });
});
