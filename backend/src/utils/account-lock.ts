// Full syncs and live folder refreshes both create file/folder rows for an account. Running them at the
// same time (page load + auto-sync, double clicks) would insert the same Drive item twice, so work on one
// account is queued.
const queues = new Map<string, Promise<unknown>>()

export function withAccountLock<T>(accountId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(accountId) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(task)
  const tail = run.catch(() => undefined)
  queues.set(accountId, tail)
  tail.then(() => {
    if (queues.get(accountId) === tail) queues.delete(accountId)
  })
  return run
}
