function clientMeta() {
    return {
        version: '1',
        locale: 'zh-CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    };
}
const cache = {
    at: 0,
    value: null,
    ttl: 0,
};
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
        value = { ok: false, reason: String(error?.message || error) };
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
export function money(currency, amount) {
    const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : '';
    const text = amount.toFixed(2);
    return `${symbol}${text}`;
}
export function balanceLine(account) {
    if (!account || !account.ok)
        return '';
    const wallets = account.wallets || [];
    if (!wallets.length)
        return '';
    const parts = wallets.map((w) => w.text);
    return parts.join(' / ');
}
export function clearAccountCache() {
    cache.at = 0;
    cache.value = null;
    cache.ttl = 0;
}
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const PEAK_WINDOWS = [
    [9 * 60, 12 * 60],
    [14 * 60, 18 * 60],
];
// 2027 holidays from 国办发明电〔2026〕10号 (published 2026-11-05). Add the next
// year's dates when the State Council publishes them (usually early November):
// a year missing here only marks that year's holidays as peak time.
const HOLIDAYS = new Set([
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
    '2027-02-05',
    '2027-02-06',
    '2027-02-07',
    '2027-02-08',
    '2027-02-09',
    '2027-02-10',
    '2027-02-11',
    '2027-02-12',
    '2027-02-13',
    '2027-04-03',
    '2027-04-04',
    '2027-04-05',
    '2027-05-01',
    '2027-05-02',
    '2027-05-03',
    '2027-05-04',
    '2027-05-05',
    '2027-06-09',
    '2027-09-15',
    '2027-10-01',
    '2027-10-02',
    '2027-10-03',
    '2027-10-04',
    '2027-10-05',
    '2027-10-06',
    '2027-10-07',
]);
function pad2(value) {
    return value < 10 ? '0' + value : String(value);
}
/**
 * DeepSeek bills in Beijing time: weekdays 09:00–12:00 and 14:00–18:00 are
 * peak, and statutory holidays are idle all day. Everything else (evenings,
 * nights, weekends, holidays) is the idle window at half price. China has no
 * daylight saving time, so a fixed offset is exact.
 */
export function priceWindow(now = new Date()) {
    const beijing = new Date(now.getTime() + BEIJING_OFFSET_MS);
    const day = beijing.getUTCDay();
    const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
    const stamp = beijing.getUTCFullYear() +
        '-' +
        pad2(beijing.getUTCMonth() + 1) +
        '-' +
        pad2(beijing.getUTCDate());
    const weekday = day >= 1 && day <= 5;
    if (weekday && !HOLIDAYS.has(stamp)) {
        for (const [start, stop] of PEAK_WINDOWS) {
            if (minutes >= start && minutes < stop) {
                return { peak: true, label: '峰时', detail: '高峰价，单价是空闲时段的两倍' };
            }
        }
    }
    return { peak: false, label: '谷时', detail: '空闲价，单价是高峰时段的一半' };
}
