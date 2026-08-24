const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const configs = require('../../webpack.config.js')({}, { mode: 'development' });
const windowBundle = configs.find((c) => c.name == 'window');
const server = configs.find((c) => c.name == 'server');

//the externals rule shipped broken once: it matched anything starting with a
//letter, which on windows includes the entry's own absolute path (C:\...), so
//webpack emitted a stub that re-required the entry and node choked on the jsx.

function externalize(request) {
    return new Promise((resolve) => {
        server.externals[0]({ request }, (err, result) => resolve(result));
    });
}

test('bare specifiers stay external on the server', async () => {
    assert.equal(await externalize('express'), 'commonjs express');
    assert.equal(await externalize('@bmatusiak/rectify'), 'commonjs @bmatusiak/rectify');
});

test('relative and absolute requests are bundled, not externalized', async () => {
    assert.equal(await externalize('./app/storage'), undefined);
    assert.equal(await externalize('../overlay'), undefined);
    assert.equal(await externalize(path.join(__dirname, '..', '..', 'src', 'server.js')), undefined);
    assert.equal(await externalize('/srv/app/src/server.js'), undefined);
});

test('both bundles resolve the same extensions', () => {
    //THIS ASKED ABOUT .ts UNTIL TYPESCRIPT WAS REMOVED. What it is really about
    //is that the two bundles agree: a require that resolves in the window half
    //and not in the node half is a difference nobody would find until the one
    //that failed happened to run.
    for (const c of [windowBundle, server]) {
        assert.ok(c.resolve.extensions.includes('.js'), c.name + ' cannot resolve .js');
        assert.ok(c.resolve.extensions.includes('.jsx'), c.name + ' cannot resolve .jsx');
        assert.ok(!c.resolve.extensions.includes('.ts'),
            c.name + ' still resolves .ts, and nothing here is typescript any more');
    }
    assert.deepStrictEqual(windowBundle.resolve.extensions, server.resolve.extensions,
        'the two bundles resolve different extensions, so a require can work in one half and not the other');
});

//the packaged main is the one bundle that must carry everything, since the
//package has no node_modules beside it
const main = require('../../webpack.config.js')({}, { mode: 'production', bundle: 'main' })[0];

test('the packaged main bundles everything, externalising nothing', () => {
    assert.equal(main.name, 'main');
    assert.equal(main.target, 'node');
    assert.equal(main.externals, undefined, 'an external would be missing at runtime');
});

test('the packaged main is told it is packaged', () => {
    const defines = main.plugins
        .filter((p) => p.definitions)
        .map((p) => p.definitions.BUILD_PROD)
        .filter((v) => v !== undefined);
    assert.deepEqual(defines, ['true'], 'BUILD_PROD gates webpack itself out of the package');
});

test('the window bundle is named after its entry, not main.js', () => {
    //otherwise it overwrites the packaged main, which also writes into dist
    assert.equal(windowBundle.output.filename, 'window.js');
    assert.notEqual(windowBundle.output.filename, main.output.filename);
});

test('the window is a web bundle and the server is a node one', () => {
    assert.equal(windowBundle.target, 'web');
    assert.equal(server.target, 'node');
    assert.equal(server.output.library.type, 'commonjs2');
});

//---- the payloads, which are copied rather than bundled ---------------------
//
//A HANDFUL OF FILES GO INTO `dist/` AS THEMSELVES — a credential helper, the
//provisioning scripts, what a job is handed, and the git hook that refuses a
//push. They are read by something other than this process (a shell, a guest's
//node, git) so bundling one would rewrite it into something only webpack can
//load.
//
//THE COPY SKIPS A SOURCE THAT IS NOT THERE, SILENTLY. `copyPayloads` does
//`if (!fs.existsSync(from)) continue`, which is the right thing for a build that
//should not fail over an optional folder and the wrong thing for a typo: the
//pattern reads fine, the build is green, and the file simply is not in `dist/`.
//
//WHAT THAT COSTS IS NOT THE SAME FOR EACH. A missing credential-helper.js is an
//ENOENT at a push — loud, and pointing at a file. A missing `git-hooks/
//pre-receive` is SILENT AND WORSE: git treats a `core.hooksPath` with no hook
//in it as no hook at all, which means ALLOW. A machine would be able to push
//anything to any branch it could reach, and nothing anywhere would say a word.
//
//So this reads the patterns out of the config text — the same trick
//./plugins.test.js uses on the boot files, for the same reason: a copy of the
//list would be a copy that drifts.
const fs = require('node:fs');
const ROOT = path.join(__dirname, '..', '..');

function payloadSources() {
    const src = fs.readFileSync(path.join(ROOT, 'webpack.config.js'), 'utf8');
    const block = src.slice(src.indexOf('const PAYLOADS = ['));
    const list = block.slice(0, block.indexOf('\n    ];'));

    const out = [];
    for (const m of list.matchAll(/from:\s*path\.join\(__dirname,\s*([^)]*)\),\s*to:\s*'([^']*)'/g)) {
        const parts = m[1].split(',')
            .map((p) => p.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);
        out.push({ from: path.join(ROOT, ...parts), to: m[2] });
    }
    return out;
}

test('every payload the build copies is a path that exists', () => {
    const sources = payloadSources();

    //A SCAN THAT FOUND NOTHING PASSES EVERYTHING.
    assert.ok(sources.length >= 5,
        'only ' + sources.length + ' payload sources were read out of the config, so this check is inert');

    const missing = sources.filter((p) => !fs.existsSync(p.from));
    assert.deepStrictEqual(missing.map((p) => path.relative(ROOT, p.from)), [],
        'these are copied into dist/ by a pattern whose source is not there — the copy skips them without a word');
});

test('the git hook is one of them, and it is a hook git will run', () => {
    //MATCHED ON WHERE IT LANDS, NOT ON WHERE IT COMES FROM, and the name is read
    //out of the code that reaches for it rather than written here twice. The
    //source moved folders once already — from ../repos to ../gitserve — and a
    //test keyed on the source path went red for a reason that had nothing to do
    //with what it is checking. What must not drift is the DESTINATION, because
    //`core.hooksPath` is built from it.
    const serve = fs.readFileSync(
        path.join(ROOT, 'src', 'app', 'repositories', 'gitserve', 'serve.js'), 'utf8');
    const named = /path\.join\(__dirname,\s*'([^']+)'\)/.exec(serve);
    assert.ok(named, 'gitserve/serve.js no longer builds its hooks path from __dirname');

    const sources = payloadSources();
    const copied = sources.find((p) => p.to === named[1]);

    assert.ok(copied, 'nothing copies a folder to "' + named[1] + '", which is where core.hooksPath points — '
        + 'a push would meet no hook at all, and git treats no hook as allow');
    const hooks = copied.from;

    //NAMED `pre-receive` AND NOTHING ELSE. Git looks for that exact name; a file
    //called `pre-receive.sh` is not a hook, it is a file sitting next to where
    //the hook should be, and the push it should have refused goes through.
    const at = path.join(hooks, 'pre-receive');
    assert.ok(fs.existsSync(at), 'the hooks folder has no `pre-receive` in it');

    //ITS SHEBANG, AND NO CARRIAGE RETURN IN IT. The root .gitattributes pins
    //this folder to LF because a fresh clone on Windows would otherwise check it
    //out CRLF, and `#!/bin/sh\r` is `bad interpreter`. That is a failure which
    //appears only in a clone, never in a diff, and never on the machine the file
    //was written on.
    const text = fs.readFileSync(at, 'utf8');
    assert.match(text, /^#!/, 'the hook has no shebang, so what runs it is a guess');
    assert.ok(!text.includes('\r'),
        'the hook has carriage returns in it — git will refuse to run it, and a push meets no hook');
});
