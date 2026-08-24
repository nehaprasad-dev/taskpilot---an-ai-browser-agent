"use client";

import type { ResearchResult } from "@/agent/types";

function Cell({ value }: { value?: string }) {
  if (!value) return <span className="cell-empty">Not found</span>;
  return <>{value}</>;
}

export function ResearchTable({ result }: { result: ResearchResult }) {
  return (
    <section className="panel results-panel">
      <header className="panel__header results-header">
        <div>
          <h2>Research complete</h2>
          <p className="muted">{result.summary}</p>
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
        <p className="muted">No structured company rows were extracted.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>Product</th>
                <th>Customer</th>
                <th>Pricing</th>
                <th>Funding</th>
                <th>Hiring</th>
                <th>Sources</th>
              </tr>
            </thead>
            <tbody>
              {result.companies.map((company) => (
                <tr key={company.name}>
                  <td>
                    <div className="company-cell">
                      <strong>{company.name}</strong>
                      {company.website ? (
                        <a href={company.website} target="_blank" rel="noreferrer">
                          {company.website.replace(/^https?:\/\//, "")}
                        </a>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <Cell value={company.product} />
                  </td>
                  <td>
                    <Cell value={company.targetCustomer} />
                  </td>
                  <td>
                    <Cell value={company.pricing} />
                  </td>
                  <td>
                    <Cell value={company.funding} />
                  </td>
                  <td>
                    <Cell value={company.engineeringOpenings} />
                  </td>
                  <td>
                    <div className="source-list">
                      {company.sources.length ? (
                        company.sources.map((source) => (
                          <a
                            key={source.url}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.title || "View source"}
                          </a>
                        ))
                      ) : (
                        <span className="cell-empty">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
