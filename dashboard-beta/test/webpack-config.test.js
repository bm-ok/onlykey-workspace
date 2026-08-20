const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const configs = require('../webpack.config.js')({}, { mode: 'development' });
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
    assert.equal(await externalize(path.join(__dirname, '..', 'src', 'server.js')), undefined);
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
const main = require('../webpack.config.js')({}, { mode: 'production', bundle: 'main' })[0];

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
