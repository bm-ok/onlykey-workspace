'use strict'

// Packages build/app into a runnable application with nw-builder.
//
// Run tools/build.js first — this only wraps what that staged. The runtime it
// downloads must be the same version as the sdk that compiled main.bin, since
// nwjc output is tied to one nw.js version and one platform.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const STAGE = path.join(ROOT, 'build', 'app')
const OUT = path.join(ROOT, 'build', 'out')

const pkg = require(path.join(ROOT, 'package.json'))

// the nw devDependency is pinned to an -sdk version; the app ships the plain
// build of the same version, which has no devtools in it
const version = String(pkg.devDependencies.nw).replace(/[^0-9.]/g, '').replace(/\.$/, '')

;(async () => {
  if (!fs.existsSync(path.join(STAGE, 'main.bin')))
    throw new Error('build/app is not staged. run: npm run build')

  // nw-builder is esm only, which is fine out here under plain node
  const { default: nwbuild } = await import('nw-builder')

  fs.rmSync(OUT, { recursive: true, force: true })

  console.log('packaging build/app with nw.js ' + version)

  const platform = { win32: 'win', darwin: 'osx', linux: 'linux' }[process.platform]
  const name = pkg.title || pkg.name

  // nw-builder asks for different things per platform, and refuses to start if
  // they are missing. macos wants the CFBundle set and an .icns; there is no
  // .icns here, and it is the one field it does not insist on, so it goes
  // without rather than shipping a fabricated one.
  const app = platform === 'osx'
    ? {
        name,
        CFBundleName: name,
        CFBundleDisplayName: name,
        CFBundleSpokenName: name,
        CFBundleVersion: pkg.version,
        CFBundleShortVersionString: pkg.version,
        NSHumanReadableCopyright: pkg.license || ''
      }
    : {
        name,
        // windows takes an .ico, linux takes the png as it is
        icon: path.join(ROOT, platform === 'win' ? 'icon.ico' : 'icon.png'),
        version: pkg.version,
        fileDescription: pkg.description
      }

  await nwbuild({
    mode: 'build',
    srcDir: STAGE,
    outDir: OUT,
    version,
    flavor: 'normal',
    platform,
    arch: process.arch,
    glob: false,
    cacheDir: path.join(ROOT, 'build', 'cache'),
    app
  })

  const shipped = fs.readdirSync(OUT)
  console.log('\npackaged into build/out')
  const js = shipped.filter(f => f.endsWith('.js'))
  console.log(js.length ? 'note: nw.js ships these itself: ' + js.join(', ') : 'no .js at the top level')
})().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
