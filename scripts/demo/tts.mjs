/**
 * Speaks the narration.
 *
 * One WAV per scene from Sarvam's bulbul:v3, plus the exact duration of each,
 * which is what the recorder uses to decide how long to hold on a screen. The
 * voice is generated FIRST and the picture is cut to it — the other way round
 * you get a demo that talks over itself.
 *
 *   SARVAM_KEY=... DEMO_WORK=... node scripts/demo/tts.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const KEY = process.env.SARVAM_KEY
const WORK = process.env.DEMO_WORK
if (!KEY) { console.error('SARVAM_KEY not set'); process.exit(1) }
if (!WORK) { console.error('DEMO_WORK not set'); process.exit(1) }

const OUT = path.join(WORK, 'audio')
fs.mkdirSync(OUT, { recursive: true })

// Unhurried. The brief was explicitly "don't rush" — a shopkeeper hearing this
// for the first time needs room between the ideas.
const VOICE = {
  target_language_code: 'hi-IN',
  speaker: 'priya',
  model: 'bulbul:v3',
  speech_sample_rate: 22050,
  pace: 0.88,
}
// The API takes far more than this in one go, but shorter requests fail less
// often and splitting on a sentence boundary keeps the prosody natural.
const MAX_CHARS = 1400

const seconds = (f) => Number(execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim())

/** Split on sentence ends, never mid-word, staying under the request limit. */
function chunk(text) {
  const parts = text.match(/[^.!?]+[.!?]*\s*/g) || [text]
  const out = []
  let cur = ''
  for (const p of parts) {
    if ((cur + p).length > MAX_CHARS && cur) { out.push(cur.trim()); cur = '' }
    cur += p
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

async function speak(text, file) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: { 'api-subscription-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...VOICE, text }),
    })
    if (r.ok) {
      fs.writeFileSync(file, Buffer.from((await r.json()).audios[0], 'base64'))
      return
    }
    const body = (await r.text()).slice(0, 200)
    if (attempt === 4) throw new Error(`TTS failed (${r.status}): ${body}`)
    console.log(`   retry ${attempt} after ${r.status}`)
    await new Promise((res) => setTimeout(res, 1500 * attempt))
  }
}

const scenes = require('./scenes.cjs')({ ids: {} })
const manifest = {}

for (const s of scenes) {
  const pieces = chunk(s.text)
  const files = []
  for (let i = 0; i < pieces.length; i++) {
    const f = path.join(OUT, `${s.id}-${i}.wav`)
    await speak(pieces[i], f)
    files.push(f)
  }

  let final = files[0]
  if (files.length > 1) {
    // Join the pieces of one scene into a single track so the recorder has one
    // duration to hold to.
    const list = path.join(OUT, `${s.id}.txt`)
    fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'))
    final = path.join(OUT, `${s.id}.wav`)
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0',
      '-i', list, '-c', 'copy', final])
  }

  const d = seconds(final)
  manifest[s.id] = { file: final.replace(/\\/g, '/'), duration: d, chars: s.text.length }
  console.log(`  ${s.id.padEnd(11)} ${d.toFixed(1)}s  (${pieces.length} part${pieces.length > 1 ? 's' : ''})`)
}

fs.writeFileSync(path.join(WORK, 'audio.json'), JSON.stringify(manifest, null, 1))
const total = Object.values(manifest).reduce((a, m) => a + m.duration, 0)
console.log(`\nnarration ${(total / 60).toFixed(1)} min across ${scenes.length} scenes`)
