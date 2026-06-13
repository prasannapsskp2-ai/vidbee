/**
 * Check whether a URL should be handled as a playlist-style resource.
 *
 * Issue ref: #316.
 */
export const isPlaylistLikeUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    const playlistQueryKeys = ['collection', 'list', 'playlist', 'set']
    if (
      playlistQueryKeys.some((key) => {
        return Boolean(parsed.searchParams.get(key)?.trim())
      })
    ) {
      return true
    }

    const pathname = parsed.pathname.toLowerCase()
    return ['/playlist', '/playlists/', '/collection/', '/collections/', '/sets/'].some((token) =>
      pathname.includes(token)
    )
  } catch {
    return false
  }
}
