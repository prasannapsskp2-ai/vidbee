/**
 * Tiny single-owner async mutex. Used by the Scheduler so that
 * dispatch / cancel / pause never overlap and slot accounting cannot
 * be raced by concurrent `add()` calls.
 */
export class AsyncMutex {
  private locked = false
  private readonly waiters: Array<() => void> = []

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true
      return () => this.release()
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.locked = true
    return () => this.release()
  }

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }

  private release(): void {
    if (!this.locked) {
      throw new Error('AsyncMutex: release called while not locked')
    }
    this.locked = false
    const next = this.waiters.shift()
    if (next) next()
  }
}
