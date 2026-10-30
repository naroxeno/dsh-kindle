/**
 * Platform account readout for the Kindle client.
 *
 * `ctx.accountController` (dsh-api-account-controller) is the same service the
 * Web GUI's account page uses: `getState()` is local, `getBalance()` asks
 * Platform for the recharge and bonus wallets. Both are optional here — a
 * profile without the account extension simply shows no balance.
 */
/** Identity the Host needs for one Platform request. */
function clientMeta() {
    return {
        version: '1',
        locale: 'zh-CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    };
}
const cache = { at: 0, value: null, ttl: 0 };
/**
 * Read wallets plus the Platform links, memoized for a couple of minutes so a
 * page load is a memory read instead of a request to Platform.
 *
 * @param {object|null} controller - `ctx.accountController`, if mounted.
 * @param {{timeoutMs?: number, maxAgeMs?: number}} [options]
 * @returns {Promise<{ok: boolean, timedOut?: boolean, reason?: string,
 *   wallets?: Array<{currency: string, amount: number, text: string}>,
 *   bonuses?: Array<{currency: string, amount: number, text: string}>,
 *   links?: {usageUrl?: string, topUpUrl?: string}}>}
 */
export async function readAccount(controller, options = {}) {
    const timeoutMs = options.timeoutMs || 4000;
    const maxAgeMs = options.maxAgeMs || 120000;
    if (!controller)
        return { ok: false, reason: 'no-service' };
    if (cache.value && Date.now() - cache.at < cache.ttl)
        return cache.value;
    let timer = null;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, timedOut: true, reason: 'timeout' }), timeoutMs);
    });
    let value;
    try {
        value = await Promise.race([load(controller), timeout]);
    }
    catch (error) {
        value = { ok: false, reason: String((error && error.message) || error) };
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
    cache.at = Date.now();
    cache.value = value;
    cache.ttl = value.ok ? maxAgeMs : 30000;
    return value;
}
async function load(controller) {
    const [state, balance] = await Promise.all([
        safe(() => controller.getState()),
        safe(() => controller.getBalance(clientMeta())),
    ]);
    const links = state && state.links ? state.links : {};
    const linksOut = {};
    if (links.usageUrl)
        linksOut.usageUrl = String(links.usageUrl);
    if (links.topUpUrl)
        linksOut.topUpUrl = String(links.topUpUrl);
    if (!balance || balance.status !== 'ready') {
        const reason = state && state.status === 'signed-out' ? 'signed-out' : 'unavailable';
        return { ok: false, reason, links: linksOut };
    }
    return {
        ok: true,
        wallets: walletsOf(balance.value),
        bonuses: walletsOf(balance.bonusWallets),
        links: linksOut,
    };
}
/** The controller is optional, so a rejection is data, not an error. */
async function safe(fn) {
    try {
        return await fn();
    }
    catch (error) {
        return null;
    }
}
function walletsOf(list) {
    if (!Array.isArray(list))
        return [];
    const out = [];
    for (const wallet of list) {
        if (!wallet || typeof wallet.balance !== 'string')
            continue;
        const currency = String(wallet.currency || '');
        const amount = Number(wallet.balance);
        if (!Number.isFinite(amount))
            continue;
        out.push({ currency, amount, text: money(currency, amount) });
    }
    return out;
}
/** e-ink shows a compact amount; two decimals unless the server sends more. */
export function money(currency, amount) {
    const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : '';
    const text = amount.toFixed(2);
    return `${symbol}${text}`;
}
/** One-line summary for the list page; null when nothing is displayable. */
export function balanceLine(account) {
    if (!account || !account.ok || !account.wallets.length)
        return '';
    const parts = account.wallets.map((w) => w.text);
    return parts.join(' / ');
}
/** Reset the memoized readout; tests use it to keep cases independent. */
export function clearAccountCache() {
    cache.at = 0;
    cache.value = null;
    cache.ttl = 0;
}
