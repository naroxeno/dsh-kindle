import { readFile } from 'node:fs/promises';
const FILE = new URL('../prompt/kindle.md', import.meta.url);
const SECTION = 'kindle:display';
const ORDER = 10200;
const SHARED = Symbol.for('dsh-kindle.prompt');
const globals = globalThis;
const shared = globals[SHARED] ||
    (globals[SHARED] = {
        agents: new WeakMap(),
        registered: 0,
        lastError: '',
    });
let cached = null;
export async function kindlePrompt() {
    if (cached === null)
        cached = (await readFile(FILE, 'utf8')).trim();
    return cached;
}
export function promptStatus() {
    return { registered: shared.registered, lastError: shared.lastError, section: SECTION };
}
export async function ensureKindlePrompt(controller, sessionId) {
    try {
        const found = await controller.resolveAgent(sessionId);
        if (!found || found.error || !found.agent) {
            shared.lastError = 'agent unavailable: ' + String(found && found.error && found.error.message);
            return false;
        }
        const agent = found.agent;
        const text = await kindlePrompt();
        const current = shared.agents.get(agent);
        if (current && current.text === text)
            return true;
        const systemPrompt = agent.ctx && agent.ctx.systemPrompt;
        if (!systemPrompt || typeof systemPrompt.section !== 'function') {
            shared.lastError = 'agent context has no systemPrompt service';
            return false;
        }
        if (current && typeof current.undo === 'function')
            current.undo();
        const undo = systemPrompt.section({ name: SECTION, order: ORDER, text, interpolate: false });
        shared.agents.set(agent, { text, undo });
        shared.registered += 1;
        shared.lastError = '';
        return true;
    }
    catch (error) {
        shared.lastError = String((error && error.message) || error);
        return false;
    }
}
