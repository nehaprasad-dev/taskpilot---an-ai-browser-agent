export function isNetworkFailure(message: string): boolean {
  return /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION_REFUSED|ERR_ADDRESS_UNREACHABLE|ERR_CONNECTION_TIMED_OUT|ERR_CONNECTION_RESET|net::ERR_/i.test(
    message
  );
}

export function networkFailureMessage(raw: string): string {
  if (/ERR_INTERNET_DISCONNECTED/i.test(raw)) {
    return "The automated browser has no internet connection. Check Wi‑Fi, then start a new research. This is not a search-engine block.";
  }
  if (/ERR_NAME_NOT_RESOLVED/i.test(raw)) {
    return "DNS lookup failed — the browser could not resolve the site. Check your network or DNS.";
  }
  return `The browser could not load the page (${raw.split("\n")[0]?.slice(0, 160)}).`;
}
