// Optimize libuv OS threadpool size for heavy concurrent I/O (video streaming, chunk reads, crypto)
// Must be set before any asynchronous I/O or crypto modules are initialized
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '64'
}

import cluster from 'node:cluster'
import os from 'node:os'
import { env } from './config/env.js'
import { initDatabaseConcurrency } from './config/prisma.js'

// Multi-thread / Multi-worker Cluster Configuration
const cpuCount = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
const envWorkers = parseInt(process.env.WEB_CONCURRENCY || process.env.WORKER_COUNT || '', 10)

// In production or when forced, default to all available CPU cores (capped between 2 and 8).
// In development, default to 1 worker for easy debugging unless WEB_CONCURRENCY is specified.
const isProduction = process.env.NODE_ENV === 'production'
const numWorkers = !isNaN(envWorkers) && envWorkers >= 1
  ? envWorkers
  : isProduction || process.env.ENABLE_CLUSTER === 'true'
    ? Math.min(Math.max(cpuCount, 2), 8)
    : 1

if (cluster.isPrimary && numWorkers > 1) {
  console.log(`[cluster] Primary process ${process.pid} initialized on ${cpuCount} CPU cores.`)
  console.log(`[cluster] Spawning ${numWorkers} worker threads with UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE}...`)

  // Initialize SQLite WAL mode and concurrency pragmas on primary
  initDatabaseConcurrency().catch(() => undefined)

  // Fork worker threads
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork()
  }

  // Relay IPC messages between workers (such as real-time cache progress)
  cluster.on('message', (worker, message) => {
    if (message && typeof message === 'object') {
      for (const id in cluster.workers) {
        const w = cluster.workers[id]
        if (w && w.id !== worker.id) {
          try {
            w.send(message)
          } catch {}
        }
      }
    }
  })

  // Auto-respawn any crashed worker to guarantee 100% continuous uptime
  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[cluster] Worker ${worker.process.pid} died (${signal || code}). Auto-restarting worker...`)
    cluster.fork()
  })
} else {
  // Worker thread (or single-process mode)
  initDatabaseConcurrency().catch(() => undefined)

  // Lazy import Express app inside worker
  import('./app.js').then(({ app }) => {
    const server = app.listen(env.APP_PORT, () => {
      const label = cluster.isWorker ? `Worker ${process.pid}` : `Process ${process.pid}`
      console.log(`[server] ${label} running on http://localhost:${env.APP_PORT}`)
    })

    // HTTP Keep-Alive tuning for smoother streaming and lower latency
    server.keepAliveTimeout = 65_000
    server.headersTimeout = 66_000
  })
}
