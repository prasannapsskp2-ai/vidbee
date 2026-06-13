/**
 * Builds a favicon.im URL for a site domain.
 */
export function buildSiteIconUrl(domain: string): string {
  const normalizedDomain = domain.trim().toLowerCase()
  return `https://favicon.im/${encodeURIComponent(normalizedDomain)}`
}
