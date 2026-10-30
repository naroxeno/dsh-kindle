import type { AccountBalance, AccountControllerLike, AccountState, ClientMeta } from './host.js'

export interface AccountWallet {
  currency: string
  amount: number
  text: string
}

export interface AccountReadout {
  ok: boolean
  timedOut?: boolean
  reason?: string
  wallets?: AccountWallet[]
  bonuses?: AccountWallet[]
  links?: { usageUrl?: string; topUpUrl?: string }
}

function clientMeta(): ClientMeta {
  return {
    version: '1',
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

const cache: { at: number; value: AccountReadout | null; ttl: number } = {
  at: 0,
  value: null,
  ttl: 0,
}

export async function readAccount(
  controller: AccountControllerLike | null | undefined,
  options: { timeoutMs?: number; maxAgeMs?: number } = {},
): Promise<AccountReadout> {
  const timeoutMs = options.timeoutMs || 4000
  const maxAgeMs = options.maxAgeMs || 120000
  if (!controller) return { ok: false, reason: 'no-service' }
  if (cache.value && Date.now() - cache.at < cache.ttl) return cache.value

  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<AccountReadout>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true, reason: 'timeout' }), timeoutMs)
  })

  let value: AccountReadout
  try {
    value = await Promise.race([load(controller), timeout])
  } catch (error) {
    value = { ok: false, reason: String((error && error.message) || error) }
  } finally {
    if (timer) clearTimeout(timer)
  }

  cache.at = Date.now()
  cache.value = value
  cache.ttl = value.ok ? maxAgeMs : 30000
  return value
}

async function load(controller: AccountControllerLike): Promise<AccountReadout> {
  const [state, balance] = await Promise.all([
    safe(() => controller.getState()),
    safe(() => controller.getBalance(clientMeta())),
  ])

  const links = state && state.links ? state.links : {}
  const linksOut: { usageUrl?: string; topUpUrl?: string } = {}
  if (links.usageUrl) linksOut.usageUrl = String(links.usageUrl)
  if (links.topUpUrl) linksOut.topUpUrl = String(links.topUpUrl)

  if (!balance || balance.status !== 'ready') {
    const reason = state && state.status === 'signed-out' ? 'signed-out' : 'unavailable'
    return { ok: false, reason, links: linksOut }
  }

  return {
    ok: true,
    wallets: walletsOf(balance.value),
    bonuses: walletsOf(balance.bonusWallets),
    links: linksOut,
  }
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    return null
  }
}

function walletsOf(list: unknown): AccountWallet[] {
  if (!Array.isArray(list)) return []
  const out: AccountWallet[] = []
  for (const wallet of list) {
    if (!wallet || typeof wallet.balance !== 'string') continue
    const currency = String(wallet.currency || '')
    const amount = Number(wallet.balance)
    if (!Number.isFinite(amount)) continue
    out.push({ currency, amount, text: money(currency, amount) })
  }
  return out
}

export function money(currency: string, amount: number): string {
  const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : ''
  const text = amount.toFixed(2)
  return `${symbol}${text}`
}

export function balanceLine(account: AccountReadout | null | undefined): string {
  if (!account || !account.ok || !account.wallets.length) return ''
  const parts = account.wallets.map((w) => w.text)
  return parts.join(' / ')
}

export function clearAccountCache() {
  cache.at = 0
  cache.value = null
  cache.ttl = 0
}
