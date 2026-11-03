import { BlockList, isIP } from 'node:net'
import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../config/prisma.js'

// Finds the real client IP behind Cloudflare and/or a reverse proxy such as nginx, without letting a
// client pick its own IP by sending X-Forwarded-For.
//
// "auto" mode (default when TRUST_PROXY is not set) trusts a forwarded-for hop only when it comes from
// a proxy: a private / loopback address (nginx, Docker, a LAN proxy) or a Cloudflare edge address.
// Walking X-Forwarded-For from the right, the first address that is neither is the client. A client
// on the internet that sends its own X-Forwarded-For only adds entries to the left of the real hop, so
// it changes nothing. A machine inside the private network can still set it, like any LAN proxy could.
// "off" trusts no header. TRUST_PROXY in the environment overrides both (see app.ts).

export type ProxyMode = 'auto' | 'off'

// https://www.cloudflare.com/ips/ (refreshed from there once a day; this list is the fallback).
const CLOUDFLARE_V4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22']
const CLOUDFLARE_V6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']

const PRIVATE_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '100.64.0.0/10', '169.254.0.0/16']
const PRIVATE_V6 = ['::1/128', 'fc00::/7', 'fe80::/10']

function buildList(v4: string[], v6: string[]) {
  const list = new BlockList()
  for (const range of v4) {
    const [net, prefix] = range.split('/')
    list.addSubnet(net, Number(prefix), 'ipv4')
  }
  for (const range of v6) {
    const [net, prefix] = range.split('/')
    list.addSubnet(net, Number(prefix), 'ipv6')
  }
  return list
}

let cloudflare = buildList(CLOUDFLARE_V4, CLOUDFLARE_V6)
const privateNets = buildList(PRIVATE_V4, PRIVATE_V6)

/** "::ffff:1.2.3.4" → "1.2.3.4"; anything that is not an IP → null. */
export function normalizeIp(value: string | undefined | null) {
  if (!value) return null
  let ip = value.trim()
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'))
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.split(':')[0]
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7)
  return isIP(ip) ? ip : null
}

function check(list: BlockList, ip: string) {
  const family = isIP(ip)
  return family === 4 ? list.check(ip, 'ipv4') : family === 6 ? list.check(ip, 'ipv6') : false
}

export const isCloudflareIp = (ip: string) => check(cloudflare, ip)
export const isPrivateIp = (ip: string) => check(privateNets, ip)
const isProxyHop = (ip: string) => isPrivateIp(ip) || isCloudflareIp(ip)

export type ClientIpResult = {
  ip: string
  /** The request passed through Cloudflare (a Cloudflare edge address was one of the hops). */
  viaCloudflare: boolean
  /** The request passed through a reverse proxy on a private address (nginx, Docker, LAN). */
  viaProxy: boolean
}

export function resolveClientIp(peerAddress: string | undefined, header: (name: string) => string | undefined): ClientIpResult {
  const peer = normalizeIp(peerAddress) ?? 'unknown'
  let viaCloudflare = peer !== 'unknown' && isCloudflareIp(peer)
  let viaProxy = peer !== 'unknown' && isPrivateIp(peer) && Boolean(header('x-forwarded-for') || header('x-real-ip') || header('cf-connecting-ip'))
  if (peer === 'unknown' || !isProxyHop(peer)) return { ip: peer, viaCloudflare: false, viaProxy: false }

  // X-Forwarded-For, right to left: skip proxies, stop at the first address that is not one.
  let ip = peer
  const hops = (header('x-forwarded-for') ?? '').split(',').map((part) => normalizeIp(part)).filter((part): part is string => Boolean(part))
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    ip = hops[index]
    if (!isProxyHop(ip)) break
    if (isCloudflareIp(ip)) viaCloudflare = true
  }

  // Proxies that send only X-Real-IP (a common nginx setup), or Cloudflare's own header.
  if (isProxyHop(ip)) {
    const realIp = normalizeIp(header('x-real-ip'))
    if (realIp) {
      ip = realIp
      if (isCloudflareIp(realIp)) viaCloudflare = true
    }
  }
  if (isProxyHop(ip) && viaCloudflare) {
    const cfIp = normalizeIp(header('cf-connecting-ip'))
    if (cfIp) ip = cfIp
  }
  return { ip, viaCloudflare, viaProxy }
}

// ---- Mode (system setting) and what was seen, for Settings → Security ----

let mode: ProxyMode = 'auto'
const seen = { cloudflareAt: 0, proxyAt: 0, directAt: 0, lastCfRay: '' as string, lastForwardedProto: '' as string }

export function proxyMode() {
  return mode
}

export async function loadProxyMode() {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'proxy_mode' } }).catch(() => null)
  mode = row?.value === 'off' ? 'off' : 'auto'
  return mode
}

export async function saveProxyMode(next: ProxyMode) {
  await prisma.systemSetting.upsert({ where: { key: 'proxy_mode' }, create: { key: 'proxy_mode', value: next }, update: { value: next } })
  mode = next
}

export function proxySightings() {
  return { ...seen }
}

/** Sets req.ip from the forwarded headers in "auto" mode, and notes which proxies were seen. */
export function autoClientIp(req: Request, _res: Response, next: NextFunction) {
  const result = resolveClientIp(req.socket.remoteAddress, (name) => req.header(name))
  const now = Date.now()
  if (result.viaCloudflare) {
    seen.cloudflareAt = now
    seen.lastCfRay = req.header('cf-ray') ?? seen.lastCfRay
  }
  if (result.viaProxy) seen.proxyAt = now
  if (!result.viaCloudflare && !result.viaProxy) seen.directAt = now
  const proto = req.header('x-forwarded-proto')
  if (proto) seen.lastForwardedProto = proto
  if (mode === 'auto') Object.defineProperty(req, 'ip', { value: result.ip, configurable: true })
  next()
}

/** Keeps the Cloudflare ranges current; failures keep the built-in list. */
export async function refreshCloudflareRanges() {
  try {
    const [v4, v6] = await Promise.all(['https://www.cloudflare.com/ips-v4', 'https://www.cloudflare.com/ips-v6'].map(async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) throw new Error(String(response.status))
      return (await response.text()).split(/\s+/).filter((line) => /^[0-9a-f:.]+\/\d+$/i.test(line))
    }))
    if (v4.length > 5 && v6.length > 2) cloudflare = buildList(v4, v6)
  } catch {
    // keep the current list
  }
}
