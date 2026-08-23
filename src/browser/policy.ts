import type { PageObservation } from "@/agent/types";

const BLOCKED_HOST =
  /techcrunch\.com|crunchbase\.com|pitchbook\.com|linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|reddit\.com|bing\.com|google\.com|duckduckgo\.com|yahoo\.com|forbes\.com|bloomberg\.com|reuters\.com|businessinsider\.com|wired\.com|theverge\.com|medium\.com/i;

const FAMOUS_LABS =
  /^(anthropic|openai|google|microsoft|meta|amazon|nvidia|deepmind|softbank|manus)$/i;

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isBlockedUrl(url: string): boolean {
  return BLOCKED_HOST.test(hostOf(url)) || BLOCKED_HOST.test(url);
}

export function isDeadPage(observation: PageObservation): boolean {
  const text = `${observation.title} ${observation.excerpt}`.toLowerCase();
  return (
    /404|page not found|lost this page|does not exist|not found \|/i.test(text) ||
    observation.title.trim() === "404"
  );
}

export function isWikipediaListPage(observation: PageObservation): boolean {
  return /\/wiki\/(list_of|comparison_of|accounting_software)/i.test(observation.url);
}

export function isUselessWikiPage(observation: PageObservation): boolean {
  const blob = `${observation.title} ${observation.url}`.toLowerCase();
  if (/unicorn|billionaire|fortune_500|list_of_countries|nasdaq|s%26p|s&p_500/.test(blob)) {
    return true;
  }
  const path = observation.url.split("/wiki/")[1]?.split("#")[0] || "";
  const slug = decodeURIComponent(path).replace(/_/g, " ");
  return /^(accounting|bookkeeping|finance|software|artificial intelligence|startup company|startup|sage 50|sage group)$/i.test(
    slug
  ) || /microsoft dynamics|dynamics 365|adempiere|ofbiz|gnucash|compiere|sql-ledger|ledger.?smb/i.test(slug);
}

export function isAllowedResearchUrl(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (isBlockedUrl(url)) return false;
  if (host.endsWith("wikipedia.org")) return true;
  if (host.endsWith("wikimedia.org")) return false;
  return true;
}

export function isFamousAiLab(name: string, goal: string): boolean {
  if (FAMOUS_LABS.test(goal.replace(/\s+/g, ""))) return false;
  const compact = name.toLowerCase().replace(/[^a-z]/g, "");
  return /^(anthropic|openai|google|microsoft|meta|amazon|nvidia|deepmind|softbank|manus)$/.test(
    compact
  );
}

export function isIncumbentVendor(name: string): boolean {
  const n = name.toLowerCase();
  return /microsoft|dynamics\s*365|\bsap\b|s\/4hana|oracle|netsuite|intuit|quickbooks|peachtree|\bibm\b|sage group|sage 50|sage intacct|\bmyob\b|epicor|\binfor\b|workday|salesforce/.test(
    n
  );
}

export function isIncumbentHost(url: string): boolean {
  const host = hostOf(url);
  return /microsoft\.com|sap\.com|oracle\.com|intuit\.com|ibm\.com|salesforce\.com|workday\.com|netsuite\.com|apache\.org|gnu\.org|sourceforge\.net/.test(
    host
  );
}

export function isOpenSourceErp(name: string): boolean {
  const n = name.toLowerCase();
  return /adempiere|ofbiz|\bgnu\b|gnucash|compiere|sql-?ledger|ledger.?smb|postbooks|tryton|openbravo|apache|odoo|erpnext|manager\.io|akaunting/.test(
    n
  );
}

/** Names to open on their official sites. Facts are read from those pages, not invented here. */
export function cloudAccountingLookups(goal: string): string[] {
  if (!/account|bookkeep/i.test(goal)) return [];
  return ["Xero", "FreshBooks", "Wave", "Zoho Books", "FreeAgent"];
}

export function officialSiteForName(name: string): string | undefined {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sites: Record<string, string> = {
    xero: "https://www.xero.com",
    xerolimited: "https://www.xero.com",
    freshbooks: "https://www.freshbooks.com",
    wave: "https://www.waveapps.com",
    waveaccounting: "https://www.waveapps.com",
    waveapps: "https://www.waveapps.com",
    zohobooks: "https://www.zoho.com/books/",
    zoho: "https://www.zoho.com/books/",
    freeagent: "https://www.freeagent.com",
  };
  return sites[compact];
}
