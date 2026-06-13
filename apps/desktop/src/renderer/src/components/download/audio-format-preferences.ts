interface AudioFormatLike {
  format_id: string
  language?: string
}

/**
 * Pick the best matching audio format id for a saved language preference from issue #60.
 */
export const pickPreferredAudioFormatId = (
  formats: AudioFormatLike[],
  preferredLanguage?: string
): string | undefined => {
  if (formats.length === 0) {
    return undefined
  }

  const normalizedPreferredLanguage = preferredLanguage?.trim().toLowerCase()
  if (!normalizedPreferredLanguage) {
    return formats[0]?.format_id
  }

  const exactMatch = formats.find(
    (format) => format.language?.trim().toLowerCase() === normalizedPreferredLanguage
  )
  if (exactMatch) {
    return exactMatch.format_id
  }

  const baseLanguageMatch = formats.find((format) => {
    const normalizedLanguage = format.language?.trim().toLowerCase()
    if (!normalizedLanguage) {
      return false
    }
    return (
      normalizedLanguage.startsWith(`${normalizedPreferredLanguage}-`) ||
      normalizedPreferredLanguage.startsWith(`${normalizedLanguage}-`)
    )
  })

  return baseLanguageMatch?.format_id ?? formats[0]?.format_id
}
