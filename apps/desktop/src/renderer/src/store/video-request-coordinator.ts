export interface VideoInfoRequestCoordinator {
  beginRequest: () => number
  isCurrentRequest: (requestId: number) => boolean
}

/**
 * Create a request coordinator that ignores stale video-info responses.
 *
 * Issue refs: #354.
 */
export const createVideoInfoRequestCoordinator = (): VideoInfoRequestCoordinator => {
  let currentRequestId = 0

  return {
    beginRequest: () => {
      currentRequestId += 1
      return currentRequestId
    },
    isCurrentRequest: (requestId: number) => requestId === currentRequestId
  }
}
