import type { Page } from "playwright";

export async function captureScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "jpeg", quality: 55, fullPage: false });
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}
