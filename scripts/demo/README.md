# The demo film

A ten-minute Hinglish walkthrough of the software, narrated, for showing to shop
owners. It records the **real built app** driven the way a shopkeeper would drive
it — nothing is mocked up, so the film cannot drift away from what the software
actually does.

## Making it

```bash
npm run build                      # the film records dist/, so build first
export SARVAM_KEY=...              # paid key — never commit it
node scripts/demo/make.mjs         # → demo/parivar-demo-hinglish.mp4
```

`capturePage` only paints inside a real desktop session, so the recorder has to
run in the **foreground**. `make.mjs` runs the whole thing in one go; if your
shell will not sit still for ten minutes, record it in parts instead and build at
the end:

```bash
export DEMO_WORK=/some/scratch/dir
node scripts/demo/tts.mjs
DEMO_PART=1 DEMO_SCENES="intro,items,barcode"                  npx electron scripts/demo/record.cjs
DEMO_PART=2 DEMO_SCENES="customers,suppliers,purchase,sales"   npx electron scripts/demo/record.cjs
DEMO_PART=3 DEMO_SCENES="receipts,orders,refining,karagir"     npx electron scripts/demo/record.cjs
DEMO_PART=4 DEMO_SCENES="reports,closing"                      npx electron scripts/demo/record.cjs
node scripts/demo/build.mjs demo/parivar-demo-hinglish.mp4
```

Parts are independent processes with their own seeded shop, so they can be
re-recorded one at a time — fix a scene, re-record only its part, rebuild.

## How it is put together

| file | what it does |
|---|---|
| `scenes.cjs` | the script: narration text + **beats** (actions timed in seconds from the start of that scene's voice) |
| `tts.mjs` | Sarvam `bulbul:v3` → one WAV per scene, and its exact duration |
| `record.cjs` | drives the real app, writes a timestamped JPEG per frame |
| `build.mjs` | stitches the parts, cuts video to the real frame timings, lays the voice down |

**The voice is made first and the picture is cut to it.** A scene holds until its
narration has finished (and until its last beat has fired, whichever is later),
so the film can never talk over itself or cut away mid-sentence.

**Frames carry their own timestamps.** `capturePage` runs at whatever rate the
machine manages, so encoding at a fixed frame rate would slowly slide the picture
away from the voice — over ten minutes that is very visible. Each frame instead
gets exactly the duration it really occupied.

## Changing the script

Edit `scenes.cjs`, re-run `tts.mjs`, re-record the affected part, rebuild.

Two things to keep right:

- **Keep every beat inside its narration.** A beat timed past the last word still
  fires (the scene waits for it) but it will play over silence. `tts.mjs` prints
  each scene's length — check your last beat against it.
- **Whatever the voice promises, the screen must show.** A sentence about the GST
  return playing over an empty report, or about a customer's khata over a "Select
  a party" placeholder, does more harm than saying nothing. `record.cjs` seeds a
  fortnight of trading (`tradingHistory`) precisely so every screen has something
  real on it; extend it rather than letting a screen come up empty.

Narration is Latin-script Hinglish. Sarvam speaks it correctly — verified by
transcribing its own output back and comparing.

## The silent feature tour (no voice needed)

A second, caption-driven film that covers **every screen and flow**, recorded the same way
(the real built app, a seeded shop, one timestamped frame at a time) but with no narration —
so it can be remade the day a feature lands.

```bash
npm run demo:tour      # build, record all parts, merge → demo/parivar-full-tour-1.26.mp4
node scripts/demo/polish.mjs demo/parivar-full-tour-1.26.mp4 demo/parivar-full-tour-1.26-final.mp4
```

| file | what it does |
|---|---|
| `tour-scenes.cjs` | the chapters: title card, beats, the caption shown for each beat, `shot` names |
| `tour.cjs` | records one PART (`DEMO_PART=n`) → `demo/tour/part-n.mp4` + `part-n.json` (chapter times) |
| `merge.mjs` | joins the parts and writes a `-chapters.txt` index |
| `polish.mjs` | post-production: SRT subtitle track from the captions, slow zoom on chapter cards, dip-to-black between chapters, and a soft music bed (`--music track.mp3` to use a licensed one) |
| `features.cjs` | a short clip of just the newest features |
| `helpers.cjs` / `history.cjs` | the in-page driver and the seeded trading history, shared with the narrated film |

Beats with `shot: 'name'` also save `docs/shots/name.png`; the Shop Owner's Manual
(`docs/shop-owner-manual.html`, `npm run manual:owner`) uses those, so the pictures in the book
are the same screens as in the film.

**Record one part at a time.** `capturePage` needs the window on a real desktop, and two
recorders (or any other Electron job) running at once starve each other of frames.
