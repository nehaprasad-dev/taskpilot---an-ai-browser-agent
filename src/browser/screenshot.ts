import type { Page } from "playwright";

export async function captureScreenshot(page: Page): Promise<string> {
  try {
    const buffer = await page.screenshot({
      type: "jpeg",
      quality: 40,
      fullPage: false,
      timeout: 4000,
    });
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  } catch {
    return "";
  }
}
