"use client";

type Props = {
  screenshot?: string;
  url?: string;
  title?: string;
  excerpt?: string;
};

function looksEmpty(excerpt?: string, screenshot?: string, url?: string) {
  if (url?.includes("wikipedia.org")) return false;
  if (!screenshot) return false;
  const text = (excerpt || "").toLowerCase();
  return (
    text.includes("if this persists") ||
    text.includes("anonymized error code") ||
    text.includes("solve the challenge") ||
    text.includes("one last step")
  );
}

export function BrowserPreview({ screenshot, url, title, excerpt }: Props) {
  const blocked = looksEmpty(excerpt, screenshot, url);
  const loadFailed =
    title === "Could not load page" ||
    Boolean(excerpt && /internet|DNS|could not load/i.test(excerpt));

  return (
    <section className="panel browser-panel">
      <header className="panel__header">
        <h2>Live browser</h2>
        {title ? <span className="panel__meta">{title}</span> : null}
      </header>
      <div className="browser-frame">
        <div className="browser-chrome">
          <span className="browser-chrome__dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          {url ? (
            <a
              className="browser-chrome__url"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              {url}
            </a>
          ) : (
            <span className="browser-chrome__url browser-chrome__url--empty">
              about:blank
            </span>
          )}
        </div>
        <div className="browser-viewport">
          {screenshot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={url || screenshot.slice(-24)}
              src={screenshot}
              alt={title || "Current browser page"}
            />
          ) : (
            <div className="browser-empty">
              <p>
                {loadFailed
                  ? excerpt || "The browser could not load this page."
                  : "The agent's viewport will appear here as it navigates."}
              </p>
            </div>
          )}
          {blocked && url && screenshot ? (
            <div className="browser-blocked">
              <p>
                This page did not render useful content. The agent will leave it
                and try Wikipedia or an official site instead.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
