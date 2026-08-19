/**
 * Builds the shareable Windows installer.
 *
 *   npm run dist   →  release/Parivar-Jewellery-ERP-Setup-<version>.exe
 *
 * Why this is a script and not just `electron-builder --win`:
 * electron-builder downloads a "winCodeSign" toolkit to sign the exe and to run
 * rcedit (which stamps the icon and version info onto it). That archive contains
 * macOS symlinks, and Windows refuses to extract symlinks unless Developer Mode is
 * on or the build runs as administrator — so the normal one-shot build fails on a
 * standard Windows box.
 *
 * So we skip that toolkit (`signAndEditExecutable: false` in package.json), build the
 * app unpacked, stamp the icon ourselves with a copy of rcedit, and then package the
 * installer from the prepared folder. Same result, no elevation needed.
 */
const { execFileSync, execSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.join(__dirname, '..')
const run = (cmd) => {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

/** rcedit lives inside whichever winCodeSign folder managed to extract. */
function findRcedit() {
  const cache = path.join(os.homedir(), 'AppData', 'Local', 'electron-builder', 'Cache', 'winCodeSign')
  if (!fs.existsSync(cache)) return null
  for (const dir of fs.readdirSync(cache)) {
    const exe = path.join(cache, dir, 'rcedit-x64.exe')
    if (fs.existsSync(exe)) return exe
  }
  return null
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const version = pkg.version

console.log(`Building Parivar Jewellery ERP ${version} installer`)

// 1 — renderer
run('npx vite build')

// 2 — unpacked application folder
run('npx electron-builder --win --x64 --dir')

// 3 — stamp the icon and version info onto the exe
const exe = path.join(root, 'release', 'win-unpacked', `${pkg.build.productName}.exe`)
const rcedit = findRcedit()
if (rcedit && fs.existsSync(exe)) {
  console.log('\n> applying icon and version info')
  execFileSync(rcedit, [
    exe,
    '--set-icon', path.join(root, 'build', 'icon.ico'),
    '--set-version-string', 'ProductName', pkg.build.productName,
    '--set-version-string', 'FileDescription', pkg.build.productName,
    '--set-version-string', 'CompanyName', pkg.author || 'Parivar',
    '--set-version-string', 'OriginalFilename', `${pkg.build.productName}.exe`,
    '--set-file-version', version,
    '--set-product-version', version,
  ], { stdio: 'inherit' })
} else {
  console.warn(
    '\n! rcedit not found — the installer will still build, but the .exe will show\n' +
    "  Electron's default icon in Explorer. Run a normal `npx electron-builder --win`\n" +
    '  once (it may fail) to populate the cache, then re-run this script.'
  )
}

// 4 — installer
run('npx electron-builder --win nsis --x64 --prepackaged "release/win-unpacked"')

const out = path.join(root, 'release', `Parivar-Jewellery-ERP-Setup-${version}.exe`)
if (fs.existsSync(out)) {
  const mb = (fs.statSync(out).size / 1048576).toFixed(1)
  console.log(`\nInstaller ready:\n  ${out}\n  ${mb} MB\n`)
} else {
  console.error('\nInstaller was not produced — check the output above.')
  process.exit(1)
}
