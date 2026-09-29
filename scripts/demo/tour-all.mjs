/**
 * Records every part of the tour in turn, then merges them.
 *   npm run demo:tour
 */
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const { parts } = await import('./tour-scenes.cjs')
for (const p of Object.keys(parts)) {
  console.log(`\n── part ${p} ──`)
  execFileSync(path.join(ROOT, 'node_modules', '.bin', 'electron.cmd'), [path.join(HERE, 'tour.cjs')],
    { cwd: ROOT, env: { ...process.env, DEMO_PART: p }, stdio: 'inherit' })
}
execFileSync(process.execPath, [path.join(HERE, 'merge.mjs'), path.join(ROOT, 'demo', 'parivar-full-tour-1.26.mp4')],
  { cwd: ROOT, stdio: 'inherit' })
