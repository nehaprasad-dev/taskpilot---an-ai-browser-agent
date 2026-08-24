import type { Page } from "playwright";

const isProd = process.env.NODE_ENV === "production";
const NAV_TIMEOUT_MS = Number(
  process.env.NAV_TIMEOUT_MS || (isProd ? 12000 : 20000)
);

/**
 * Fast navigation for constrained hosts (Render).
 * Prefer `commit` so we do not burn 30s waiting for heavy marketing pages.
 */
export async function gotoPage(
  page: Page,
  url: string
): Promise<{ ok: boolean; detail: string; url: string }> {
  try {
    await page.goto(url, {
      waitUntil: "commit",
      timeout: NAV_TIMEOUT_MS,
    });
    await page
      .waitForLoadState("domcontentloaded", {
        timeout: isProd ? 4000 : 8000,
      })
      .catch(() => undefined);
    return { ok: true, detail: `Navigated to ${page.url() || url}`, url: page.url() || url };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = page.url();
    const heavyHost =
      /careers\.|jobs\.|greenhouse\.io|lever\.co|workday/i.test(url) ||
      /careers\.|jobs\./i.test(current || "");

    // Partial load on a heavy careers host is usually worse than skipping —
    // production VMs burn 12–30s here and still fail screenshots.
    if (
      heavyHost &&
      isProd &&
      current &&
      current !== "about:blank" &&
      !current.startsWith("chrome-error://")
    ) {
      return {
        ok: false,
        detail: `Timeout on slow careers page: ${current}`,
        url: current,
      };
    }

    if (current && current !== "about:blank" && !current.startsWith("chrome-error://")) {
      return {
        ok: true,
        detail: `Loaded ${current} (slow page)`,
        url: current,
      };
    }

    return {
      ok: false,
      detail: message.split("Call log")[0]?.trim() || message,
      url: page.url() || url,
    };
  }
}
