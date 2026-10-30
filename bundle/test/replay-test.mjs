/**
 * Replay a real durable session log through the Kindle transcript builder.
 *
 *   node test/replay-test.mjs <path/to/session.v4.jsonl.zstd>
 *
 * The log is a zstd-compressed JSONL of SessionEvent records; this checks that
 * the shapes we extract (top-level user messages, nested assistant messages,
 * injected runtime-context prompts) still line up with what the Host writes.
 */
import { zstdDecompressSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { readTranscript } from '../lib/sessions.js'
import { renderSession } from '../lib/ui.js'

const file = process.argv[2]
if (!file) {
  console.log('usage: node test/replay-test.mjs <session.v4.jsonl.zstd>')
  process.exit(0)
}

const events = zstdDecompressSync(readFileSync(file))
  .toString('utf8')
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line))
  .filter((event) => typeof event.seq === 'number')

const cwd = '/replay'
const ctx = {
  sessionController: {
    async list() {
      return {
        items: [{
          sessionId: 'replay',
          cwd,
          updatedAt: 1,
          running: false,
          blank: false,
          projections: { values: { title: 'replay' } },
        }],
      }
    },
    async inspect() {
      return { events }
    },
  },
}

const transcript = await readTranscript(ctx, 'replay', cwd)
const html = renderSession(
  { fontSize: 30, pageSize: 40 },
  {
    sessionId: 'replay',
    title: transcript.title,
    messages: transcript.messages,
    running: false,
    updatedAt: 1,
    version: '1:0',
    fresh: false,
    hasOlder: false,
    window: 40,
  },
)

console.log('events:', events.length)
console.log('messages:', transcript.messages.map((m) => `${m.kind}:${JSON.stringify(m.text.slice(0, 50))}`))
console.log('html bytes:', Buffer.byteLength(html))
console.log('has svg:', html.includes('<svg'))
