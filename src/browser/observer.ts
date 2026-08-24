import type { Page } from "playwright";
import type { PageObservation } from "@/agent/types";
import { captureScreenshot } from "@/browser/screenshot";

function truncate(text: string, max = 3500): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

function isNavigationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Execution context was destroyed") ||
    message.includes("most likely because of a navigation") ||
    message.includes("Target closed") ||
    message.includes("Frame was detached")
  );
}

export async function waitForStablePage(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => undefined);
  const url = page.url();
  const spa = /xero\.com|freshbooks\.com|waveapps\.com|wavehq\.com|zoho\.com|freeagent\.com/i.test(
    url
  );
  // Keep this short on production hosts — long networkidle waits look like a blank browser.
  await page.waitForTimeout(spa ? 1200 : 500).catch(() => undefined);
}

async function readPageContent(page: Page) {
  return page.evaluate(() => {
    const junk =
      /accessibility|feedback|cookie|privacy|terms of|sign in|log in|microsoft|advertisement|skip to|languages/i;
    const main =
      document.querySelector("#mw-content-text") ||
      document.querySelector("main") ||
      document.body;
    const bodyText = (main as HTMLElement)?.innerText ?? "";
    const candidates = Array.from(
      document.querySelectorAll(
        "a, button, input, textarea, [role='button'], [role='link']"
      )
    );

    const interactiveElements = candidates
      .map((el, index) => {
        const tag = el.tagName.toLowerCase();
        const inputType = el.getAttribute("type") || "";
        const href = el.getAttribute("href") || "";
        const text = (
          (el as HTMLElement).innerText ||
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.getAttribute("name") ||
          inputType ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 48);

        if (junk.test(text) || junk.test(href)) return null;
        if (text.length > 48) return null;

        let selector = "";
        if (el.id) {
          selector = `#${CSS.escape(el.id)}`;
        } else if (el.getAttribute("name")) {
          selector = `${tag}[name="${el.getAttribute("name")}"]`;
        } else if (tag === "a" && href.startsWith("http")) {
          selector = `a[href="${href.slice(0, 120)}"]`;
        } else if (tag === "input" && inputType) {
          selector = `input[type="${inputType}"]`;
        } else if (text) {
          selector = `text=${text.slice(0, 40)}`;
        } else {
          selector = `${tag}:nth-of-type(${index + 1})`;
        }

        return {
          tag: inputType ? `${tag}[type=${inputType}]` : tag,
          text: text || selector,
          selector,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item?.selector))
      .slice(0, 16);

    const description =
      document.querySelector('meta[name="description"]')?.getAttribute("content") ||
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content") ||
      "";

    return {
      excerpt: [description, bodyText].filter(Boolean).join(" ").slice(0, 5000),
      interactiveElements,
    };
  });
}

export async function observePage(page: Page): Promise<PageObservation> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await waitForStablePage(page);
      const url = page.url();
      const title = await page.title().catch(() => "");
      const { excerpt, interactiveElements } = await readPageContent(page);
      let screenshot = await captureScreenshot(page);
      if (!screenshot) {
        await page.waitForTimeout(400).catch(() => undefined);
        screenshot = await captureScreenshot(page);
      }

      return {
        url,
        title,
        excerpt: truncate(excerpt),
        interactiveElements,
        screenshot,
      };
    } catch (error) {
      lastError = error;
      if (!isNavigationError(error) || attempt === 2) {
        throw error;
      }
      await page.waitForTimeout(500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to observe page");
}
