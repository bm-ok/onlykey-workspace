'use strict';

//WHAT IS STILL IN THE OTHER APP.
//
//`actions.call` tries this app's table first and the pipe to `dashboard/`
//second, so an action nobody has moved yet is not an error — it TRAVELS. That
//is the migration path working as designed, and it is also why "how far along is
//this" has never had an answer anybody could read: everything works while the
//old app is running, and the moment it is not, a third of the buttons fail.
//
//IT MATTERS FOR THE LOG TOO, which is what made it worth writing. A relayed
//action does its logging over there, so every line it would have written is
//missing from Live here — and Live is the log viewer both a person and a model
//watch a run through. A quiet Live is not a quiet app.
//
//    node tools/ported.js              the count, and what is missing by area
//    node tools/ported.js --list       every name
//    node tools/ported.js job          just the ones matching

const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const OLD = path.join(HERE, '..', 'dashboard', 'actions');

//THE OLD APP'S TABLE IS ITS FILES: each exports an object whose keys are action
//names, one per `  name: {` at the top level of the literal.
function theirs() {
    const out = new Set();
    if (!fs.existsSync(OLD)) return out;
    for (const f of fs.readdirSync(OLD)) {
        if (!f.endsWith('.js')) continue;
        const text = fs.readFileSync(path.join(OLD, f), 'utf8');
        for (const m of text.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*): \{/gm)) out.add(m[1]);
    }
    return out;
}

//AND THIS ONE'S IS WHAT THE RUNNING APP SAYS, not what a regex can find.
//
//READING THE SOURCE IS WRONG HERE AND WAS WRONG IN THE WORST DIRECTION. A
//`actions.define(what + 'Save')` inside a helper is invisible to any pattern,
//so this reported the ENTIRE approval library — fifteen actions — as still
//living in the other app. They are all here, registered by `doors()` in
//library/server.js, and have been. The command line was asked at the time, said
//`where: here` for every one of them, and was disbelieved because the regex
//disagreed with it.
//
//That nearly cost a second copy of all fifteen, registered under the same names.
//
//SO THE APP IS THE AUTHORITY WHEN IT IS UP, and its own answer carries `where`.
//The static scan stays as a fallback for when it is not, and says out loud that
//it undercounts — a number with a known bias is usable; one presented as a fact
//is not.
function fromTheApp() {
    var run = require('child_process').spawnSync(
        process.execPath, [path.join(__dirname, 'okc.js'), 'actions', '--json'],
        { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );
    if (run.status !== 0 || !run.stdout) return null;
    try {
        var said = JSON.parse(run.stdout);
        var list = said.actions || said;
        if (!Array.isArray(list)) return null;
        //THE NAME AND WHAT IT SAYS IT DOES, both from the app. `--near` needs the
        //second, and reading it out of source has the same hole as reading the
        //names did: an `about` built as `'Say this ' + what + ' has been read'`
        //is not in any file as a sentence.
        var here = new Map();
        list.forEach(function (a) { if (a && a.name && a.where === 'here') here.set(a.name, a.about || ''); });
        return here.size ? here : null;
    } catch (e) { return null; }
}

function ours(dir, into) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
            if (e.name === 'vendor') continue;
            ours(path.join(dir, e.name), into);
            continue;
        }
        if (!e.name.endsWith('.js')) continue;
        const text = fs.readFileSync(path.join(dir, e.name), 'utf8');
        for (const m of text.matchAll(/actions\.define\(\s*'([A-Za-z0-9_]+)'/g)) into.add(m[1]);
    }
    return into;
}

//WHICH PART OF THE APP A NAME BELONGS TO, from its own prefix. Rough on purpose
//— it is for reading a list of eighty, not for deciding anything.
function area(name) {
    const m = String(name).match(/^[a-z]+/);
    return m ? m[0] : 'other';
}

//---- AND WHAT IT MIGHT HAVE BECOME --------------------------------------
//
//NAMES CHANGED IN THE MOVE, so "not defined here" and "not here" are different
//claims and the first was reported as the second. `machines` became `vmList`,
//`branchArtifact` became `branchArtifacts`, `supervisorThinking` was folded into
//`supervisorState`. A count that treats those as missing is wrong in the
//direction that makes the work look bigger than it is.
//
//MATCHED ON WHAT EACH ONE SAYS IT DOES, not on its name, because a rename is
//exactly the case where the names do not help. `about:` is one sentence written
//for a person, and the same act described twice shares most of its words.
function abouts(text) {
    const out = new Map();
    //Both apps write the name and its `about` within a line or two of each other.
    const re = /(?:^ {2}([a-zA-Z][a-zA-Z0-9]*): \{|actions\.define\(\s*'([A-Za-z0-9_]+)')[\s\S]{0,400}?about:\s*'((?:[^'\\]|\\.)*)'/gm;
    let m;
    while ((m = re.exec(text))) out.set(m[1] || m[2], m[3].replace(/\\'/g, "'"));
    return out;
}

const STOP = new Set(['the', 'and', 'a', 'an', 'of', 'to', 'it', 'is', 'in', 'on', 'for',
    'that', 'this', 'what', 'with', 'one', 'its', 'has', 'was', 'are', 'be', 'by', 'or',
    'from', 'not', 'each', 'every', 'which', 'them', 'they', 'so', 'at', 'as', 'can']);

function words(s) {
    return new Set(String(s).toLowerCase().match(/[a-z]{3,}/g) || []);
}

function overlap(a, b) {
    if (!a || !b) return 0;
    const x = [...words(a)].filter((w) => !STOP.has(w));
    const y = new Set([...words(b)].filter((w) => !STOP.has(w)));
    if (!x.length || !y.size) return 0;
    const shared = x.filter((w) => y.has(w)).length;
    return shared / Math.max(x.length, y.size);
}

const old = theirs();
const live = fromTheApp();
const here = live || ours(path.join(HERE, 'src', 'app'), new Set());
const hereNames = live ? new Set(live.keys()) : here;
const missing = [...old].filter((n) => !hereNames.has(n)).sort();

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'))[0];
const list = only ? missing.filter((n) => n.toLowerCase().includes(only.toLowerCase())) : missing;

console.log(`${old.size} actions in the app being ported from`);
console.log(`${hereNames.size} defined here (${old.size - missing.length} of theirs, plus ${hereNames.size - (old.size - missing.length)} this app added)`);
if (!live) {
    console.log('THE APP IS NOT RUNNING, so this read the source instead — and a source read');
    console.log('UNDERCOUNTS: any action registered under a computed name is invisible to it.');
    console.log('Start the app and ask again before believing the number below.');
    console.log('');
}
console.log(`${missing.length} still relayed — they work only while the other app is running, and log only there\n`);

//---- WHAT EACH MISSING ONE MIGHT ALREADY BE, UNDER ANOTHER NAME ----------
if (args.includes('--near')) {
    const theirAbout = new Map();
    for (const f of fs.readdirSync(OLD)) {
        if (!f.endsWith('.js')) continue;
        for (const [k, v] of abouts(fs.readFileSync(path.join(OLD, f), 'utf8'))) theirAbout.set(k, v);
    }
    const ourAbout = live ? new Map(live) : new Map();
    if (!live) (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.isDirectory()) { if (e.name !== 'vendor') walk(path.join(dir, e.name)); continue; }
            if (!e.name.endsWith('.js')) continue;
            for (const [k, v] of abouts(fs.readFileSync(path.join(dir, e.name), 'utf8'))) ourAbout.set(k, v);
        }
    })(path.join(HERE, 'src', 'app'));

    let looksPorted = 0;
    for (const n of list) {
        const mine = theirAbout.get(n);
        const near = [...ourAbout.entries()]
            .map(([k, v]) => ({ k, score: overlap(mine, v) }))
            .filter((c) => c.score > 0.28)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
        if (near.length) looksPorted++;
        console.log(`\n  ${n}`);
        console.log(`    there: ${mine || '(no about)'}`);
        for (const c of near) console.log(`    ~ ${c.k} (${Math.round(c.score * 100)}%) — ${ourAbout.get(c.k)}`);
        if (!near.length) console.log('    ~ nothing here describes anything like it');
    }
    console.log(`\n${looksPorted} of ${list.length} have something here that sounds like them.`);
    console.log('A candidate is a thing to CHECK, not an answer — read both and decide.');
} else {
    const byArea = {};
    for (const n of list) (byArea[area(n)] = byArea[area(n)] || []).push(n);

    for (const a of Object.keys(byArea).sort((x, y) => byArea[y].length - byArea[x].length)) {
        console.log(`  ${a}  (${byArea[a].length})`);
        if (args.includes('--list') || only) console.log('    ' + byArea[a].join(' '));
    }
    if (!args.includes('--list') && !only) console.log('\n  --list for the names, --near for what each may have become');
}
