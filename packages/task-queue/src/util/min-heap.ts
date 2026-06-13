/**
 * Generic min-heap ordered by a comparator. Used for:
 *  - Scheduler ready queue (priority-then-FIFO).
 *  - RetryScheduler timer heap (nextRetryAt asc).
 *
 * Pushed elements are not deduplicated; callers wrap their items so that
 * `remove()` can match by id.
 */
export class MinHeap<T> {
  private readonly data: T[] = []
  constructor(private readonly cmp: (a: T, b: T) => number) {}

  size(): number {
    return this.data.length
  }

  peek(): T | undefined {
    return this.data[0]
  }

  push(item: T): void {
    this.data.push(item)
    this.siftUp(this.data.length - 1)
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined
    const top = this.data[0]!
    const last = this.data.pop()!
    if (this.data.length > 0) {
      this.data[0] = last
      this.siftDown(0)
    }
    return top
  }

  /**
   * Remove the first element matching `pred`. O(n). Used for cancel/pause
   * which are rare relative to dispatch.
   */
  remove(pred: (item: T) => boolean): T | undefined {
    const idx = this.data.findIndex(pred)
    if (idx < 0) return undefined
    const removed = this.data[idx]
    const last = this.data.pop()!
    if (idx < this.data.length) {
      this.data[idx] = last
      this.siftDown(idx)
      this.siftUp(idx)
    }
    return removed
  }

  toArray(): readonly T[] {
    return this.data
  }

  private siftUp(idx: number): void {
    let i = idx
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.cmp(this.data[i]!, this.data[parent]!) >= 0) return
      ;[this.data[i], this.data[parent]] = [this.data[parent]!, this.data[i]!]
      i = parent
    }
  }

  private siftDown(idx: number): void {
    const n = this.data.length
    let i = idx
    while (true) {
      const l = i * 2 + 1
      const r = i * 2 + 2
      let smallest = i
      if (l < n && this.cmp(this.data[l]!, this.data[smallest]!) < 0) smallest = l
      if (r < n && this.cmp(this.data[r]!, this.data[smallest]!) < 0) smallest = r
      if (smallest === i) return
      ;[this.data[i], this.data[smallest]] = [
        this.data[smallest]!,
        this.data[i]!
      ]
      i = smallest
    }
  }
}
