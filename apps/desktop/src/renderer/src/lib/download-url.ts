interface ResolveDownloadTargetUrlParams {
  fallbackUrl?: string
  webpageUrl?: string
}

/**
 * Resolve the URL that should be passed to yt-dlp for a single-item download.
 *
 * Sentry issues VIDBEE-28E and VIDBEE-28D showed some extractors return
 * metadata without `webpage_url`, so we must keep the original user input as
 * a fallback instead of sending an empty value into the download engine.
 *
 * @param params The extracted and fallback URL candidates.
 * @returns The best available non-empty download URL.
 */
export const resolveDownloadTargetUrl = ({
  fallbackUrl,
  webpageUrl
}: ResolveDownloadTargetUrlParams): string => {
  const preferredUrl = webpageUrl?.trim()
  if (preferredUrl) {
    return preferredUrl
  }

  return fallbackUrl?.trim() ?? ''
}
