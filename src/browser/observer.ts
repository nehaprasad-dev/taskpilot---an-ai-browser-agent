import type { Page } from "playwright";
import type { PageObservation } from "@/agent/types";
import { captureScreenshot } from "@/browser/screenshot";

function truncate(text: string, max = 3500): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

export async function observePage(page: Page): Promise<PageObservation> {
  const url = page.url();
  const title = await page.title().catch(() => "");

  const { excerpt, interactiveElements } = await page.evaluate(() => {
    const bodyText = document.body?.innerText ?? "";
    const candidates = Array.from(
      document.querySelectorAll(
        "a, button, input, textarea, [role='button'], [role='link']"
      )
    ).slice(0, 40);

    const interactiveElements = candidates
      .map((el, index) => {
        const tag = el.tagName.toLowerCase();
        const inputType = el.getAttribute("type") || "";
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

        let selector = "";
        if (el.id) {
          selector = `#${CSS.escape(el.id)}`;
        } else if (el.getAttribute("name")) {
          selector = `${tag}[name="${el.getAttribute("name")}"]`;
        } else if (tag === "input" && inputType) {
          selector = `input[type="${inputType}"]`;
        } else if (text) {
          selector = `text=${text.slice(0, 40)}`;
        } else {
          selector = `${tag}:nth-of-type(${index + 1})`;
        }

        return { tag: inputType ? `${tag}[type=${inputType}]` : tag, text: text || selector, selector };
      })
      .filter((item) => item.selector.length > 0);

    return {
      excerpt: bodyText.slice(0, 5000),
      interactiveElements,
    };
  });

  const screenshot = await captureScreenshot(page);

  return {
    url,
    title,
    excerpt: truncate(excerpt),
    interactiveElements,
    screenshot,
  };
}
