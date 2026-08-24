"use client";

import type { ResearchResult } from "@/agent/types";

function Fact({
  label,
  value,
  className = "",
}: {
  label: string;
  value?: string;
  className?: string;
}) {
  return (
    <div className={`company-fact ${className}`}>
      <dt>{label}</dt>
      <dd>{value || <span className="cell-empty">Not found on visited pages</span>}</dd>
    </div>
  );
}

export function ResearchTable({ result }: { result: ResearchResult }) {
  return (
    <section className="results-panel">
      <header className="results-hero">
        <div className="results-hero__copy">
          <span className="results-hero__check" aria-hidden>
            ✓
          </span>
          <div>
          <h2>Research complete</h2>
            <p>{result.summary}</p>
          </div>
        </div>
        <div className="stats-row">
          <div>
            <strong>{result.stats.companiesResearched}</strong>
            <span>companies</span>
          </div>
          <div>
            <strong>{result.stats.sourcesChecked}</strong>
            <span>sources</span>
          </div>
          <div>
            <strong>{result.stats.pagesVisited}</strong>
            <span>pages</span>
          </div>
          <div>
            <strong>{result.stats.retries}</strong>
            <span>retries</span>
          </div>
        </div>
      </header>

      {result.companies.length === 0 ? (
        <div className="results-empty">No structured company rows were extracted.</div>
      ) : (
        <div className="company-grid">
          {result.companies.map((company, index) => (
            <article className="company-card" key={company.name}>
              <header className="company-card__header">
                <span className="company-card__index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{company.name}</h3>
                  {company.website ? (
                    <a href={company.website} target="_blank" rel="noreferrer">
                      {company.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      <span aria-hidden> ↗</span>
                    </a>
                  ) : null}
                </div>
              </header>

              <dl className="company-card__facts">
                <Fact label="Product" value={company.product} className="company-fact--wide" />
                <Fact label="Target customer" value={company.targetCustomer} />
                <Fact label="Pricing" value={company.pricing} />
                <Fact label="Funding" value={company.funding} />
                <Fact label="Engineering hiring" value={company.engineeringOpenings} />
              </dl>

              <footer className="company-card__sources">
                <span>Verified sources</span>
                <div>
                  {company.sources.length ? (
                    company.sources.slice(0, 4).map((source, sourceIndex) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        title={source.title}
                      >
                        Source {sourceIndex + 1} ↗
                      </a>
                    ))
                  ) : (
                    <span className="cell-empty">No official source retained</span>
                  )}
                  {company.sources.length > 4 ? (
                    <span className="source-more">+{company.sources.length - 4} more</span>
                  ) : null}
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
