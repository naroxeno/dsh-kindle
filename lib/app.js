import { readFileSync } from 'node:fs';
const STAMP = new URL(import.meta.url).search;
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
export async function createApp(host) {
    const { ctx, config, services, logger } = host;
    const generation = (await import('./generation.js' + STAMP));
    const { sessions: sessionsApi, math, ui, prompt, account } = await generation.load();
    sessionsApi.setHost(services);
    async function handle(req, res) {
        try {
            await route(req, res);
        }
        catch (error) {
            if (error instanceof HttpError) {
                sendHtml(res, error.status, renderErrorPage(error.status, error.message));
                return;
            }
            const detail = error;
            logger.error?.(String(detail && detail.stack ? detail.stack : error));
            if (res.headersSent) {
                res.destroy();
                return;
            }
            sendHtml(res, 500, renderErrorPage(500, errorText(error)));
        }
    }
    async function route(req, res) {
        const url = new URL(req.url || '/', 'http://kindle.invalid');
        const path = url.pathname;
        const method = (req.method || 'GET').toUpperCase();
        if (method === 'GET' && (path === '/' || path === '/index.html')) {
            redirect(res, '/s');
            return;
        }
        if (method === 'GET' && path === '/login') {
            redirect(res, '/s');
            return;
        }
        if (method === 'GET' && path === '/s') {
            const sessions = await sessionsApi.listSessions(ctx, config.cwd);
            const balance = await account.readAccount(services.accountController, { timeoutMs: 1500 });
            sendHtml(res, 200, ui.renderList(config, sessions, '', {
                balance: account.balanceLine(balance),
            }));
            return;
        }
        if (method === 'GET' && path === '/me') {
            const balance = await account.readAccount(services.accountController, { timeoutMs: 6000 });
            sendHtml(res, 200, ui.renderAccount(config, { account: balance }));
            return;
        }
        if (method === 'GET' && path === '/debug') {
            const status = prompt.promptStatus();
            const text = await prompt.kindlePrompt();
            const hot = typeof host.hot === 'function' ? host.hot() : null;
            const generation = Number(hot && hot.generation) || 0;
            const reloads = Number(hot && hot.reloads) || 0;
            const lines = [
                'kindle-ui ' + VERSION,
                'hot: generation ' +
                    generation +
                    ' (' +
                    reloads +
                    ' reload' +
                    (reloads === 1 ? '' : 's') +
                    ', auto ' +
                    (hot && hot.auto ? 'on' : 'off') +
                    ')',
            ];
            if (hot && hot.lastError)
                lines.push('hot error: ' + hot.lastError);
            lines.push(JSON.stringify(status), 'prompt bytes: ' + Buffer.byteLength(text), 'delete (workspace services): ' + (services.workspaceController ? 'ready' : 'missing'), 'account (balance): ' + (services.accountController ? 'ready' : 'missing'), 'model catalog: ' + (await catalogLine(ctx)));
            res.writeHead(200, {
                'content-type': 'text/plain; charset=utf-8',
                'cache-control': 'no-store',
            });
            res.end(lines.join('\n') + '\n');
            return;
        }
        if (method === 'POST' && path === '/new') {
            const sessionId = await sessionsApi.createSession(ctx, config.cwd);
            redirect(res, '/c/' + encodeURIComponent(sessionId));
            return;
        }
        const parts = path.split('/').filter(Boolean);
        if (parts[0] !== 'c' || !parts[1]) {
            throw new HttpError(404, '没有这个页面。');
        }
        const sessionId = decodeURIComponent(parts[1]);
        const action = parts[2] || '';
        await requireOwnedSession(sessionsApi, ctx, config, sessionId);
        await prompt.ensureKindlePrompt(ctx.sessionController, sessionId);
        if (method === 'GET' && action === '') {
            const window = clampInt(Number(url.searchParams.get('n')) || config.pageSize, 1, 400, config.pageSize);
            let transcript;
            try {
                transcript = await sessionsApi.readTranscript(ctx, sessionId, config.cwd);
            }
            catch (error) {
                logger.warn?.('kindle transcript read failed for ' + sessionId + ': ' + errorText(error));
                transcript = {
                    title: '',
                    messages: [],
                    rewriteFloor: 0,
                    running: true,
                    updatedAt: Date.now(),
                };
            }
            const visible = transcript.messages.slice(-window);
            const model = await modelInfo(ctx, sessionsApi, sessionId);
            sendHtml(res, 200, ui.renderSession(config, {
                sessionId,
                title: transcript.title,
                messages: visible,
                running: transcript.running,
                updatedAt: transcript.updatedAt,
                version: transcript.updatedAt + ':' + (transcript.running ? 1 : 0),
                fresh: url.searchParams.get('fresh') === '1',
                hasOlder: transcript.messages.length > visible.length,
                cursor: visible.length ? visible[visible.length - 1].seq : 0,
                window,
                model,
            }));
            return;
        }
        if (method === 'GET' && action === 'tail') {
            const windowSize = clampInt(Number(url.searchParams.get('n')) || config.pageSize, 1, 400, config.pageSize);
            const since = Math.max(0, Math.floor(Number(url.searchParams.get('since')) || 0));
            let transcript;
            try {
                transcript = await sessionsApi.readTranscript(ctx, sessionId, config.cwd);
            }
            catch (error) {
                logger.warn?.('kindle transcript read failed for ' + sessionId + ': ' + errorText(error));
                transcript = {
                    messages: [],
                    rewriteFloor: 0,
                    running: true,
                    updatedAt: Date.now(),
                    title: '',
                };
            }
            const visible = transcript.messages.slice(-windowSize);
            const cursor = visible.length ? visible[visible.length - 1].seq : 0;
            const floor = Number(transcript.rewriteFloor) || 0;
            const before = since > 0 ? visible.findIndex((message) => message.seq === since) : -1;
            const appendable = since > 0 && before !== -1 && (floor === 0 || floor > since);
            const pending = appendable ? visible.slice(before + 1) : [];
            const payload = {
                mode: appendable ? 'append' : 'replace',
                html: appendable
                    ? pending.length
                        ? ui.renderMessages(config, pending)
                        : ''
                    : ui.renderMessages(config, visible),
                cursor,
                running: transcript.running ? 1 : 0,
                version: transcript.updatedAt + ':' + (transcript.running ? 1 : 0),
            };
            res.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
            });
            res.end(JSON.stringify(payload));
            return;
        }
        if (method === 'GET' && action === 'state') {
            const current = await sessionsApi.sessionState(ctx, sessionId, config.cwd);
            if (!current)
                throw new HttpError(404, '会话不存在。');
            res.writeHead(200, {
                'content-type': 'text/plain; charset=utf-8',
                'cache-control': 'no-store',
            });
            res.end(current.updatedAt + ':' + (current.running ? 1 : 0));
            return;
        }
        if (method === 'POST' && action === 'send') {
            const body = await readBody(req);
            const draft = String(body.get('msg') || '');
            if (draft.trim()) {
                await sessionsApi.sendPrompt(ctx, sessionId, math.convertPromptMath(draft));
            }
            redirect(res, '/c/' + encodeURIComponent(sessionId) + '?fresh=1');
            return;
        }
        if (method === 'POST' && action === 'preview') {
            const body = await readBody(req);
            const draft = String(body.get('msg') || '');
            sendHtml(res, 200, ui.renderPreview(config, { sessionId, draft }));
            return;
        }
        if (method === 'GET' && action === 'rename') {
            const current = await sessionsApi.sessionState(ctx, sessionId, config.cwd);
            sendHtml(res, 200, ui.renderRename(config, { sessionId, title: current ? current.title : '' }));
            return;
        }
        if (method === 'POST' && action === 'rename') {
            const body = await readBody(req);
            const title = String(body.get('title') || '')
                .trim()
                .slice(0, 100);
            if (!title)
                throw new HttpError(400, '标题不能为空。');
            await sessionsApi.renameSession(ctx, sessionId, title);
            redirect(res, '/c/' + encodeURIComponent(sessionId));
            return;
        }
        if (method === 'POST' && action === 'effort') {
            const body = await readBody(req);
            const effort = String(body.get('effort') || '');
            const model = await modelInfo(ctx, sessionsApi, sessionId);
            const known = model.efforts.some((entry) => entry.id === effort);
            if (!known)
                throw new HttpError(400, '这个模型不支持该思考强度。');
            await sessionsApi.setReasoningEffort(ctx, sessionId, effort);
            redirect(res, '/c/' + encodeURIComponent(sessionId));
            return;
        }
        if (method === 'POST' && action === 'fork') {
            const forked = await sessionsApi.forkSession(ctx, sessionId);
            try {
                await sessionsApi.labelFork(ctx, sessionId, forked, config.cwd);
            }
            catch (error) {
                logger.error?.('kindle-ui: could not title fork ' + forked + ': ' + errorText(error));
            }
            redirect(res, '/c/' + encodeURIComponent(forked));
            return;
        }
        if (method === 'GET' && action === 'delete') {
            const current = await sessionsApi.sessionState(ctx, sessionId, config.cwd);
            sendHtml(res, 200, ui.renderDelete(config, {
                sessionId,
                title: current ? current.title : '',
                cwd: config.cwd,
            }));
            return;
        }
        if (method === 'POST' && action === 'delete') {
            try {
                await sessionsApi.archiveSession(ctx, sessionId);
            }
            catch (error) {
                throw new HttpError(409, '删不掉：' + errorText(error));
            }
            redirect(res, '/s');
            return;
        }
        if (method === 'POST' && action === 'stop') {
            await sessionsApi.cancelSession(ctx, sessionId);
            redirect(res, '/c/' + encodeURIComponent(sessionId));
            return;
        }
        throw new HttpError(404, '没有这个页面。');
    }
    return {
        handle,
        version: VERSION,
        modules: { sessions: sessionsApi, math, ui, prompt, account },
        setHost(next) {
            sessionsApi.setHost(next);
        },
        dispose() { },
        loginPage(next, options) {
            return ui.renderLogin(config, next, options);
        },
        errorPage(status, message) {
            return renderErrorPage(status, message);
        },
    };
    function modelInfo(controller, api, sessionId) {
        return api.modelChoice(controller, sessionId).catch(() => ({
            provider: '',
            model: '',
            name: '',
            efforts: [],
            current: '',
        }));
    }
    async function catalogLine(controller) {
        try {
            const model = await sessionsApi.modelChoice(controller, '');
            const names = model.efforts.map((entry) => entry.id).join(',');
            return model.provider + '/' + model.model + ' (' + (names || 'no reasoning') + ')';
        }
        catch (error) {
            return 'unavailable: ' + errorText(error);
        }
    }
    async function requireOwnedSession(api, controller, options, sessionId) {
        const sessions = await api.listSessions(controller, options.cwd);
        if (!sessions.some((entry) => entry.sessionId === sessionId)) {
            throw new HttpError(404, '这个会话不在 Kindle 工作区里。');
        }
    }
    function readBody(req, limit = 512 * 1024) {
        return new Promise((resolveBody, rejectBody) => {
            const chunks = [];
            let size = 0;
            req.on('data', (chunk) => {
                size += chunk.length;
                if (size > limit) {
                    rejectBody(new HttpError(413, '请求太大。'));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => {
                resolveBody(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
            });
            req.on('error', rejectBody);
        });
    }
    function renderErrorPage(status, message) {
        return ('<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>出错了</title>' +
            '<style>body{font-family:serif;font-size:' +
            config.fontSize +
            'px;padding:24px;line-height:1.6}' +
            'a{color:#0b3d91}</style>' +
            '</head><body><h1>' +
            status +
            '</h1><p>' +
            escapeText(message) +
            '</p>' +
            '<p><a href="/s">返回会话列表</a></p></body></html>');
    }
}
function sendHtml(res, status, html, extraCookie) {
    const headers = {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(html),
    };
    if (extraCookie)
        headers['set-cookie'] = extraCookie;
    res.writeHead(status, headers);
    res.end(html);
}
function redirect(res, location) {
    res.writeHead(303, { Location: location, 'content-length': 0 });
    res.end();
}
function escapeText(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function errorText(error) {
    return String(error?.message || error);
}
function clampInt(value, min, max, fallback) {
    const number = Math.trunc(Number(value));
    if (!Number.isFinite(number))
        return fallback;
    return Math.min(max, Math.max(min, number));
}
