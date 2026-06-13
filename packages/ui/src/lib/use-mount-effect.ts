import { useEffect } from 'react'

/**
 * Run setup code once on mount and clean it up on unmount.
 *
 * @param effect The mount-time setup logic.
 */
export const useMountEffect = (effect: () => void | (() => void)): void => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, [])
}
