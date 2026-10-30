/**
 * dsh-kindle — plugin entry point.
 *
 * Intentionally tiny: the Host imports this file once per process and keeps
 * that module graph forever. All page code lives in app.js and its siblings,
 * which hot.js re-imports with a fresh ?gen=N suffix whenever they change on
 * disk — so editing lib/*.js or prompt/kindle.md takes effect on the next
 * request, without restarting dsh (a restart would abort in-flight agent
 * turns).
 *
 * Editing this file or hot.js still requires a Host restart: those two are the
 * stable shell that owns the listener, the token and the reload machinery.
 */
import { mount } from './hot.js'

export { VERSION } from './hot.js'

export const name = 'kindle-ui'
export const inject = ['sessionController']

export function apply(ctx, rawConfig) {
  return mount(ctx, rawConfig)
}
