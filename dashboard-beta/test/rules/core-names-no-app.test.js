const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'src', 'app');

//---------------------------------------------------------------------------
//CORE MAY NOT NAME AN APP SERVICE.
//
//The plugin graph is a web that links only what each part needs, and that is
//what makes any single plugin liftable into another project. A strand from CORE
//to an app service is the one nothing needs: it means core knows that a thing
//called `busy` exists, and `vms/busy` can no longer be taken out without
//bringing core's opinion of it along.
//
//IT WAS REAL RATHER THAN THEORETICAL. `core/build` listed the app services whose
//main halves it was carrying over the reload — because carrying them is what it
//does, and naming them was the obvious way to receive them. `core/handover` is
//the container it carries instead: core moves it and never learns what is in it,
//exactly as it already did for the action table.
//
//---- what this checks -----------------------------------------------------
//
//Every name a plugin under core/ CONSUMES is either provided by another plugin
//under core/, in the same half, or is `app` — which nothing provides because
//rectify injects it.
//
//THE OTHER DIRECTION IS NOT CHECKED AND SHOULD NOT BE. An app plugin consuming a
//core service is the entire point of having core.
//---------------------------------------------------------------------------

const HALVES = ['main.js', 'server.js', 'window.js'];

//INJECTED BY THE FRAMEWORK rather than provided by a plugin, so no `provides`
//list anywhere will ever contain it.
const GIVEN = ['app'];

function plugins(root) {
    const out = [];
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return out; }

    for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.') || e.name === 'vendor') continue;
        const dir = path.join(root, e.name);
        for (const half of HALVES) {
            const file = path.join(dir, half);
            if (fs.existsSync(file)) out.push({ name: e.name, half, file });
        }
        //one level further down, which is where a group's plugins live
        out.push(...plugins(dir).map((p) => Object.assign({}, p, { name: e.name + '/' + p.name })));
    }
    return out;
}

function listed(src, which) {
    //THE LITERAL OUT OF THE SOURCE rather than by loading the plugin: a plugin
    //is a function with side effects at setup, and this needs to read all of
    //them without starting any.
    const m = new RegExp('plugin\\.' + which + '\\s*=\\s*\\[([^\\]]*)\\]').exec(src);
    if (!m) return [];
    return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

const ALL = plugins(APP).map((p) => {
    const src = fs.readFileSync(p.file, 'utf8');
    return Object.assign({}, p, { consumes: listed(src, 'consumes'), provides: listed(src, 'provides') });
});

const isCore = (p) => p.name === 'core' || p.name.indexOf('core/') === 0;

test('there are core plugins and app plugins to compare, so this proves something', () => {
    //A RULE THAT CHECKS AN EMPTY SET is the most dangerous file in test/.
    const core = ALL.filter(isCore);
    assert.ok(core.length > 10, 'only ' + core.length + ' core plugins were found');
    assert.ok(ALL.length - core.length > 20, 'barely any app plugins were found');
    assert.ok(core.some((p) => p.consumes.length), 'no core plugin consumes anything, so nothing is being checked');
});

test('no core plugin consumes a service that core does not provide', () => {
    for (const half of HALVES) {
        const here = ALL.filter((p) => p.half === half);
        const fromCore = new Set(GIVEN);
        here.filter(isCore).forEach((p) => p.provides.forEach((n) => fromCore.add(n)));

        //ALL OF THEM, NOT THE FIRST. A rule like this is usually broken in more
        //than one place at once, and stopping at the first turns one look into
        //as many runs as there are faults.
        const wrong = [];
        for (const p of here.filter(isCore)) {
            for (const name of p.consumes) {
                if (fromCore.has(name)) continue;
                const by = here.filter((x) => x.provides.includes(name)).map((x) => x.name);
                wrong.push(p.name + '/' + half + " consumes '" + name + "' (provided by "
                    + (by.join(', ') || 'nothing') + ')');
            }
        }

        assert.deepEqual(wrong, [],
            '\n  ' + wrong.join('\n  ')
            + '\n\n  A strand from core to an app service is the one nothing needs — it stops that'
            + '\n  plugin being liftable into another project. Either hand it over through'
            + '\n  core/handover (main.js puts it in, server.js asks host.of by name), or the'
            + '\n  plugin is app logic wearing a core folder and should move out of core/.\n');
    }
});

test('and the thing that carries the handover names nothing it carries', () => {
    const build = ALL.find((p) => p.name === 'core/build' && p.half === 'main.js');
    assert.ok(build, 'core/build/main.js is not there any more');

    //IT CARRIES THE HOST, so it is the one file most likely to be handed a name
    //that does not belong to it.
    assert.ok(build.consumes.includes('handover'), 'it no longer takes the container');

    const src = fs.readFileSync(build.file, 'utf8');
    assert.match(src, /of: handover\.get/, 'the registry is not on the host');
    assert.equal(src.includes('busy: busy'), false, 'an app service is named on the host again');
});
