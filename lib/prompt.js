/**
 * The Kindle display contract, attached to each Kindle session's own agent.
 *
 * It is registered as a scoped system-prompt section on the live Agent context
 * (`resolveAgent(id).agent.ctx.systemPrompt`), so:
 *   - it only affects sessions living in the Kindle workspace,
 *   - it survives as long as that agent does, and is re-registered if the
 *     agent is rebuilt,
 *   - it costs nothing in sessions opened anywhere else (e.g. the Web GUI).
 *
 * The text lives in ../prompt/kindle.md so it can be edited without touching
 * JavaScript; with hot reload on, the next request re-reads it and replaces the
 * section on any agent that still carries the old text.
 */
import { readFile } from 'node:fs/promises'

const FILE = new URL('../prompt/kindle.md', import.meta.url)
const SECTION = 'kindle:display'
// The deployment persona suffix lives at 10200; equal orders sort by section
// name, and "deployment:…" sorts before "kindle:…", so this lands last.
const ORDER = 10200

/**
 * Shared across hot reloads. The registrations live on Agent contexts, which
 * outlive this module, so a new generation must know which agents already have
 * the section (registering one twice throws 'already registered'). Sharing the
 * counter also keeps /debug honest instead of resetting on every edit.
 */
const SHARED = Symbol.for('dsh-kindle.prompt')
const shared = globalThis[SHARED] || (globalThis[SHARED] = {
  agents: new WeakMap(),
  registered: 0,
  lastError: '',
})

let cached = null

export async function kindlePrompt() {
  if (cached === null) cached = (await readFile(FILE, 'utf8')).trim()
  return cached
}

export function promptStatus() {
  return { registered: shared.registered, lastError: shared.lastError, section: SECTION }
}

/**
 * Register the Kindle section on one session's agent. Safe to call on every
 * request: an agent already carrying this exact text is skipped, a changed text
 * replaces the old section, and every failure is recorded rather than thrown so
 * page rendering never breaks.
 */
export async function ensureKindlePrompt(controller, sessionId) {
  try {
    const found = await controller.resolveAgent(sessionId)
    if (!found || found.error || !found.agent) {
      shared.lastError = 'agent unavailable: ' + String(found && found.error && found.error.message)
      return false
    }
    const agent = found.agent
    const text = await kindlePrompt()
    const current = shared.agents.get(agent)
    if (current && current.text === text) return true

    const systemPrompt = agent.ctx && agent.ctx.systemPrompt
    if (!systemPrompt || typeof systemPrompt.section !== 'function') {
      shared.lastError = 'agent context has no systemPrompt service'
      return false
    }

    // The text changed under a live agent (kindle.md edited, hot reload): drop
    // the previous insertion and put the new text in its place.
    if (current && typeof current.undo === 'function') current.undo()
    const undo = systemPrompt.section({ name: SECTION, order: ORDER, text, interpolate: false })
    shared.agents.set(agent, { text, undo })
    shared.registered += 1
    shared.lastError = ''
    return true
  } catch (error) {
    shared.lastError = String((error && error.message) || error)
    return false
  }
}
