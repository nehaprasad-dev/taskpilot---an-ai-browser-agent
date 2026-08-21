import type { Page } from "playwright";
import type { AgentAction } from "@/agent/types";

function resolveSelector(selector: string): string {
  if (selector.startsWith("text=")) {
    const text = selector.slice(5).replace(/^["']|["']$/g, "");
    return `text=${JSON.stringify(text)}`;
  }
  return selector;
}

export async function executeAction(
  page: Page,
  action: AgentAction
): Promise<{ ok: boolean; detail: string }> {
  switch (action.type) {
    case "navigate": {
      await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(800);
      return { ok: true, detail: `Navigated to ${action.url}` };
    }
    case "click": {
      const selector = resolveSelector(action.selector);
      const locator = page.locator(selector).first();
      await locator.click({ timeout: 10000 });
      await page.waitForTimeout(700);
      return { ok: true, detail: `Clicked ${action.selector}` };
    }
    case "type": {
      const selector = resolveSelector(action.selector);
      const locator = page.locator(selector).first();
      await locator.click({ timeout: 10000 });
      await locator.fill("");
      await locator.type(action.text, { delay: 20 });
      if (action.pressEnter) {
        await page.keyboard.press("Enter");
      }
      await page.waitForTimeout(700);
      return { ok: true, detail: `Typed into ${action.selector}` };
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
  return page.evaluate((keys) => {
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
}
