"use client";

type Props = {
  screenshot?: string;
  url?: string;
  title?: string;
  excerpt?: string;
};

function looksEmpty(excerpt?: string, screenshot?: string) {
  if (!screenshot) return true;
  const text = (excerpt || "").toLowerCase();
  return (
    text.includes("if this persists") ||
    text.includes("anonymized error code") ||
    text.includes("solve the challenge") ||
    text.includes("one last step") ||
    text.trim().length < 30
  );
}

export function BrowserPreview({ screenshot, url, title, excerpt }: Props) {
  const blocked = looksEmpty(excerpt, screenshot);

  return (
    <section className="panel browser-panel">
      <header className="panel__header">
        <h2>Live browser</h2>
        {url ? (
          <a className="browser-url" href={url} target="_blank" rel="noreferrer">
            {title ? `${title} · ` : ""}
            {url}
          </a>
        ) : (
          <span className="muted">No page yet</span>
        )}
      </header>
      <div className="browser-frame">
        <div className="browser-chrome" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="browser-viewport">
          {screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={screenshot} alt={title || "Current browser page"} />
          ) : (
            <div className="browser-empty">
              <p>The agent&apos;s viewport will appear here as it navigates.</p>
            </div>
          )}
          {blocked && url ? (
            <div className="browser-blocked">
              <p>
                This page did not render useful content (search engines often
                block automated browsers). The agent will move to Wikipedia and
                company sites instead.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
