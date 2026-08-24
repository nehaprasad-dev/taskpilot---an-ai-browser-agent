import type { Page } from "playwright";

const isProd = process.env.NODE_ENV === "production";

function toDataUrl(buffer: Buffer) {
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

/**
 * Keep screenshots cheap on Render so the agent stays fast.
 */
export async function captureScreenshot(page: Page): Promise<string> {
  const attempts: Array<() => Promise<Buffer>> = isProd
    ? [
        async () =>
          page.screenshot({
            type: "jpeg",
            quality: 22,
            fullPage: false,
            animations: "disabled",
            timeout: 3500,
            clip: { x: 0, y: 0, width: 900, height: 560 },
          }),
        async () =>
          page.screenshot({
            type: "jpeg",
            quality: 18,
            fullPage: false,
            animations: "disabled",
            timeout: 4500,
          }),
      ]
    : [
        async () =>
          page.screenshot({
            type: "jpeg",
            quality: 32,
            fullPage: false,
            animations: "disabled",
            timeout: 6000,
          }),
      ];

  for (const attempt of attempts) {
    try {
      const buffer = await attempt();
      if (buffer.byteLength > 0) return toDataUrl(buffer);
    } catch {
      await page.waitForTimeout(150).catch(() => undefined);
    }
  }

  return "";
}
