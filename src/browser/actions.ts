import type { Page } from "playwright";
import type { AgentAction } from "@/agent/types";
import { isBlockedUrl } from "@/browser/policy";
import { searchUrl } from "@/browser/search";
import { gotoPage } from "@/browser/navigate";

function resolveSelector(selector: string): string {
  if (selector.startsWith("text=")) {
    const text = selector.slice(5).replace(/^["']|["']$/g, "");
    return `text=${JSON.stringify(text)}`;
  }
  return selector;
}

function isJunkClick(selector: string): boolean {
  return /accessibility|feedback|cookie|privacy|sign in|microsoft|sb_form|href\^=.http/i.test(
    selector
  );
}

const SKIP_WIKI =
  /softbank|manus|deepseek|chatgpt|unicorn|billionaire|main_page|special:|wikipedia:|help:|file:|talk:|template:|portal:|disambiguation|sage_50|\/wiki\/accounting$/i;

function isBadClick(selector: string): boolean {
  return (
    isJunkClick(selector) ||
    /mw-search-result/i.test(selector) ||
    selector.length > 90 ||
    /manus|softbank|deepseek|chatgpt|launched in china|challenging gpt/i.test(selector)
  );
}

export async function openRelevantWikiResult(
  page: Page,
  keywords: string[]
): Promise<{ ok: boolean; detail: string } | null> {
  const href = await page
    .evaluate((keys) => {
          const skip =
            /softbank|manus|deepseek|chatgpt|unicorn|billionaire|\/wiki\/Accounting$|\/wiki\/Sage_50|\/wiki\/Microsoft|\/wiki\/Dynamics|\/wiki\/ADempiere|\/wiki\/Apache_OFBiz|\/wiki\/GnuCash|\/wiki\/bookkeeping|main_page|special:|wikipedia:|help:|file:|talk:|template:|portal:/i;
      const anchors = Array.from(
        document.querySelectorAll(
          ".mw-search-result-heading a[href^='/wiki/'], .mw-search-results a[href^='/wiki/']"
        )
      ) as HTMLAnchorElement[];
      const scored = anchors
        .map((anchor) => {
          const href = anchor.href;
          const text = `${anchor.textContent || ""} ${href}`.toLowerCase();
          if (!href || skip.test(href) || skip.test(text)) return null;
          const score = keys.reduce(
            (sum, key) => sum + (text.includes(key.toLowerCase()) ? 2 : 0),
            0
          );
          const bonus =
            /account|bookkeep|software|invoic|ledger|automat|xero|quickbooks|comparison/.test(text)
              ? 6
              : 0;
          const penalty = /unicorn|country|billionaire|\/wiki\/Accounting$|\/wiki\/Sage_50|\/wiki\/Microsoft|Dynamics_365/.test(
            href
          )
              ? -25
              : 0;
          return { href, score: score + bonus + penalty };
        })
        .filter((item): item is { href: string; score: number } => Boolean(item))
        .sort((a, b) => b.score - a.score);
      return scored.find((item) => item.score > 0)?.href || null;
    }, keywords)
    .catch(() => null);

  if (!href || SKIP_WIKI.test(href)) return null;
  const navigated = await gotoPage(page, href);
  if (!navigated.ok) return { ok: false, detail: navigated.detail };
  await page.waitForTimeout(500);
  return { ok: true, detail: `Opened Wikipedia result: ${navigated.url}` };
}

export async function openFirstOrganicResult(
  page: Page,
  keywords: string[] = []
): Promise<{ ok: boolean; detail: string } | null> {
  const relevant = await openRelevantWikiResult(page, keywords);
  if (relevant) return relevant;

  const href = await page
    .evaluate(() => {
      const skip =
        /softbank|duckduckgo\.com|bing\.com|microsoft\.com|google\.com\/search|javascript:|privacy|feedback|accessibility|special:|wikipedia:/i;
      const links = Array.from(document.querySelectorAll("a[href]"));
      for (const link of links) {
        let href = link.getAttribute("href") || "";
        const text = ((link as HTMLElement).innerText || "").trim();
        if (href.startsWith("//")) href = `https:${href}`;
        try {
          const parsed = new URL(href);
          const nested = parsed.searchParams.get("uddg") || parsed.searchParams.get("u");
          if (nested) href = decodeURIComponent(nested);
        } catch {
          // keep href
        }
        if (!href.startsWith("http")) continue;
        if (skip.test(href) || skip.test(text)) continue;
        if (text.length < 2) continue;
        return href;
      }
      return null;
    })
    .catch(() => null);

  if (!href || SKIP_WIKI.test(href)) return null;
  const navigated = await gotoPage(page, href);
  if (!navigated.ok) return { ok: false, detail: navigated.detail };
  await page.waitForTimeout(500);
  return { ok: true, detail: `Opened search result: ${navigated.url}` };
}

export async function findOfficialWebsiteHref(page: Page): Promise<string | null> {
  const href = await page
    .evaluate(() => {
      const skip =
        /techcrunch|forbes|bloomberg|reuters|yahoo|businessinsider|wired|theverge|crunchbase|linkedin|twitter|facebook|wikipedia|wikimedia|web.archive|archive.org/i;

      const usable = (raw?: string | null) => {
        if (!raw) return null;
        let next = raw.trim();
        if (next.startsWith("//")) next = `https:${next}`;
        if (!/^https?:\/\//i.test(next)) return null;
        if (skip.test(next)) return null;
        return next;
      };

      for (const row of Array.from(document.querySelectorAll(".infobox tr"))) {
        const label = (row.querySelector("th, .infobox-label")?.textContent || "").toLowerCase();
        if (!/website|url|homepage/.test(label)) continue;
        const link = row.querySelector("a[href]") as HTMLAnchorElement | null;
        const found = usable(link?.href || link?.getAttribute("href"));
        if (found) return found;
      }

      for (const link of Array.from(
        document.querySelectorAll(".infobox a.external, .infobox a[rel='nofollow']")
      ) as HTMLAnchorElement[]) {
        const found = usable(link.href);
        if (found) return found;
      }

      const official = Array.from(document.querySelectorAll("a")).find((el) =>
        /^official website$/i.test((el.textContent || "").trim())
      ) as HTMLAnchorElement | undefined;
      return usable(official?.href) || null;
    })
    .catch(() => null);

  if (!href || isBlockedUrl(href)) return null;
  return href;
}

export async function openOfficialWebsite(
  page: Page
): Promise<{ ok: boolean; detail: string } | null> {
  const href = await findOfficialWebsiteHref(page);
  if (!href) return null;
  const navigated = await gotoPage(page, href);
  if (!navigated.ok) return { ok: false, detail: navigated.detail };
  await page.waitForTimeout(600);
  return { ok: true, detail: `Opened official website: ${navigated.url}` };
}

export async function scrapeWikiCompanyNames(page: Page): Promise<string[]> {
  return page
    .evaluate(() => {
      const skip =
        /^(talk|file|help|category|template|special|wikipedia|main page|citation|edit|accounting|bookkeeping|finance|software|list of)/i;
      const skipHref = /\/wiki\/(Accounting|Bookkeeping|Finance|Software|Artificial_intelligence|Sage_50|Sage_Group|Microsoft|Microsoft_Dynamics|ADempiere|Apache_OFBiz|GnuCash)/;
      const links = Array.from(
        document.querySelectorAll("#mw-content-text li a[href^='/wiki/'], #mw-content-text td a[href^='/wiki/']")
      ) as HTMLAnchorElement[];
      const names: string[] = [];
      for (const link of links) {
        const name = (link.textContent || "").trim();
        const href = link.getAttribute("href") || "";
        if (name.length < 3 || name.length > 42) continue;
        if (skip.test(name) || skipHref.test(href) || /:/.test(href.replace("/wiki/", ""))) continue;
        if (/\d{4}/.test(name)) continue;
        if (!/[A-Z]/.test(name[0] || "")) continue;
        names.push(name);
      }
      return [...new Set(names)].slice(0, 10);
    })
    .catch(() => []);
}

async function fillField(
  page: Page,
  selector: string,
  text: string,
  pressEnter?: boolean
): Promise<{ ok: boolean; detail: string }> {
  const resolved = resolveSelector(selector);
  const locator = page.locator(resolved).first();
  await locator.waitFor({ state: "visible", timeout: 4000 });
  await locator.click({ timeout: 4000 });
  await locator.fill(text);
  if (pressEnter) {
    await page.keyboard.press("Enter");
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }
  await page.waitForTimeout(700);
  return {
    ok: true,
    detail: pressEnter
      ? `Filled ${selector} with “${text}” and submitted`
      : `Filled ${selector} with “${text}”`,
  };
}

export async function executeAction(
  page: Page,
  action: AgentAction
): Promise<{ ok: boolean; detail: string }> {
  switch (action.type) {
    case "navigate": {
      let url = action.url;
      if (isBlockedUrl(url) || /bing\.com|google\.com\/search|duckduckgo\.com/i.test(url)) {
        let query = "";
        try {
          query = new URL(url).searchParams.get("q") || "";
        } catch {
          query = "";
        }
        url = searchUrl(query || "AI accounting software", "wiki");
      }
      const navigated = await gotoPage(page, url);
      return {
        ok: navigated.ok,
        detail: navigated.detail,
      };
    }
    case "click": {
      if (/official website/i.test(action.selector)) {
        const opened = await openOfficialWebsite(page);
        if (opened) return opened;
        return { ok: false, detail: "No official website link on this page" };
      }
      if (isBadClick(action.selector)) {
        const opened = await openRelevantWikiResult(page, [
          "accounting",
          "software",
          "startup",
          "bookkeep",
          "invoice",
          "ai",
        ]);
        if (opened) return opened;
        return { ok: false, detail: `Skipped off-topic click: ${action.selector.slice(0, 80)}` };
      }
      const selector = resolveSelector(action.selector);
      const locator = page.locator(selector).first();
      try {
        await locator.click({ timeout: 2500 });
      } catch {
        return { ok: false, detail: `Click missed (${selector.slice(0, 80)})` };
      }
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      return { ok: true, detail: `Clicked ${action.selector}` };
    }
    case "type":
    case "fill": {
      return fillField(page, action.selector, action.text, action.pressEnter);
    }
    case "scroll": {
      await page.mouse.wheel(0, action.direction === "down" ? 900 : -900);
      await page.waitForTimeout(400);
      return { ok: true, detail: `Scrolled ${action.direction}` };
    }
    case "wait": {
      await page.waitForTimeout(Math.min(action.ms, 5000));
      return { ok: true, detail: `Waited ${action.ms}ms` };
    }
    case "extract":
    case "ask_human":
    case "checkpoint":
    case "done":
      return { ok: true, detail: "Handled by agent loop" };
    default:
      return { ok: false, detail: "Unknown action" };
  }
}

export async function findAlternativeClickTarget(
  page: Page,
  keywords: string[]
): Promise<string | null> {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
    return await page.evaluate((keys) => {
      const nodes = Array.from(document.querySelectorAll("a, button, [role='button']"));
      for (const key of keys) {
        const match = nodes.find((node) =>
          ((node as HTMLElement).innerText || "").toLowerCase().includes(key.toLowerCase())
        );
        if (match) {
          const text = ((match as HTMLElement).innerText || "").trim().slice(0, 60);
          if (text) return `text=${text}`;
        }
      }
      return null;
    }, keywords);
  } catch {
    return null;
  }
}

export async function findSearchField(page: Page): Promise<string | null> {
  const selectors = [
    "input[name='q']",
    "input[type='search']",
    "input[name='query']",
    "textarea[name='q']",
    "#search_form_input",
    "input[type='text']",
  ];
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    if (count > 0) return selector;
  }
  return null;
}
