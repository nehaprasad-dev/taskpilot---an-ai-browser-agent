import type { Page } from "playwright";

function toDataUrl(buffer: Buffer) {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

/**
 * Production hosts (Render free) are memory-tight. Prefer small, fast JPEGs
 * with retries over one high-res capture that silently fails.
 */
export async function captureScreenshot(page: Page): Promise<string> {
  const attempts: Array<() => Promise<Buffer>> = [
    async () =>
      page.screenshot({
        type: "jpeg",
        quality: 28,
        fullPage: false,
        animations: "disabled",
        timeout: 6000,
        clip: { x: 0, y: 0, width: 1024, height: 640 },
      }),
    async () =>
      page.screenshot({
        type: "jpeg",
        quality: 22,
        fullPage: false,
        animations: "disabled",
        timeout: 8000,
        clip: { x: 0, y: 0, width: 800, height: 500 },
      }),
    async () =>
      page.screenshot({
        type: "jpeg",
        quality: 18,
        fullPage: false,
        animations: "disabled",
        timeout: 10000,
      }),
  ];

  for (const attempt of attempts) {
    try {
      const buffer = await attempt();
      if (buffer.byteLength > 0) return toDataUrl(buffer);
    } catch {
      await page.waitForTimeout(250).catch(() => undefined);
    }
  }

  return "";
}
