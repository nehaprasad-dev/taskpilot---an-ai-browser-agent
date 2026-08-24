import type { Page } from "playwright";

export async function captureScreenshot(page: Page): Promise<string> {
  try {
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 32,
      fullPage: false,
      timeout: 8000,
    });
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  } catch {
    return "";
  }
}
