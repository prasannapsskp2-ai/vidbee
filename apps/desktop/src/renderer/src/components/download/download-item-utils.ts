interface DoubleClickHistoryTarget {
  entryType: 'active' | 'history'
  fileExists: boolean
  status?: string
}

/**
 * Decide whether a history row should open the saved file on double click for issue #154.
 */
export const shouldOpenHistoryItemOnDoubleClick = ({
  entryType,
  fileExists,
  status
}: DoubleClickHistoryTarget): boolean => {
  return entryType === 'history' && fileExists && status === 'completed'
}
