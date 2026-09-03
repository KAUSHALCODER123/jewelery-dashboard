/**
 * Makes the whole demo film, end to end.
 *
 *   set SARVAM_KEY=...            (never commit it — it is a paid key)
 *   npm run build                 (the film records the REAL built app)
 *   node scripts/demo/make.mjs [out.mp4]
 *
 * Three stages, in this order and no other:
 *   1. speak   — narration first, because the picture is cut to the voice
 *   2. record  — drive the real app, one frame at a time, held to those lengths
 *   3. build   — lay the two together
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'demo', 'parivar-demo-hinglish.mp4'))

if (!process.env.SARVAM_KEY) {
  console.error('SARVAM_KEY is not set. Export the Sarvam key and run again.')
  process.exit(1)
}
if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` first.')
  process.exit(1)
}

const WORK = process.env.DEMO_WORK ||
  fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-demo-work-'))
fs.mkdirSync(path.dirname(OUT), { recursive: true })
const env = { ...process.env, DEMO_WORK: WORK }
const run = (cmd, args) =>
  execFileSync(cmd, args, { cwd: ROOT, env, stdio: 'inherit' })

const stage = (n, what) =>
  console.log(`\n\x1b[1m── ${n}. ${what} ${'─'.repeat(Math.max(0, 46 - what.length))}\x1b[0m`)

console.log(`work dir: ${WORK}`)

stage(1, 'Narration (Sarvam bulbul:v3, Hinglish)')
run(process.execPath, [path.join(HERE, 'tts.mjs')])

stage(2, 'Recording the real app')
run(path.join(ROOT, 'node_modules', '.bin', 'electron.cmd'), [path.join(HERE, 'record.cjs')])

stage(3, 'Cutting it together')
run(process.execPath, [path.join(HERE, 'build.mjs'), OUT])

console.log(`\n\x1b[32mDone.\x1b[0m  ${OUT}`)
