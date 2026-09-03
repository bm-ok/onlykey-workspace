const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const express = require('express');
const webpack = require('webpack');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');

//builds the real server entry and runs it against a real express + socket.io,
//which is the half nothing else exercises outside nw. the window half needs a
//dom, so it is covered by the app itself, not from here.

const serverConfig = require('../../webpack.config.js')({}, { mode: 'development' })
    .find((c) => c.name == 'server');

let server, ioServer, loaded, url, router, inBundle;

before(async () => {
    const stats = await new Promise((resolve, reject) => {
        webpack(serverConfig).run((err, s) => (err ? reject(err) : resolve(s)));
    });
    assert.ok(!stats.hasErrors(), stats.toString({ all: false, errors: true }));

    //WHICH SOURCE FILES ARE ACTUALLY IN THIS BUNDLE, asked of the compilation
    //rather than guessed from the filename. Used by the service-member check
    //below, which is only meaningful about code running in THIS graph — see the
    //block above it for the three different `app` objects that made this
    //necessary.
    inBundle = new Set(
        (stats.toJson({ all: false, modules: true }).modules || [])
            .map((m) => m.nameForCondition)
            .filter(Boolean)
            .map((f) => path.resolve(f))
    );

    const app = express();
    router = express.Router();
    app.use((req, res, next) => router(req, res, next));

    server = http.createServer(app);
    ioServer = new Server(server);

    const bundle = path.join(serverConfig.output.path, serverConfig.output.filename);
    delete require.cache[require.resolve(bundle)];

    loaded = await require(bundle)({
        express,
        router,
        httpServer: server,
        io: ioServer,
        appPackage: { title: 'Test App', name: 'test-app', version: '9.9.9' }
        //no window and no tray: the plain node case, which is what this test is
    });

    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = 'http://127.0.0.1:' + server.address().port;
}, { timeout: 120000 });

after(() => {
    try { ioServer.close(); } catch (e) { /* already gone */ }
    try { server.close(); } catch (e) { /* already gone */ }
});

test('the plugin graph resolves on the server side', () => {
    const services = loaded.app.services;
    for (const name of ['app', 'io', 'appPackage', 'window', 'tray'])
        assert.ok(name in services, 'missing service: ' + name);
});

test('the window half is not in this bundle at all', () => {
    const services = loaded.app.services;
    //react, theme and storage are window.js files, so they are not here to stub
    for (const name of ['react', 'theme', 'session', 'config'])
        assert.ok(!(name in services), name + ' leaked into the server bundle');
});

test('nw services are absent without nw.js, rather than half present', () => {
    const services = loaded.app.services;
    assert.equal(services.window, undefined);
    assert.equal(services.tray, undefined);
});

test('what is mounted on the swappable router is what the app serves', async () => {
    //THIS USED TO ASK THE EXAMPLE PLUGIN FOR /api/hello — the plugin the
    //scaffold's own README says to delete. A test that passes only while a
    //disposable folder is still there is one that breaks the first time
    //somebody follows the instructions, and it broke exactly then.
    //
    //The property is the ROUTER's and not any plugin's: the express app defers
    //to a router held in a variable, so a server half can mount on it and a
    //reload can throw the whole set away rather than stacking another copy of
    //every route on top. That is worth proving whether or not anything happens
    //to be mounting today — and right now nothing is, because the plugin that
    //talks to the dashboard uses socket.io rather than routes.
    router.get('/api/probe', (req, res) => res.json({ mounted: true }));

    const res = await fetch(url + '/api/probe');
    assert.equal(res.status, 200);
    assert.deepStrictEqual(await res.json(), { mounted: true });

    //AND A FRESH ROUTER TAKES THE OLD ONES AWAY, which is the half that
    //actually matters on reload. Without it every save would leave another
    //copy of every route behind, answering in the order they were added.
    router = express.Router();
    assert.equal((await fetch(url + '/api/probe')).status, 404,
        'a route survived the router being swapped, so a reload would stack routes rather than replace them');
});

test('socket.io answers the handshake and the ping', async () => {
    const socket = connect(url, { transports: ['websocket'] });
    try {
        const appPackage = await new Promise((resolve, reject) => {
            socket.once('app', resolve);
            socket.once('connect_error', reject);
        });
        assert.equal(appPackage.title, 'Test App');
        assert.equal(appPackage.version, '9.9.9');

        const reply = await new Promise((resolve) => socket.emit('ping', {}, resolve));
        assert.equal(reply.pong, true);
    } finally {
        socket.close();
    }
});

//---- reaching for something a service does not have ------------------------
//
//THREE OF THESE IN ONE SESSION, and every one survived every check here:
//
//    remote.parent          `git.origin` answers {url, owner, repo, kind} and
//                           never had a `parent`. It would have shown every
//                           pull request landing in the fork it came from.
//    settings.defaultBranch never existed anywhere.
//    git.nameIsOk           THE FUNCTION EXISTED, one file away, used by
//                           makeBranch. Only the line publishing it on the
//                           service was missing — so a grep found it, reading
//                           the caller made sense, and so did reading the callee.
//
//A FREE MEMBER IS INVISIBLE TO EVERY COMPILE CHECK. `undefined is not a
//function` is a run-time fact about an object; `npm run check` only asks whether
//the bundle builds. The last of the three surfaced when the queue dispatched a
//judgement onto a real machine, which booted, took a credential, and died on the
//way to setting up a repository.
//
//IT LIVES IN THIS FILE BECAUSE THIS FILE ALREADY HAS THE ANSWER. The graph is
//resolved above, so every service OBJECT genuinely exists — this is not a guess
//about what a service might publish, it is the service, asked. Written as its
//own file first, which stood up a SECOND graph and hung until the timeout killed
//it: a real one starts real timers and listeners, and there is no cheap copy.
//
//IT MUST STAY ABOVE THE `destroy()` TEST, which pulls the graph down.
//
//---- what it does not cover, said rather than implied ---------------------
//
//ONLY FILES IN THIS BUNDLE, WHICH IS THE WHOLE OF WHY IT WORKS. There are THREE
//different objects called `app` in this repository — the server service asked
//for here, the rectify host that `main.js` files get (`appPackage`, `isNw`,
//`get`, `use`, `root`, `destroyAll`), and the window's. Checking a `main.js`
//against the server's `app` reported eighteen perfectly correct lines as
//mistakes, which is how a rule gets switched off by whoever inherits it.
//
//THE BUNDLE IS ASKED RATHER THAN THE FILENAME GUESSED. Skipping `main.js` and
//`window.js` by name would be close, and would go wrong on the first plain
//module shared between a server half and a window half. `inBundle` comes off the
//compilation above, so it stays true by construction.
//
//WINDOW SERVICES ARE NOT HERE — `theme`, `react`, `session` are window.js and
//absent from this bundle on purpose, as the test above asserts. A service this
//cannot find is SKIPPED, which is the safe direction: the alternative is a wall
//of failures about things that are fine.
//
//AND ONLY TWO SPELLINGS OF THE REACH: `imports.git.nameIsOk`, and `var git =
//imports.git;` followed by `git.nameIsOk`. A member reached through a name this
//cannot follow — a renaming destructure, a service handed to a factory as
//`d.git` — is not seen. Narrow and right beats broad and noisy, and all three
//above are one of these two shapes.

function walkApp(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'vendor') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walkApp(full));
        else if (e.name.endsWith('.js') || e.name.endsWith('.jsx')) out.push(full);
    }
    return out;
}

//THE THINGS EVERY OBJECT HAS. Reached on a service often enough to matter, and
//never the bug.
const ANY_OBJECT = new Set(['then', 'catch', 'constructor', 'hasOwnProperty', 'toString', 'call', 'apply', 'bind']);

//---- CODE ONLY, WHICH THIS DID NOT DO AND HAD TO ---------------------------
//
//`github.com` in a URL. `"ssh.js"` naming a file. `../vms/busy/given.js` in a
//comment. All of them are `<a bound name>.<identifier>` and none of them is a
//member reach — and a check that reports a domain name as a missing method is
//one nobody reads twice.
//
//COMMENTS BECOME A SPACE AND STRINGS BECOME EMPTY QUOTES, so nothing joins up
//across what was removed and every line number is preserved — the newlines
//inside a block comment are kept, because the report says where.
//
//NOT A PARSER, and it does not need to be: what it can get wrong is a `//`
//inside a regex literal, which costs a missed line rather than a wrong one.
//Erring towards reading less is the safe direction here.
function codeOnly(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        const next = src[i + 1];

        if (c === '/' && next === '/') {
            while (i < src.length && src[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && next === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
                if (src[i] === '\n') out += '\n';
                i++;
            }
            i += 2;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            i++;
            while (i < src.length && src[i] !== quote) {
                if (src[i] === '\\') i++;
                else if (src[i] === '\n') out += '\n';
                i++;
            }
            i++;
            out += quote + quote;
            continue;
        }
        out += c;
        i++;
    }
    return out;
}

test('every service member a plugin reaches for is one the service publishes', () => {
    const services = loaded.app.services;
    const ROOT = path.join(__dirname, '..', '..');
    const APP = path.join(ROOT, 'src', 'app');

    const wrong = new Set();
    let looked = 0;
    let files = 0;

    for (const file of walkApp(APP)) {
        //THE ONE THAT KEEPS THIS HONEST. See the block above.
        if (!inBundle.has(path.resolve(file))) continue;
        files++;

        const src = codeOnly(fs.readFileSync(file, 'utf8'));

        //`var git = imports.git;` and `var { git, log } = imports;`. The second
        //binds each name to the service of the same name, which is what makes it
        //safe to follow; a renaming destructure is not matched, so it is not
        //followed rather than followed wrongly.
        const bound = new Map();
        for (const m of src.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*imports\.([A-Za-z_$][\w$]*)\s*;/g)) {
            bound.set(m[1], m[2]);
        }
        for (const m of src.matchAll(/\b(?:var|let|const)\s*\{([^}]*)\}\s*=\s*imports\s*;/g)) {
            for (const piece of m[1].split(',')) {
                const name = piece.trim();
                if (/^[A-Za-z_$][\w$]*$/.test(name)) bound.set(name, name);
            }
        }

        //---- AND A NAME THE FILE REUSES IS NOT FOLLOWED ------------------
        //
        //`var state = imports.state;` at the top, and `var state = board()`
        //inside a function four hundred lines down. Both are `state.x` and only
        //one of them is the service. The second is ordinary, correct JavaScript
        //and there is nothing to fix in it — reporting it would be this check
        //asking for code to be written around its own limits.
        //
        //SO A NAME BOUND TWICE IS DROPPED ENTIRELY rather than followed for the
        //half of the file where it is right. Losing a real one to that is a
        //miss; keeping it is a false report, and a rule that cries wolf is
        //turned off by whoever inherits it.
        for (const m of src.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=(?!\s*imports\b)/g)) {
            if (bound.has(m[1])) bound.delete(m[1]);
        }
        for (const m of src.matchAll(/\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) {
            for (const piece of m[1].split(',')) {
                const name = piece.trim();
                if (bound.has(name)) bound.delete(name);
            }
        }

        const reaches = [];
        for (const m of src.matchAll(/\bimports\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) {
            reaches.push({ service: m[1], member: m[2] });
        }
        //NOT PRECEDED BY A DOT, which `\b` alone does not say. `keys.github
        //.envForPush()` contains the substring `github.envForPush`, and `github`
        //is a service name — so this reported a member of `keys.github` as a
        //missing member of the `github` service, naming a line that is correct
        //and a service that has nothing to do with it. The most confident kind
        //of wrong answer: a real file, a real line, a real method.
        for (const [local, service] of bound) {
            for (const m of src.matchAll(new RegExp('(?<![.\\w$])' + local + '\\.([A-Za-z_$][\\w$]*)', 'g'))) {
                reaches.push({ service: service, member: m[1] });
            }
        }

        for (const { service, member } of reaches) {
            if (!(service in services)) continue;
            if (ANY_OBJECT.has(member)) continue;

            const on = services[service];
            if (!on || (typeof on !== 'object' && typeof on !== 'function')) continue;

            looked++;
            //`in` RATHER THAN A TRUTHINESS TEST, because a service may publish a
            //null quite legitimately. What is caught is a name nobody ever put
            //on the object at all.
            if (member in on) continue;

            //A SET, because a file writing both `imports.git.x` and `git.x`
            //produces the same finding twice and a doubled list reads as twice
            //the problem.
            const at = src.slice(0, src.indexOf(service + '.' + member)).split('\n').length;
            wrong.add(path.relative(ROOT, file) + ':' + at + ' — reaches "' + service + '.' + member
                + '", which "' + service + '" does not have. It publishes: '
                + Object.keys(on).sort().join(', '));
        }
    }

    //A SCAN THAT FOUND NOTHING PASSES EVERYTHING, and this one has two ways to
    //find nothing: no files, or files with nothing followable in them.
    assert.ok(files > 20, 'only ' + files + ' bundled files were read, so this check is inert');
    assert.ok(looked > 50, 'only ' + looked + ' service members were checked, so this check is inert');

    assert.deepStrictEqual([...wrong], [],
        'these reach for a member the service does not have — undefined at run time, green everywhere else:\n  '
            + [...wrong].join('\n  '));
});

test('one connection handler per half, and each removes its own orphan first', () => {
    //WHAT THIS CAUGHT. `io` is made once and outlives every reload, and both
    //halves that hook `connection` unhook themselves in `onDestroy` — which
    //runs when a half is REPLACED and never when one FAILS TO LOAD. A half that
    //threw on the way up has already registered and will never clean up, so the
    //next good load sits beside the orphan.
    //
    //Every `onConnection` attaches its own `okc:call` listener to the SAME
    //socket, so one press in the window runs the action once per orphan. It
    //showed up as a rebuild refusing itself with "already being deleted" — the
    //first copy taking the busy lock and the rest bouncing off it — and then as
    //the same GitHub comment posted four times, which is the version that
    //cannot be taken back.
    //
    //THE COUNT IS PINNED because it is the cheap half of the check: three
    //server halves hook `connection` — core/io, core/okc and tests — so there
    //should be exactly three listeners after one clean load. Anything that adds
    //a fourth has to come and change this line and say why.
    //
    //(A FOURTH EXISTS IN THE REAL APP and is deliberately not here:
    //core/build/main.js hooks `connection` to tell a page the server half is
    //down. It lives in main, which never reloads, and this harness supplies
    //`io` directly rather than going through it — so its absence is the
    //harness, not a missing guard.)
    const io = loaded.app.services.io;
    assert.equal(io.listenerCount('connection'), 3,
        'expected one connection handler each from core/io, core/okc and tests, found '
            + io.listenerCount('connection'));

    //AND THE GUARD ITSELF, IN THE SOURCE. The behaviour it protects only
    //appears on the SECOND load against one `io`, which this harness cannot
    //stage without building and running the whole bundle twice — so what is
    //asserted here is that no site has quietly gone back to hooking
    //`connection` without first removing what a failed load may have left.
    const root = path.join(__dirname, '..', '..');
    for (const rel of ['src/app/core/okc/server.js', 'src/app/core/io/server.js',
        'src/app/tests/server.js']) {
        const src = fs.readFileSync(path.join(root, rel), 'utf8');
        assert.match(src, /Symbol\.for\(/,
            rel + ' no longer keeps a handle on io, so a failed reload will orphan its handler');
        assert.match(src, /off\('connection'/,
            rel + ' does not remove a previous connection handler before adding its own');
    }
});

test('destroy() unhooks the server half so a reload cannot double register', async () => {
    await loaded.destroy();

    const socket = connect(url, { transports: ['websocket'] });
    try {
        const sawApp = await Promise.race([
            new Promise((resolve) => socket.once('app', () => resolve(true))),
            new Promise((resolve) => setTimeout(() => resolve(false), 1500))
        ]);
        assert.equal(sawApp, false, 'handlers survived destroy(), a reload would stack them');
    } finally {
        socket.close();
    }
});
