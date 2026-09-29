/**
 * Stitches the tour parts (demo/tour/part-N.mp4) into one film, in order, and
 * writes a chapter list beside it so anyone can jump to a feature.
 *
 *   node scripts/demo/merge.mjs demo/parivar-full-tour-1.26.mp4
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const DIR = path.join(ROOT, 'demo', 'tour')
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'demo', 'parivar-full-tour.mp4'))

const parts = fs.readdirSync(DIR)
  .filter((f) => /^part-\d+\.mp4$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
if (!parts.length) { console.error('no parts in ' + DIR); process.exit(1) }

const list = path.join(DIR, 'concat.txt')
fs.writeFileSync(list, parts.map((f) => `file '${path.join(DIR, f).replace(/\\/g, '/')}'`).join('\n'))
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list,
  '-c', 'copy', '-movflags', '+faststart', OUT], { stdio: 'inherit' })

// Chapter list: each part's chapters, offset by the parts before it.
let offset = 0
const lines = []
for (const f of parts) {
  const meta = JSON.parse(fs.readFileSync(path.join(DIR, f.replace('.mp4', '.json')), 'utf8'))
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(DIR, f)]).toString().trim()) * 1000
  const lead = Math.max(0, meta.total - dur)   // the video starts at its first frame, not at zero
  for (const c of meta.chapters) {
    const t = Math.max(0, offset + c.at - lead) / 1000
    const mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = String(Math.floor(t % 60)).padStart(2, '0')
    lines.push(`${mm}:${ss}  ${c.title}`)
  }
  offset += dur
}
fs.writeFileSync(OUT.replace(/\.mp4$/, '-chapters.txt'), lines.join('\n') + '\n')
const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1)
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT]).toString().trim()
console.log(`${OUT}\n${Math.floor(dur / 60)}m ${String(Math.round(dur % 60)).padStart(2, '0')}s · ${mb} MB · ${parts.length} parts\n\n${lines.join('\n')}`)
