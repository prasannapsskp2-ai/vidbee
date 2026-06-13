/**
 * Resolve the yt-dlp release asset names used by desktop packaging scripts.
 */
export const YTDLP_PLATFORM_ASSETS = {
  win32: {
    asset: 'yt-dlp.exe',
    output: 'yt-dlp.exe'
  },
  darwin: {
    asset: 'yt-dlp_macos',
    output: 'yt-dlp_macos'
  },
  linux: {
    // Sentry issue VIDBEE-397 showed the generic `yt-dlp` zipapp can fall back
    // to the user's Python runtime and crash on Python 3.8. Desktop needs the
    // standalone Linux executable instead.
    asset: 'yt-dlp_linux',
    output: 'yt-dlp_linux'
  }
}
