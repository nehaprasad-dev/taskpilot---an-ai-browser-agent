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
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

async function readPageContent(page: Page) {
  return page.evaluate(() => {
    const junk =
      /accessibility|feedback|cookie|privacy|terms of|sign in|log in|microsoft|advertisement|skip to|languages/i;
    const bodyText = document.body?.innerText ?? "";
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
          .slice(0, 80);

        if (junk.test(text) || junk.test(href)) return null;

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
      .slice(0, 25);

    return {
      excerpt: bodyText.slice(0, 5000),
      interactiveElements,
    };
  });
}

export async function observePage(page: Page): Promise<PageObservation> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await waitForStablePage(page);
      const url = page.url();
      const title = await page.title().catch(() => "");
      const { excerpt, interactiveElements } = await readPageContent(page);
      const screenshot = await captureScreenshot(page);

      return {
        url,
        title,
        excerpt: truncate(excerpt),
        interactiveElements,
        screenshot,
      };
    } catch (error) {
      lastError = error;
      if (!isNavigationError(error) || attempt === 4) {
        throw error;
      }
      await page.waitForTimeout(500 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to observe page");
}
