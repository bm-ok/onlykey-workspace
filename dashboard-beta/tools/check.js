'use strict'

// DOES IT COMPILE. Nothing else.
//
// This exists because the alternative kept being reached for and is the wrong
// tool: `npm run restart` rebuilds AND relaunches the app, ninety seconds, and
// takes the running window down with it — to answer a question that is about
// the source and not about the process. The dev server already rebuilds on save
// in about five seconds, so a change that is going to be looked at needs
// neither.
//
// What it does not tell you is whether the thing WORKS. A pane that compiles and
// draws nothing compiles perfectly. That answer comes from the window:
//
//     node tools/okc.js show --tab X --pane Y
//     node tools/okc.js capture --name n
//     npm run walk
//
// WRITES NOTHING. `dist/` is what the dev server serves out of and what
// build.js clears and fills; a check that emitted into it would leave the
// running app serving a production bundle it never asked for. So the output
// filesystem is a memory one and the real `dist/` is not touched.
//
// BOTH HALVES, because they are separate compilations that fail separately.
// The window half is the panes, the server half is the actions — and the one
// that breaks is reliably the one not being looked at.

const path = require('node:path')
const webpack = require('webpack')

const ROOT = path.resolve(__dirname, '..')
const configs = require(path.join(ROOT, 'webpack.config.js'))

// A NO-OP FILESYSTEM. webpack's output interface, with every write thrown away.
// Cheaper than memfs and one less dependency for something that reads nothing
// back.
const nowhere = {
  join: path.join.bind(path),
  mkdir (dir, opts, cb) { (cb || opts)(null) },
  writeFile (file, data, cb) { cb(null) },
  stat (file, cb) { cb(Object.assign(new Error('not written'), { code: 'ENOENT' })) },
  readFile (file, cb) { cb(Object.assign(new Error('not written'), { code: 'ENOENT' })) },
  unlink (file, cb) { cb(null) },
  rmdir (dir, cb) { cb(null) }
}

// DEVELOPMENT MODE, which is what the dev server is running. Production mode
// minifies, which is slower and can only report the same errors — and the whole
// point of this is to be quick enough to run instead of guessing.
const config = configs({}, { mode: 'development' })
const halves = Array.isArray(config) ? config : [config]

const compiler = webpack(halves.map(c => Object.assign({}, c, {
  // The hot client is an entry the dev server injects. It compiles fine here,
  // but it is not part of the source being checked.
  entry: strip(c.entry),
  // Nothing is read back, so the fastest one that still reports honest errors.
  devtool: false
})))
compiler.outputFileSystem = nowhere

function strip (entry) {
  if (Array.isArray(entry)) {
    const kept = entry.filter(e => !String(e).includes('webpack-hot-middleware'))
    return kept.length === 1 ? kept[0] : kept
  }
  return entry
}

compiler.run((err, stats) => {
  compiler.close(() => {})

  if (err) {
    console.error(err.stack || String(err))
    process.exit(1)
  }

  // ERRORS AND WARNINGS BOTH, because babel reports a good deal as a warning and
  // "it compiled" over the top of six warnings is how they become permanent.
  const said = stats.toString({ all: false, errors: true, warnings: true, colors: true, errorDetails: true })
  if (said.trim()) console.log(said)

  if (stats.hasErrors()) {
    console.error('\nit does not compile.')
    process.exit(1)
  }

  const each = (stats.stats || [stats]).map(s => s.compilation.name || 'bundle')
  console.log('compiles: ' + each.join(', ') + '. that is all this says —')
  console.log('whether it WORKS comes from the window: okc.js show, okc.js capture, npm run walk.')
})
