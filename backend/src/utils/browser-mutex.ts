/**
 * Simple async mutex for serializing browser operations.
 * Only one operation can hold the lock at a time. Others wait in FIFO order.
 *
 * This prevents concurrent browser operations from stomping on each other
 * (e.g., a preview flood blocking a retrieve-csv navigation).
 */
export class BrowserMutex {
  private locked = false;
  private queue: Array<{ resolve: (release: () => void) => void; label: string }> = [];

  async acquire(label: string): Promise<() => void> {
    return new Promise((resolve) => {
      if (!this.locked) {
        this.locked = true;
        console.log(`[Mutex] Acquired by: ${label}`);
        resolve(this.createRelease(label));
      } else {
        console.log(`[Mutex] Queued: ${label} (position: ${this.queue.length + 1})`);
        this.queue.push({ resolve, label });
      }
    });
  }

  private createRelease(label: string): () => void {
    let released = false;
    return () => {
      if (released) return; // Prevent double-release
      released = true;
      console.log(`[Mutex] Released by: ${label} (queue: ${this.queue.length})`);
      const next = this.queue.shift();
      if (next) {
        // Next in queue acquires immediately
        console.log(`[Mutex] Acquired by: ${next.label} (from queue)`);
        process.nextTick(() => next.resolve(this.createRelease(next.label)));
      } else {
        this.locked = false;
      }
    };
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get queueLength(): number {
    return this.queue.length;
  }
}
