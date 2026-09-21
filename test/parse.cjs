/**
 * CSV / paste parsing for the tag entry grid.
 *
 * This is the one place where a column being added or moved can silently put a
 * value in the wrong field — a stray HUID read as a cost price writes bad data
 * with no error. So the parser is pinned here rather than left to the UI tests.
 *
 * Runs on plain node (no Electron): esbuild bundles the page component to a
 * temp file so the exported parser can be imported directly.
 *    node ./test/parse.cjs
 */
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const esbuild = require('esbuild')

let pass = 0
let fail = 0

function eq(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    pass++
    console.log(`  PASS  ${label} = ${JSON.stringify(actual)}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
  }
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parivar-parse-'))
  const out = path.join(tmp, 'tagstock.mjs')
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'pages', 'TagStock.tsx')],
    bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent',
    loader: { '.jpeg': 'dataurl', '.png': 'dataurl' },
  })
  const { parseRows } = await import(`file://${out.replace(/\\/g, '/')}`)

  // Defaults stand in for the "apply to every row" panel above the grid.
  const d = {
    purity: 91.6, mkg_per_gm: 300, hallmark_charges: 45,
    purchase_rate: 5000, location: 'Shop', gst_pct: 3,
  }

  console.log('\n── 1. Current template ─────────────────────────')
  let r = parseRows(
    'Gross Wt,Black Beads,Stone Wt,Purity,Making/gm,Hallmark,Cost/Gm,Qty,HUID,Location\n' +
    '10.000,0,0,91.6,300,45,5800,,,Shop\n', d)[0]
  eq('gross weight', r.gross_wt, 10)
  eq('cost per gram', r.purchase_rate, 5800)
  eq('location', r.location, 'Shop')

  console.log('\n── 2. Older template, no Cost column ───────────')
  // The regression that matters: with positional parsing the HUID would land in
  // purchase_rate and Location would shift into HUID, silently.
  r = parseRows(
    'Gross Wt,Black Beads,Stone Wt,Purity,Making/gm,Hallmark,Qty,HUID,Location\n' +
    '12.500,0,0.250,91.6,300,45,,ABC123,Locker\n', d)[0]
  eq('gross weight', r.gross_wt, 12.5)
  eq('stone weight', r.stone_wt, 0.25)
  eq('HUID not read as a cost', r.huid, 'ABC123')
  eq('location not shifted', r.location, 'Locker')
  eq('missing cost falls back to default', r.purchase_rate, 5000)

  console.log('\n── 3. Headerless paste uses grid order ─────────')
  r = parseRows('10,0,0,91.6,300,45,5800,2,XY9,Vault', d)[0]
  eq('cost per gram', r.purchase_rate, 5800)
  eq('qty', r.qty, 2)
  eq('HUID', r.huid, 'XY9')
  eq('location', r.location, 'Vault')

  console.log('\n── 4. Reordered header, tab separated ──────────')
  r = parseRows('Qty\tLocation\tGross Wt\tCost/Gm\n3\tSafe\t8\t6100', d)[0]
  eq('gross weight', r.gross_wt, 8)
  eq('cost per gram', r.purchase_rate, 6100)
  eq('location', r.location, 'Safe')
  eq('unlisted column falls back', r.purity, 91.6)

  console.log('\n── 4b. Stone & diamond rated columns map by name ──')
  r = parseRows('Gross Wt,Stone Wt,Stone Rate,Dia. Wt,Dia. Rate\n20,2,500,1,10000', d)[0]
  eq('stone weight', r.stone_wt, 2)
  eq('stone rate', r.stone_rate, 500)
  eq('diamond weight', r.diamond_wt, 1)
  eq('diamond rate', r.diamond_rate, 10000)

  console.log('\n── 5. Junk rows dropped ────────────────────────')
  eq('blank line dropped', parseRows('Gross Wt,Qty\n,\n5,\n', d).length, 1)
  eq('empty input', parseRows('', d).length, 0)
  eq('header only', parseRows('Gross Wt,Qty\n', d).length, 0)

  fs.rmSync(tmp, { recursive: true, force: true })

  console.log(`\n${'═'.repeat(50)}`)
  console.log(`${pass} passed, ${fail} failed`)
  console.log('═'.repeat(50))
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('\nUNCAUGHT:', e.stack || e.message)
  process.exit(1)
})
