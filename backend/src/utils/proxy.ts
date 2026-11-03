import tls from 'node:tls'
import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher, type buildConnector } from 'undici'
import { SocksClient } from 'socks'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { ConnectedAccount } from '@prisma/client'
import { decryptText } from './crypto.js'

// Accepted proxy URL schemes. socks5h resolves host names on the proxy; the undici path always
// lets the proxy resolve them, while socks-proxy-agent (googleapis path) honours the difference.
export const SUPPORTED_PROXY_PROTOCOLS = ['http:', 'https:', 'socks5:', 'socks5h:']

const proxyDispatcherCache = new Map<string, Dispatcher>()
const socksAgentCache = new Map<string, SocksProxyAgent>()

export function isSocksProxy(proxyUrl: string) {
  return /^socks5h?:/i.test(proxyUrl)
}

export function getAccountProxyUrl(account: Pick<ConnectedAccount, 'proxyUrlEncrypted'> | { proxyUrlEncrypted?: string | null }): string | null {
  if (!account.proxyUrlEncrypted) return null
  try {
    return decryptText(account.proxyUrlEncrypted)
  } catch {
    return null
  }
}

export function maskProxyUrl(proxyUrl: string | null | undefined): string | null {
  if (!proxyUrl) return null
  try {
    const url = new URL(proxyUrl)
    if (url.username || url.password) {
      url.username = '***'
      url.password = '***'
    }
    return url.toString()
  } catch {
    return proxyUrl.replace(/:\/\/[^@]+@/, '://***:***@')
  }
}

// Opens each connection through the SOCKS5 proxy (then TLS for https). Used as the `connect` of a
// plain undici Agent, which keeps one pool per origin. undici's own Socks5ProxyAgent (7.27) is not
// used: it sends requests for a second host down the tunnel opened for the first one.
function socksConnector(proxyUrl: string): buildConnector.connector {
  const proxy = new URL(proxyUrl)
  return (options, callback) => {
    const https = options.protocol === 'https:'
    SocksClient.createConnection({
      proxy: {
        host: proxy.hostname,
        port: Number(proxy.port) || 1080,
        type: 5,
        userId: proxy.username ? decodeURIComponent(proxy.username) : undefined,
        password: proxy.password ? decodeURIComponent(proxy.password) : undefined,
      },
      command: 'connect',
      // The host name is passed to the proxy, which resolves it (socks5h behaviour, also used for socks5).
      destination: { host: options.hostname, port: Number(options.port) || (https ? 443 : 80) },
      timeout: 15_000,
    }).then(({ socket }) => {
      if (!https) return callback(null, socket)
      const secure = tls.connect({ socket, servername: options.servername || options.hostname, ALPNProtocols: ['http/1.1'] })
      secure.once('secureConnect', () => callback(null, secure))
      secure.once('error', (error) => callback(error, null))
    }, (error: Error) => callback(error, null))
  }
}

/** Dispatcher for undici/global fetch calls (file streaming, resumable uploads). */
export function getUndiciDispatcher(proxyUrl: string | null | undefined): Dispatcher | undefined {
  if (!proxyUrl) return undefined
  let agent = proxyDispatcherCache.get(proxyUrl)
  if (!agent) {
    agent = isSocksProxy(proxyUrl) ? new Agent({ connect: socksConnector(proxyUrl) }) : new ProxyAgent(proxyUrl)
    proxyDispatcherCache.set(proxyUrl, agent)
  }
  return agent
}

/**
 * Options for googleapis/gaxios. gaxios makes its own http(s) proxy agent from `proxy`, but knows
 * nothing about SOCKS, so a SOCKS proxy is handed over as a ready-made `agent`.
 */
export function gaxiosProxyOptions(proxyUrl: string | null | undefined): { proxy?: string; agent?: SocksProxyAgent } {
  if (!proxyUrl) return {}
  if (!isSocksProxy(proxyUrl)) return { proxy: proxyUrl }
  let agent = socksAgentCache.get(proxyUrl)
  if (!agent) {
    agent = new SocksProxyAgent(proxyUrl)
    socksAgentCache.set(proxyUrl, agent)
  }
  return { agent }
}

export function applyProxyToOAuthClient(client: any, proxyUrl: string | null | undefined) {
  if (!proxyUrl || !client) return
  if (client.transporter) {
    client.transporter.defaults = {
      ...client.transporter.defaults,
      ...gaxiosProxyOptions(proxyUrl),
    }
  }
}

export async function testProxyConnectivity(proxyUrl: string): Promise<{ success: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  try {
    const dispatcher = getUndiciDispatcher(proxyUrl)
    const response = await undiciFetch('https://www.google.com/generate_204', {
      dispatcher,
      signal: AbortSignal.timeout(8000),
    })
    const latencyMs = Date.now() - start
    if (response.ok || response.status === 204) {
      return { success: true, latencyMs }
    }
    return { success: false, latencyMs, error: `Proxy returned HTTP status ${response.status}` }
  } catch (err: any) {
    // undici reports the real reason (refused, auth failed, ...) on err.cause.
    const reason = err?.cause?.message ? `${err.message}: ${err.cause.message}` : err?.message
    return { success: false, latencyMs: Date.now() - start, error: reason || 'Connection failed' }
  }
}
