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

export async function openFirstOrganicResult(
  page: Page
): Promise<{ ok: boolean; detail: string } | null> {
  const href = await page
    .evaluate(() => {
      const blocked =
        /duckduckgo\.com|bing\.com|microsoft\.com|google\.com\/search|javascript:|privacy|feedback|accessibility/i;
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
        if (blocked.test(href) || blocked.test(text)) continue;
        if (text.length < 2) continue;
        return href;
      }
      return null;
    })
    .catch(() => null);

  if (!href) return null;
  await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(500);
  return { ok: true, detail: `Opened first search result: ${href}` };
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
      if (isJunkClick(action.selector)) {
        const opened = await openFirstOrganicResult(page);
        if (opened) return opened;
        return { ok: false, detail: `Skipped junk click: ${action.selector}` };
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
