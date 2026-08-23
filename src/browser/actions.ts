import type { Page } from "playwright";
import type { AgentAction } from "@/agent/types";
import { searchUrl } from "@/browser/search";

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
  /softbank|main_page|special:|wikipedia:|help:|file:|talk:|template:|portal:|disambiguation/i;

export async function openRelevantWikiResult(
  page: Page,
  keywords: string[]
): Promise<{ ok: boolean; detail: string } | null> {
  const href = await page
    .evaluate((keys) => {
      const skip =
        /softbank|main_page|special:|wikipedia:|help:|file:|talk:|template:|portal:/i;
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
            /account|bookkeep|software|startup|invoic|ledger|automat/.test(text)
              ? 3
              : 0;
          return { href, score: score + bonus };
        })
        .filter((item): item is { href: string; score: number } => Boolean(item))
        .sort((a, b) => b.score - a.score);
      return scored.find((item) => item.score > 0)?.href || null;
    }, keywords)
    .catch(() => null);

  if (!href || SKIP_WIKI.test(href)) return null;
  await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(500);
  return { ok: true, detail: `Opened Wikipedia result: ${href}` };
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
  await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(500);
  return { ok: true, detail: `Opened search result: ${href}` };
}

export async function openOfficialWebsite(
  page: Page
): Promise<{ ok: boolean; detail: string } | null> {
  const href = await page
    .evaluate(() => {
      const labeled = Array.from(
        document.querySelectorAll(".infobox a.external, a.external")
      ) as HTMLAnchorElement[];
      for (const link of labeled) {
        const context = `${link.textContent || ""} ${link.closest("tr")?.innerText || ""}`.toLowerCase();
        const href = link.href;
        if (!href.startsWith("http")) continue;
        if (/wikipedia\.org|wikimedia|web.archive|isbn|doi.org/.test(href)) continue;
        if (/official|website|homepage|url/.test(context) || labeled.length === 1) {
          return href;
        }
      }
      return labeled.find((link) => /^https?:/.test(link.href) && !/wikipedia/.test(link.href))
        ?.href || null;
    })
    .catch(() => null);

  if (!href) return null;
  await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(600);
  return { ok: true, detail: `Opened official website: ${href}` };
}

async function fillField(
  page: Page,
  selector: string,
  text: string,
  pressEnter?: boolean
): Promise<{ ok: boolean; detail: string }> {
  const resolved = resolveSelector(selector);
  const locator = page.locator(resolved).first();
  await locator.waitFor({ state: "visible", timeout: 10000 });
  await locator.click({ timeout: 10000 });
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
      if (/bing\.com|google\.com\/search|duckduckgo\.com/i.test(url)) {
        let query = "";
        try {
          query = new URL(url).searchParams.get("q") || "";
        } catch {
          query = "";
        }
        url = searchUrl(query || "search", "wiki");
      }
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(500);
      return { ok: true, detail: `Navigated to ${url}` };
    }
    case "click": {
      if (isJunkClick(action.selector) || /mw-search-result/i.test(action.selector)) {
        const opened = await openRelevantWikiResult(page, [
          "accounting",
          "software",
          "startup",
          "bookkeep",
          "invoice",
          "ai",
        ]);
        if (opened) return opened;
        if (isJunkClick(action.selector)) {
          return { ok: false, detail: `Skipped junk click: ${action.selector}` };
        }
      }
      const selector = resolveSelector(action.selector);
      const locator = page.locator(selector).first();
      try {
        await locator.click({ timeout: 8000 });
      } catch {
        await locator.click({ timeout: 5000, force: true });
      }
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(700);
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
