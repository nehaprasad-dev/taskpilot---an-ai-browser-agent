import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

let sharedBrowser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    sharedBrowser = await chromium.launch({
      headless: true,
      chromiumSandbox: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        // Soft software rendering — more reliable screenshots on small VMs
        // than --disable-gpu alone, which often yields empty captures.
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--disable-http2",
        "--font-render-hinting=none",
      ],
    });
  }
  return sharedBrowser;
}

export async function createSessionContext(): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    // Smaller than local desktop — keeps Render memory + SSE payloads lighter.
    viewport: { width: 1024, height: 640 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: true,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const isProd = process.env.NODE_ENV === "production";
  page.setDefaultTimeout(isProd ? 8000 : 10000);
  page.setDefaultNavigationTimeout(
    Number(process.env.NAV_TIMEOUT_MS || (isProd ? 12000 : 20000))
  );
  return { context, page };
}

export async function closeSharedBrowser() {
  if (sharedBrowser) {
    await sharedBrowser.close().catch(() => undefined);
    sharedBrowser = null;
  }
}
