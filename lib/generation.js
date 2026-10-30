export const STAMP = new URL(import.meta.url).search;
export async function load() {
    const [sessions, math, ui, prompt, account] = await Promise.all([
        import('./sessions.js' + STAMP),
        import('./math.js' + STAMP),
        import('./ui.js' + STAMP),
        import('./prompt.js' + STAMP),
        import('./account.js' + STAMP),
    ]);
    return { sessions, math, ui, prompt, account };
}
