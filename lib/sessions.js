import { randomUUID } from 'node:crypto';
const SURFACE_TYPES = new Set([
    'system/message',
    'user/message',
    'assistant/message',
    'tool/result',
]);
function signalFor(ms) {
    return AbortSignal.timeout(ms);
}
export async function listSessions(ctx, cwd) {
    const value = await sessions().list({}, signalFor(15000));
    const items = Array.isArray(value?.items) ? value.items : [];
    const archived = archivedSet(ctx);
    return items
        .filter((item) => item.origin !== 'subagent')
        .filter((item) => !archived || !archived.has(item.sessionId))
        .filter((item) => !cwd || item.cwd === cwd)
        .map((item) => ({
        sessionId: item.sessionId,
        title: titleOf(item) || '（未命名会话）',
        updatedAt: Number(item.updatedAt) || 0,
        running: item.running === true,
        blank: item.blank === true,
    }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
}
function titleOf(item) {
    const values = item?.projections?.values;
    const title = values && typeof values.title === 'string' ? values.title.trim() : '';
    return title;
}
export async function createSession(ctx, cwd) {
    const value = await sessions().create(cwd ? { cwd } : {});
    if (!value || !value.sessionId)
        throw new Error('create() returned no sessionId');
    return String(value.sessionId);
}
export async function sendPrompt(ctx, sessionId, text) {
    await sessions().prompt({
        requestId: randomUUID(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
    }, signalFor(30000));
}
const archivedLocally = new Set();
const host = {
    sessionController: null,
    workspaceController: null,
    workspaceRegistry: null,
    llm: null,
};
export function setHost(partial) {
    const store = host;
    for (const key of Object.keys(partial))
        store[key] = partial[key] || null;
}
function sessions() {
    if (!host.sessionController)
        throw new Error('sessionController is not available yet');
    return host.sessionController;
}
function archivedSet(ctx) {
    const merged = new Set(archivedLocally);
    try {
        const registry = host.workspaceRegistry;
        const set = registry && registry.archivedSessionIds;
        if (set && typeof set[Symbol.iterator] === 'function') {
            for (const id of set)
                merged.add(id);
        }
    }
    catch (error) { }
    return merged;
}
export async function renameSession(ctx, sessionId, title) {
    return sessions().rename({ sessionId, title: String(title || '') });
}
export async function forkSession(ctx, sessionId) {
    const value = await sessions().fork({ sessionId });
    if (!value || !value.sessionId)
        throw new Error('fork() returned no sessionId');
    return String(value.sessionId);
}
export async function labelFork(ctx, sourceId, forkedId, cwd) {
    const source = await sessionState(ctx, sourceId, cwd);
    const base = (source && source.title ? source.title : '').trim() || '（未命名会话）';
    const title = ('分叉：' + base).slice(0, 100);
    await sessions().rename({ sessionId: forkedId, title });
    return title;
}
export async function archiveSession(ctx, sessionId) {
    const workspace = host.workspaceController;
    if (!workspace || typeof workspace.archiveSession !== 'function') {
        throw new Error('这个 Host 没有挂载 workspace 服务，无法删除会话。');
    }
    await workspace.archiveSession({ sessionId, stopActivity: true });
    archivedLocally.add(sessionId);
}
export async function cancelSession(ctx, sessionId) {
    await sessions().cancel({ sessionId });
}
export async function sessionState(ctx, sessionId, cwd) {
    const sessions = await listSessions(ctx, cwd);
    const found = sessions.find((s) => s.sessionId === sessionId);
    if (!found)
        return null;
    return { running: found.running, updatedAt: found.updatedAt, title: found.title };
}
export async function readTranscript(ctx, sessionId, cwd) {
    const state = await sessionState(ctx, sessionId, cwd);
    const inspection = await sessions().inspect(sessionId, signalFor(30000));
    const events = Array.isArray(inspection?.events) ? inspection.events : [];
    const calls = new Map();
    for (const event of events) {
        if (event.type === 'tool/call') {
            const data = event.data || {};
            calls.set(String(data.callId), {
                name: String(data.name || 'tool'),
                args: String(data.arguments || ''),
            });
        }
    }
    const surface = [];
    let rewriteFloor = 0;
    for (const event of events) {
        if (!SURFACE_TYPES.has(event.type))
            continue;
        const op = event.surfaceOp;
        if (op && typeof op === 'object' && op.op === 'replace') {
            const start = Number(op.startSeq);
            const end = Number(op.endSeq);
            rewriteFloor = Math.max(rewriteFloor, start);
            for (let index = surface.length - 1; index >= 0; index -= 1) {
                const seq = surface[index].seq;
                if (seq >= start && seq <= end)
                    surface.splice(index, 1);
            }
        }
        surface.push(event);
    }
    surface.sort((a, b) => a.seq - b.seq);
    const messages = [];
    for (const event of surface) {
        const data = event.data || {};
        if (event.type === 'user/message') {
            const message = (data.message || data);
            const source = message && message.source ? String(message.source.kind || '') : '';
            if (source && source !== 'user')
                continue;
            const text = textBlocks(message);
            if (text)
                messages.push({ kind: 'user', seq: event.seq, text });
            continue;
        }
        if (event.type === 'assistant/message') {
            const text = textBlocks(data.message);
            if (text)
                messages.push({
                    kind: 'assistant',
                    seq: event.seq,
                    text,
                    interrupted: data.interrupted === true,
                });
            continue;
        }
        if (event.type === 'tool/result') {
            const message = (data.message || {});
            const call = calls.get(String(message.toolCallId));
            const text = textBlocks(message);
            messages.push({
                kind: 'tool',
                seq: event.seq,
                name: call ? call.name : 'tool',
                text,
                error: message.isError === true || Boolean(data.error),
            });
            continue;
        }
    }
    return {
        messages,
        rewriteFloor,
        running: state ? state.running : false,
        updatedAt: state ? state.updatedAt : 0,
        title: state ? state.title : '',
    };
}
function textBlocks(message) {
    const content = message && Array.isArray(message.content) ? message.content : [];
    const parts = [];
    for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string')
            parts.push(block.text);
        if (block && block.type === 'image')
            parts.push('[图片]');
        if (block && block.type === 'file')
            parts.push('[文件]');
    }
    return parts.join('\n').trim();
}
const catalogCache = { at: 0, value: null };
const CATALOG_TTL = 5 * 60 * 1000;
export async function modelCatalog(ctx) {
    const now = Date.now();
    if (catalogCache.value && now - catalogCache.at < CATALOG_TTL)
        return catalogCache.value;
    const value = await sessions().modelCatalog();
    catalogCache.at = now;
    catalogCache.value = value;
    return value;
}
export async function modelChoice(ctx, sessionId) {
    const catalog = await modelCatalog(ctx);
    const fallback = catalog.default || { provider: '', model: '' };
    let selection = fallback;
    try {
        const value = await sessions().projections({ sessionId }, signalFor(10000));
        const view = value && value.values ? value.values.modelSelection : null;
        if (view && view.next)
            selection = view.next;
    }
    catch (error) { }
    const group = (catalog.groups || []).find((entry) => entry.id === selection.provider);
    const model = group && (group.models || []).find((entry) => entry.id === selection.model);
    const reasoning = model && model.reasoning;
    const info = await modelCapabilities(ctx, selection.provider, selection.model);
    const resolved = info && info.reasoning;
    const catalogEfforts = Array.isArray(reasoning && reasoning.efforts) ? reasoning.efforts : [];
    const efforts = Array.isArray(resolved && resolved.efforts) && resolved.efforts.length > 0
        ? resolved.efforts
        : catalogEfforts;
    const current = selection.reasoningEffort ||
        (resolved && resolved.defaultEffort) ||
        (reasoning && reasoning.defaultEffort) ||
        '';
    return {
        provider: selection.provider,
        model: selection.model,
        name: (model && model.name) || (info && info.name) || selection.model,
        efforts,
        current,
    };
}
export async function setReasoningEffort(ctx, sessionId, effort) {
    const chosen = await modelChoice(ctx, sessionId);
    await sessions().selectModel({
        sessionId,
        provider: chosen.provider,
        model: chosen.model,
        reasoningEffort: effort,
    });
    return { ...chosen, current: effort };
}
const infoCache = new Map();
async function modelCapabilities(ctx, provider, model) {
    const llm = host.llm;
    if (!llm || typeof llm.resolveModelInfo !== 'function' || !provider || !model)
        return null;
    const key = `${provider}/${model}`;
    const hit = infoCache.get(key);
    if (hit && Date.now() - hit.at < CATALOG_TTL)
        return hit.value;
    try {
        const info = await llm.resolveModelInfo(provider, model);
        if (infoCache.size > 20)
            infoCache.clear();
        infoCache.set(key, { at: Date.now(), value: info });
        return info;
    }
    catch (error) {
        return null;
    }
}
export function clearCatalogCache() {
    catalogCache.at = 0;
    catalogCache.value = null;
    infoCache.clear();
}
