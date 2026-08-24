import type { Page } from "playwright";

const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS || 30000);

/**
 * Navigate with production-friendly timeouts.
 * On Render, corporate sites are often slow; prefer a committed navigation
 * over waiting forever for a perfect domcontentloaded.
 */
export async function gotoPage(
  page: Page,
  url: string
): Promise<{ ok: boolean; detail: string; url: string }> {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT_MS,
    });
    return { ok: true, detail: `Navigated to ${url}`, url: page.url() || url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = page.url();
    // If Chromium did reach a real page before the wait timed out, keep going.
    if (current && current !== "about:blank" && !current.startsWith("chrome-error://")) {
      return {
        ok: true,
        detail: `Loaded ${current} after a slow navigation (${message.split("\n")[0]})`,
        url: current,
      };
    }

    try {
      await page.goto(url, { waitUntil: "commit", timeout: Math.min(NAV_TIMEOUT_MS, 20000) });
      const after = page.url() || url;
      if (after && after !== "about:blank") {
        await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
        return { ok: true, detail: `Navigated to ${after}`, url: after };
      }
    } catch {
      // fall through
    }

    return {
      ok: false,
      detail: message.split("Call log")[0]?.trim() || message,
      url: page.url() || url,
    };
  }
}
