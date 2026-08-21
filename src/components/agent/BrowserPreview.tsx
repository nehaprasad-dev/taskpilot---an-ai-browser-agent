"use client";

type Props = {
  screenshot?: string;
  url?: string;
  title?: string;
};

export function BrowserPreview({ screenshot, url, title }: Props) {
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
        </div>
      </div>
    </section>
  );
}
