/**
 * Post-production for the tour film.
 *
 *   node scripts/demo/polish.mjs demo/parivar-full-tour-1.26.mp4 demo/parivar-full-tour-1.26-final.mp4
 *
 * Takes the merged, silent tour (demo/tour/part-N.mp4 + part-N.json) and adds:
 *   • subtitles  — the on-screen captions as a real SRT track, timed from the
 *                  same beats that drove the recording (also written as .srt)
 *   • zooms      — a slow push-in on every chapter card
 *   • transitions— a dip to black between chapters (xfade), fade in and out
 *   • music      — a soft ambient pad, low in the mix, faded in and out
 *
 * The music is synthesised (four slow chords, detuned, low-passed) so there is
 * nothing to license. Drop a licensed track in with --music path/to.mp3 and it
 * is used instead, at the same level.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const DIR = path.join(ROOT, 'demo', 'tour')

const args = process.argv.slice(2)
const musicIdx = args.indexOf('--music')
const MUSIC = musicIdx >= 0 ? path.resolve(args.splice(musicIdx, 2)[1]) : null
const IN = path.resolve(args[0] || path.join(ROOT, 'demo', 'parivar-full-tour.mp4'))
const OUT = path.resolve(args[1] || IN.replace(/\.mp4$/, '-final.mp4'))
const ONLY_PART = process.env.POLISH_PART ? Number(process.env.POLISH_PART) : null
const CARD = 2.6     // seconds the chapter card is on screen (tour.cjs)
const DIP = 0.8      // seconds of dip-to-black between chapters
const FPS = 24

const ff = (a) => execFileSync('ffmpeg', ['-y', '-v', 'warning', ...a], { stdio: 'inherit' })
const probe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())
const f3 = (n) => n.toFixed(3)

/* ── timeline: chapters with absolute source times ── */
const { scenes } = require('./tour-scenes.cjs')
const parts = fs.readdirSync(DIR)
  .filter((f) => /^part-\d+\.json$/.test(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')))
  .filter((p) => !ONLY_PART || p.part === ONLY_PART)
  .sort((a, b) => a.part - b.part)
const srcTotal = probe(IN)
// A part's video starts at its first captured frame, not at the recorder's
// zero, so its clock runs a little ahead of the chapter times in its JSON. The
// lead is total − real duration; without taking it off, every part pushes the
// chapters after it a bit later and the zooms and subtitles drift.
const chapters = []
let offset = 0
for (const p of parts) {
  const file = ONLY_PART ? IN : path.join(DIR, `part-${p.part}.mp4`)
  const dur = probe(file)
  const lead = Math.max(0, p.total / 1000 - dur)
  for (const c of p.chapters) chapters.push({ at: Math.max(0, offset + c.at / 1000 - lead), title: c.title, scene: scenes.find((s) => s.id === c.id) })
  offset += dur
}
chapters.forEach((c, i) => { c.end = chapters[i + 1]?.at ?? srcTotal; c.dur = c.end - c.at })
// Every dip overlaps the two chapters by DIP, so chapter i starts DIP*i earlier
// in the output than in the source. Everything timed below uses `outAt`.
chapters.forEach((c, i) => { c.outAt = c.at - DIP * i })
const outTotal = srcTotal - DIP * (chapters.length - 1)

/* ── subtitles ── */
const srtTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}
const cues = []
chapters.forEach((c, i) => {
  const next = chapters[i + 1]?.outAt ?? outTotal
  cues.push({ from: c.outAt + 0.3, to: c.outAt + CARD, text: `${c.title}${c.scene?.sub ? `\n${c.scene.sub}` : ''}` })
  const start = c.outAt + CARD
  const caps = (c.scene?.beats || []).filter((b) => b.cap).map((b) => ({ at: start + b.at, text: b.cap[1] }))
  caps.forEach((cp, j) => {
    const end = Math.min(caps[j + 1]?.at ?? next, next) - 0.1
    if (end > cp.at + 0.3) cues.push({ from: cp.at, to: end, text: cp.text })
  })
})
const srtFile = OUT.replace(/\.mp4$/, '.srt')
fs.writeFileSync(srtFile, cues.map((c, i) => `${i + 1}\n${srtTime(c.from)} --> ${srtTime(c.to)}\n${c.text}\n`).join('\n'))

/* ── video graph ── */
// 1. Slow push-in on each chapter card. zoompan sees frame numbers, so time is
//    in/FPS at the fixed rate; z runs 1 → 1.08 across the card.
const T = `(in/${FPS})`
const zoomExpr = chapters.map((c) => `between(${T},${f3(c.at)},${f3(c.at + CARD - 0.2)})*(${T}-${f3(c.at)})`).join('+')
const z = `(1+0.08*(${zoomExpr})/${CARD})`
const zoom = `fps=${FPS},zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1600x900:fps=${FPS}`

// 2. Cut into chapters and rejoin with a dip to black at every join.
const n = chapters.length
const graph = []
graph.push(`[0:v]${zoom},split=${n}${chapters.map((_, i) => `[s${i}]`).join('')}`)
chapters.forEach((c, i) => {
  graph.push(`[s${i}]trim=start=${f3(c.at)}:end=${f3(c.end)},setpts=PTS-STARTPTS,fps=${FPS}[c${i}]`)
})
let prev = 'c0'
let acc = chapters[0].dur
for (let i = 1; i < n; i++) {
  const off = acc - DIP
  graph.push(`[${prev}][c${i}]xfade=transition=fadeblack:duration=${DIP}:offset=${f3(off)}[x${i}]`)
  prev = `x${i}`
  acc = off + chapters[i].dur
}
graph.push(`[${prev}]fade=t=in:st=0:d=0.6,fade=t=out:st=${f3(outTotal - 1.2)}:d=1.2,format=yuv420p[v]`)

/* ── music ── */
let music = MUSIC
if (!music) {
  music = path.join(DIR, 'pad.wav')
  // Four chords, 10 s each, looping: Cmaj7 · Am7 · Fmaj7 · G6. Each voice has a
  // slow attack and release so the change is a swell, not a step; a second,
  // slightly detuned set adds width; the low-pass keeps it out of the way.
  const chords = [
    [261.63, 329.63, 392.00, 493.88],   // C E G B
    [220.00, 261.63, 329.63, 392.00],   // A C E G
    [174.61, 220.00, 261.63, 329.63],   // F A C E
    [196.00, 246.94, 293.66, 329.63],   // G B D E
  ]
  const L = 10
  const env = `min(1,mod(t,${L})/2.5)*min(1,(${L}-mod(t,${L}))/2.5)`
  const chordExpr = chords.map((c, i) => {
    const voices = c.map((f) => `sin(2*PI*${f}*t)+0.6*sin(2*PI*${(f * 1.004).toFixed(2)}*t)+0.35*sin(2*PI*${(f / 2).toFixed(2)}*t)`).join('+')
    return `eq(mod(floor(t/${L}),4),${i})*(${voices})`
  }).join('+')
  const expr = `0.045*(${env})*(${chordExpr})*(0.85+0.15*sin(2*PI*0.11*t))`
  ff(['-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=44100:d=${Math.ceil(srcTotal + 2)}`,
    '-af', 'lowpass=f=1400,aecho=0.6:0.5:180|360:0.25|0.15', '-c:a', 'pcm_s16le', music])
}
// Bring whatever track it is to a quiet, even bed: about -30 LUFS.
const audio = `[1:a]atrim=0:${f3(outTotal)},loudnorm=I=-30:TP=-8:LRA=9,afade=t=in:st=0:d=3,afade=t=out:st=${f3(outTotal - 4)}:d=4[a]`

/* ── render ── */
console.log(`polish: ${n} chapters, ${cues.length} subtitle cues, ${srcTotal.toFixed(0)}s → ${outTotal.toFixed(0)}s`)
ff(['-i', IN, '-stream_loop', '-1', '-i', music, '-i', srtFile,
  '-filter_complex', [...graph, audio].join(';'),
  '-map', '[v]', '-map', '[a]', '-map', '2:s',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '128k', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
  '-movflags', '+faststart', '-t', f3(outTotal), OUT])

const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1)
console.log(`\n${OUT}\n${Math.floor(outTotal / 60)}m ${String(Math.round(outTotal % 60)).padStart(2, '0')}s · ${mb} MB\nsubtitles: ${srtFile}`)
