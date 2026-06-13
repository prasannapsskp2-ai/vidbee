const UTM_SOURCE = 'vidbee-desktop'
const UTM_MEDIUM = 'app'

/**
 * Append UTM parameters to vidbee.org URLs opened from the desktop app.
 * Non-vidbee.org URLs and unparseable strings are returned unchanged.
 * @param url - Target URL to tag
 * @returns URL with utm_source/utm_medium when the host is vidbee.org or a subdomain
 */
export function withDesktopUtm(url: string): string {
  try {
    const parsed = new URL(url)
    const isVidbeeHost = parsed.hostname === 'vidbee.org' || parsed.hostname.endsWith('.vidbee.org')
    if (!isVidbeeHost) {
      return url
    }
    parsed.searchParams.set('utm_source', UTM_SOURCE)
    parsed.searchParams.set('utm_medium', UTM_MEDIUM)
    return parsed.toString()
  } catch {
    return url
  }
}
