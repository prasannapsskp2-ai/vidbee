import type { VideoFormat } from '@shared/types'

interface GetDisplayFormatsInput {
  formats: VideoFormat[]
  type: 'video' | 'audio'
  codec?: string
}

interface DisplayFormatsResult {
  videoFormats: VideoFormat[]
  audioFormats: VideoFormat[]
}

/**
 * Return the formats that should stay visible in the picker.
 *
 * Issue refs: #312.
 */
export const getDisplayFormats = ({
  formats,
  type,
  codec
}: GetDisplayFormatsInput): DisplayFormatsResult => {
  const isVideoFormat = (format: VideoFormat): boolean =>
    format.video_ext !== 'none' && !!format.vcodec && format.vcodec !== 'none'
  const isAudioFormat = (format: VideoFormat): boolean =>
    !!format.acodec &&
    format.acodec !== 'none' &&
    (format.video_ext === 'none' || !format.video_ext || !format.vcodec || format.vcodec === 'none')

  const getFileSize = (format: VideoFormat): number =>
    format.filesize ?? format.filesize_approx ?? 0
  const sortVideoFormatsByQuality = (a: VideoFormat, b: VideoFormat): number => {
    const heightDiff = (b.height ?? 0) - (a.height ?? 0)
    if (heightDiff !== 0) {
      return heightDiff
    }

    const fpsDiff = (b.fps ?? 0) - (a.fps ?? 0)
    if (fpsDiff !== 0) {
      return fpsDiff
    }

    const sizeDiff = getFileSize(b) - getFileSize(a)
    if (sizeDiff !== 0) {
      return sizeDiff
    }

    return a.format_id.localeCompare(b.format_id)
  }
  const sortAudioFormatsByQuality = (a: VideoFormat, b: VideoFormat): number => {
    const qualityDiff = (b.tbr ?? b.quality ?? 0) - (a.tbr ?? a.quality ?? 0)
    if (qualityDiff !== 0) {
      return qualityDiff
    }

    const sizeDiff = getFileSize(b) - getFileSize(a)
    if (sizeDiff !== 0) {
      return sizeDiff
    }

    return a.format_id.localeCompare(b.format_id)
  }
  const getVideoGroupKey = (format: VideoFormat): string => {
    const height = format.height ?? 0
    const fps = format.fps ?? 0
    const ext = format.ext || 'unknown'
    const vcodec = format.vcodec || 'unknown'
    return `${height}:${fps}:${ext}:${vcodec}`
  }

  const videos = formats.filter(isVideoFormat)
  const audios = formats.filter(isAudioFormat)
  const groupedByVideoKey = new Map<string, VideoFormat[]>()

  for (const format of videos) {
    const groupKey = getVideoGroupKey(format)
    const existing = groupedByVideoKey.get(groupKey) ?? []
    existing.push(format)
    groupedByVideoKey.set(groupKey, existing)
  }

  const videoFormats = Array.from(groupedByVideoKey.values())
    .map((group) => group.sort(sortVideoFormatsByQuality)[0])
    .sort(sortVideoFormatsByQuality)

  if (type !== 'audio' || codec !== 'auto') {
    return {
      videoFormats,
      audioFormats: [...audios].sort(sortAudioFormatsByQuality)
    }
  }

  const groupedByAudioQuality = new Map<string, VideoFormat[]>()
  for (const format of audios) {
    const groupKey = format.tbr
      ? `tbr_${format.tbr}`
      : format.quality
        ? `quality_${format.quality}`
        : 'unknown'
    const existing = groupedByAudioQuality.get(groupKey) ?? []
    existing.push(format)
    groupedByAudioQuality.set(groupKey, existing)
  }

  const audioFormats = Array.from(groupedByAudioQuality.values())
    .map((group) => group.sort(sortAudioFormatsByQuality)[0])
    .sort(sortAudioFormatsByQuality)

  return { videoFormats, audioFormats }
}
