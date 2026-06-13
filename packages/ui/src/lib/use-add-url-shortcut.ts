import { useRef } from 'react'
import { useMountEffect } from './use-mount-effect'

/**
 * Checks whether the keyboard event matches the global Add URL paste shortcut.
 *
 * @param event Keyboard event to inspect.
 * @returns True when the event is Ctrl/Cmd + V without extra modifiers.
 */
export const isAddUrlShortcutEvent = (
  event: Pick<
    KeyboardEvent,
    'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'
  >
): boolean => {
  if (event.repeat || event.altKey || event.shiftKey) {
    return false
  }

  const isPasteKey = event.key.toLowerCase() === 'v' || event.code === 'KeyV'
  return isPasteKey && (event.ctrlKey || event.metaKey)
}

/**
 * Checks whether the keyboard shortcut should be ignored for the current event target.
 *
 * @param target Event target from the keyboard event.
 * @returns True when the target is an editable element that should keep native paste behavior.
 */
export const shouldIgnoreAddUrlShortcutTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true
  }

  return (
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"], [role="textbox"]'))
  )
}

interface UseAddUrlShortcutOptions {
  enabled: boolean
  onTrigger: () => Promise<void> | void
}

/**
 * Registers a global Ctrl/Cmd + V shortcut that opens the shared Add URL flow.
 *
 * @param options Hook options controlling whether the shortcut is active and how it is handled.
 */
export const useAddUrlShortcut = ({ enabled, onTrigger }: UseAddUrlShortcutOptions): void => {
  const enabledRef = useRef(enabled)
  const onTriggerRef = useRef(onTrigger)
  enabledRef.current = enabled
  onTriggerRef.current = onTrigger

  useMountEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current) {
        return
      }

      if (!isAddUrlShortcutEvent(event)) {
        return
      }

      if (shouldIgnoreAddUrlShortcutTarget(event.target)) {
        return
      }

      event.preventDefault()
      void onTriggerRef.current()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })
}
