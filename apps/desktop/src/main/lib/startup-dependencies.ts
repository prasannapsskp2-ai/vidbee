interface StartupLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
}

interface OptionalToolParams {
  initialize: () => Promise<void>
  label: string
  logger: StartupLogger
}

/**
 * Initializes an optional startup tool without treating missing binaries as an app fault.
 */
export const initializeOptionalTool = async ({
  initialize,
  label,
  logger
}: OptionalToolParams): Promise<boolean> => {
  logger.info(`Initializing ${label}...`)

  try {
    await initialize()
    logger.info(`${label} initialized successfully`)
    return true
  } catch (error) {
    logger.warn(`Optional ${label} is unavailable at startup:`, error)
    return false
  }
}
