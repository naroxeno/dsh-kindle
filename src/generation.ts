export const STAMP = new URL(import.meta.url).search

export interface Generation {
  sessions: typeof import('./sessions.js')
  math: typeof import('./math.js')
  ui: typeof import('./ui.js')
  prompt: typeof import('./prompt.js')
  account: typeof import('./account.js')
}

export async function load(): Promise<Generation> {
  const [sessions, math, ui, prompt, account] = await Promise.all([
    import('./sessions.js' + STAMP),
    import('./math.js' + STAMP),
    import('./ui.js' + STAMP),
    import('./prompt.js' + STAMP),
    import('./account.js' + STAMP),
  ])
  return { sessions, math, ui, prompt, account } as unknown as Generation
}
