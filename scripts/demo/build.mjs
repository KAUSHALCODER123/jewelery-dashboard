/**
 * Cuts the film together.
 *
 * Video: every captured frame gets exactly the duration it really occupied on
 * screen, taken from its own timestamp. Capture rate wobbles — encoding to a
 * fixed frame rate would slowly drift the picture away from the voice, and over
 * twelve minutes that drift is very visible.
 *
 * Audio: each scene's narration is laid down at the millisecond that scene
 * actually started, with silence in between. Nothing is stretched, so the voice
 * stays natural and the two tracks cannot slide apart.
 *
 *   DEMO_WORK=... node scripts/demo/build.mjs out.mp4
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const WORK = process.env.DEMO_WORK
const OUT = process.argv[2] || path.join(WORK, 'demo.mp4')
if (!WORK) { console.error('DEMO_WORK not set'); process.exit(1) }

const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: 'inherit' })

/* The recording is made in parts (see record.cjs). Stitch them back into one
   timeline, shifting each part's timestamps to sit after the one before it. */
const partFiles = fs.readdirSync(WORK)
  .filter((f) => /^frames-\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
if (!partFiles.length) { console.error('no frames-N.json in ' + WORK); process.exit(1) }

const frames = []
const timeline = []
let total = 0
for (const f of partFiles) {
  const p = JSON.parse(fs.readFileSync(path.join(WORK, f), 'utf8'))
  for (const fr of p.frames) frames.push({ ...fr, t: fr.t + total })
  for (const sc of p.timeline) timeline.push({ ...sc, start: sc.start + total })
  total += p.total
  console.log(`  part ${p.part}: ${p.frames.length} frames, ${(p.total / 1000).toFixed(1)}s`)
}

const audio = JSON.parse(fs.readFileSync(path.join(WORK, 'audio.json'), 'utf8'))
if (!frames.length) { console.error('no frames captured'); process.exit(1) }

const FRAMES = path.join(WORK, 'frames')
const totalSec = total / 1000

/* ── 1. video: real per-frame durations ─────────────────────────────────── */
const lines = []
for (let i = 0; i < frames.length; i++) {
  const end = i + 1 < frames.length ? frames[i + 1].t : total
  // Guard against a zero-length frame, which the concat demuxer drops.
  const dur = Math.max(0.02, (end - frames[i].t) / 1000)
  lines.push(`file '${path.join(FRAMES, frames[i].file).replace(/\\/g, '/')}'`)
  lines.push(`duration ${dur.toFixed(4)}`)
}
// The concat demuxer needs the last file repeated or it clips the final frame.
lines.push(`file '${path.join(FRAMES, frames[frames.length - 1].file).replace(/\\/g, '/')}'`)
const vlist = path.join(WORK, 'video.txt')
fs.writeFileSync(vlist, lines.join('\n'))

console.log(`video: ${frames.length} frames over ${totalSec.toFixed(1)}s`)
const silent = path.join(WORK, 'silent.mp4')
ff(['-f', 'concat', '-safe', '0', '-i', vlist,
  // The window is captured at whatever the desktop's DPI scaling makes it, which
  // is rarely an even number of pixels — and H.264 refuses an odd dimension. Trim
  // to even rather than resampling, so the text stays exactly as sharp as it was
  // on screen.
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  '-pix_fmt', 'yuv420p',
  // 24fps output is plenty for a UI walkthrough and keeps the file small enough
  // to send over WhatsApp, which is how this will actually reach people.
  '-r', '24', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
  '-movflags', '+faststart', silent])

/* ── 2. audio: each scene at the moment it happened ─────────────────────── */
const SR = 22050
const silence = (sec, file) => ff(['-f', 'lavfi', '-i',
  `anullsrc=r=${SR}:cl=mono`, '-t', Math.max(0.01, sec).toFixed(3), '-c:a', 'pcm_s16le', file])

const parts = []
let cursor = 0
timeline.forEach((sc, i) => {
  const a = audio[sc.id]
  if (!a) return
  const gap = sc.start / 1000 - cursor
  if (gap > 0.01) {
    const f = path.join(WORK, `gap${i}.wav`)
    silence(gap, f)
    parts.push(f)
    cursor += gap
  }
  parts.push(a.file)
  cursor += a.duration
})
if (totalSec - cursor > 0.05) {
  const f = path.join(WORK, 'gap-end.wav')
  silence(totalSec - cursor, f)
  parts.push(f)
}

const alist = path.join(WORK, 'audio.txt')
fs.writeFileSync(alist, parts.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'))
const voice = path.join(WORK, 'voice.wav')
ff(['-f', 'concat', '-safe', '0', '-i', alist, '-c', 'copy', voice])

/* ── 3. mux ─────────────────────────────────────────────────────────────── */
console.log('muxing…')
ff(['-i', silent, '-i', voice,
  '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ac', '1',
  '-shortest', '-movflags', '+faststart', OUT])

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1)
const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
  '-of', 'csv=p=0', OUT]).toString().trim()
const mins = Math.floor(dur / 60), secs = Math.round(dur % 60)
console.log(`\n${OUT}\n${mins}m ${String(secs).padStart(2, '0')}s · ${mb} MB`)
