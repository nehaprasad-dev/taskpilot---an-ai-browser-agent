import type { CompanyResearch } from "@/agent/types";

export function mergeCompanies(
  existing: CompanyResearch[],
  incoming: CompanyResearch[]
): CompanyResearch[] {
  const map = new Map<string, CompanyResearch>();

  for (const company of existing) {
    map.set(normalizeName(company.name), company);
  }

  for (const company of incoming) {
    const key = normalizeName(company.name);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, company);
      continue;
    }

    map.set(key, {
      name: prev.name || company.name,
      website: preferUrl(prev.website, company.website),
      product: prefer(prev.product, company.product),
      targetCustomer: prefer(prev.targetCustomer, company.targetCustomer),
      pricing: prefer(prev.pricing, company.pricing),
      funding: prefer(prev.funding, company.funding),
      engineeringOpenings: prefer(
        prev.engineeringOpenings,
        company.engineeringOpenings
      ),
      notes: [prev.notes, company.notes].filter(Boolean).join(" | ") || undefined,
      sources: dedupeSources([...(prev.sources || []), ...(company.sources || [])]),
    });
  }

  return Array.from(map.values());
}

function normalizeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function preferUrl(a?: string, b?: string) {
  const wiki = (url?: string) => Boolean(url && /wikipedia\.org|wikimedia\.org/i.test(url));
  if (a && !wiki(a) && a.toLowerCase() !== "not found") return a;
  if (b && !wiki(b) && b.toLowerCase() !== "not found") return b;
  return prefer(a, b);
}

function prefer(a?: string, b?: string) {
  if (a && a.toLowerCase() !== "not found" && !isChromeText(a)) return a;
  if (b && b.toLowerCase() !== "not found" && !isChromeText(b)) return b;
  return undefined;
}

function dedupeSources(sources: { title: string; url: string }[]) {
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const source of sources) {
    if (!source.url || seen.has(source.url)) continue;
    seen.add(source.url);
    out.push(source);
  }
  return out;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isJunkCompanyName(name: string) {
  const n = name.toLowerCase().trim();
  if (n.length < 3) return true;
  if (
    /^(accounting|bookkeeping|finance|software|wikipedia|search|contents|article|company|startup|startups|product|pricing|careers|sage 50|sage50|peachtree)$/i.test(
      n
    )
  ) {
    return true;
  }
  if (n.includes("sage 50") || n === "sage group") return true;
  if (
    /adempiere|ofbiz|gnucash|compiere|sql-?ledger|apache|gnu cash|openbravo|tryton|postbooks/.test(
      n
    )
  ) {
    return true;
  }
  return (
    n.includes("anthropic") ||
    n.includes("openai") ||
    n.includes("softbank") ||
    n.includes("deepseek") ||
    n.includes("does not exist") ||
    n.includes("wikipedia") ||
    n.includes("search results") ||
    n.includes("jump to content") ||
    n === "ai accounting" ||
    /^list of /.test(n)
  );
}

export function isChromeText(value?: string) {
  if (!value) return false;
  const t = value.toLowerCase();
  return /jump to content|main menu|appearance|create account|log in|toggle the table of contents|original author|programming language|java 1\.|postgresql|mysql|mw-parser|infobox|wikipedia/.test(
    t
  );
}

function visitedHost(visitedUrls: string[], url: string) {
  const host = hostOf(url);
  if (!host) return false;
  return visitedUrls.some((visited) => hostOf(visited) === host);
}

export function filterVerifiedCompanies(
  companies: CompanyResearch[],
  visitedUrls: string[]
): CompanyResearch[] {
  return companies
    .filter((company) => company.name && !isJunkCompanyName(company.name))
    .map((company) => {
      const sources = (company.sources || []).filter((source) =>
        visitedHost(visitedUrls, source.url)
      );
      const officialSources = sources.filter(
        (source) =>
          !/wikipedia\.org|wikimedia\.org/i.test(source.url) &&
          !/403|404|forbidden|not found|access denied/i.test(source.title)
      );
      const wikiOk = process.env.NODE_ENV === "production";
      const keptSources =
        officialSources.length > 0 ? officialSources : wikiOk ? sources : officialSources;
      const websiteCandidate =
        company.website && !/wikipedia\.org|wikimedia\.org/i.test(company.website)
          ? company.website.startsWith("http")
            ? company.website
            : `https://${company.website}`
          : officialSources[0]?.url;
      const website =
        websiteCandidate &&
        (wikiOk || visitedHost(visitedUrls, websiteCandidate))
          ? websiteCandidate
          : keptSources[0]?.url;
      return {
        ...company,
        sources: keptSources,
        website,
        product: isChromeText(company.product) ? undefined : company.product,
      };
    })
    .filter(
      (company) =>
        company.sources.length > 0 &&
        Boolean(
          company.product ||
            company.targetCustomer ||
            company.pricing ||
            company.funding ||
            company.engineeringOpenings
        ) &&
        !/adempiere|ofbiz|gnucash|compiere|apache/i.test(company.name)
    );
}

export function fieldCoverage(companies: CompanyResearch[]) {
  const fields = [
    "website",
    "product",
    "targetCustomer",
    "pricing",
    "funding",
    "engineeringOpenings",
  ] as const;

  const collected: string[] = [];
  const missing: string[] = [];

  for (const field of fields) {
    const filled = companies.filter((c) => Boolean(c[field])).length;
    if (companies.length > 0 && filled >= Math.ceil(companies.length * 0.6)) {
      collected.push(field);
    } else {
      missing.push(field);
    }
  }

  return { collected, missing };
}
