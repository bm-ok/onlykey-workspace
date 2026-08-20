'use strict'

// Builds the packaged app.
//
//   1. webpack the window and server halves, production mode
//   2. fold the window half into dist/assets.json, so it can be served from
//      memory instead of from a file on disk
//   3. webpack src/main.prod.js into one file that carries everything —
//      express, socket.io, the plugins, and those assets
//   4. nwjc that into main.bin, which is native code, not javascript
//   5. stage build/app: a manifest, app.html, main.bin, the icon. no .js
//
// tools/pack.js takes it from there and runs nw-builder over build/app.
//
// nwjc output is tied to one platform and one nw.js version, so this has to run
// on each target with the matching runtime — the same nw the app will ship.

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const webpack = require('webpack')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const STAGE = path.join(ROOT, 'build', 'app')

const pkg = require(path.join(ROOT, 'package.json'))
const configs = require(path.join(ROOT, 'webpack.config.js'))

function run (config) {
  return new Promise((resolve, reject) => {
    webpack(config, (err, stats) => {
      if (err) return reject(err)
      if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })))
      console.log(stats.toString({ all: false, assets: true, colors: true }))
      resolve(stats)
    })
  })
}

function nwjcPath () {
  const nwRoot = path.join(ROOT, 'node_modules', 'nw')
  const exe = process.platform === 'win32' ? 'nwjc.exe' : 'nwjc'
  for (const dir of fs.readdirSync(nwRoot).filter(d => d.startsWith('nwjs'))) {
    const candidate = path.join(nwRoot, dir, exe)
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('nwjc not found. it ships with the sdk build of nw — check package.json pins nw to a -sdk version')
}

;(async () => {
  fs.rmSync(DIST, { recursive: true, force: true })
  fs.rmSync(STAGE, { recursive: true, force: true })

  // 1. the two halves the app serves and runs
  console.log('building the window and server halves')
  await run(configs({}, { mode: 'production' }))

  // 2. the window half becomes data, so no .js of it reaches the package
  const assets = {}
  for (const name of fs.readdirSync(DIST)) {
    if (name === 'server.js' || name.endsWith('.map') || name === 'assets.json') continue
    assets[name] = fs.readFileSync(path.join(DIST, name), 'utf8')
  }
  fs.writeFileSync(path.join(DIST, 'assets.json'), JSON.stringify(assets))
  console.log('folded ' + Object.keys(assets).join(', ') + ' into assets.json')

  // 3. one bundle with everything in it
  console.log('building the packaged main')
  await run(configs({}, { mode: 'production', bundle: 'main' }))

  // 4. javascript in, native code out
  const bin = path.join(DIST, 'main.bin')
  console.log('compiling with ' + path.relative(ROOT, nwjcPath()))
  execFileSync(nwjcPath(), [path.join(DIST, 'main.js'), bin], { stdio: 'inherit' })

  // 5. stage exactly what ships
  fs.mkdirSync(STAGE, { recursive: true })

  // nw-builder wants an .ico for the executable on windows. an ico can just
  // carry a png, so this is derived from icon.png rather than kept beside it.
  const png = fs.readFileSync(path.join(ROOT, 'icon.png'))
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18)
  fs.writeFileSync(path.join(ROOT, 'icon.ico'), Buffer.concat([header, png]))

  fs.copyFileSync(bin, path.join(STAGE, 'main.bin'))
  fs.copyFileSync(path.join(ROOT, 'icon.png'), path.join(STAGE, 'icon.png'))

  // the page exists only to load the binary. it is the app's `main`, hidden,
  // and it is local — which is what gives it the node access the compiled code
  // needs, and what gives it a window for evalNWBin to be called on at all.
  fs.writeFileSync(path.join(STAGE, 'app.html'),
    '<!doctype html>' +
    '<meta charset="utf-8">' +
    '<title>' + (pkg.title || pkg.name) + '</title>' +
    '<script>nw.Window.get().evalNWBin(null, "main.bin");</script>')

  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({
    name: pkg.name,
    title: pkg.title,
    version: pkg.version,
    description: pkg.description,
    author: pkg.author,
    license: pkg.license,
    main: 'app.html',
    window: { show: false, width: 1, height: 1 }
  }, null, 2))

  const shipped = fs.readdirSync(STAGE)
  console.log('\nstaged build/app: ' + shipped.join(', '))
  const js = shipped.filter(f => f.endsWith('.js'))
  if (js.length) throw new Error('javascript reached the package: ' + js.join(', '))
  console.log('no .js in the package')
})().catch(err => {
  console.error(err.message || err)
  process.exit(1)
})
