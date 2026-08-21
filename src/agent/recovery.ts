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
      website: prefer(prev.website, company.website),
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

function prefer(a?: string, b?: string) {
  if (a && a.toLowerCase() !== "not found") return a;
  return b || a;
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
