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

//AND THIS ONE'S IS EVERY `actions.define`, wherever it lives.
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

const old = theirs();
const here = ours(path.join(HERE, 'src', 'app'), new Set());
const missing = [...old].filter((n) => !here.has(n)).sort();

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'))[0];
const list = only ? missing.filter((n) => n.toLowerCase().includes(only.toLowerCase())) : missing;

console.log(`${old.size} actions in the app being ported from`);
console.log(`${here.size} defined here (${old.size - missing.length} of theirs, plus ${here.size - (old.size - missing.length)} this app added)`);
console.log(`${missing.length} still relayed — they work only while the other app is running, and log only there\n`);

const byArea = {};
for (const n of list) (byArea[area(n)] = byArea[area(n)] || []).push(n);

for (const a of Object.keys(byArea).sort((x, y) => byArea[y].length - byArea[x].length)) {
    console.log(`  ${a}  (${byArea[a].length})`);
    if (args.includes('--list') || only) console.log('    ' + byArea[a].join(' '));
}

if (!args.includes('--list') && !only) console.log('\n  --list for the names, or a word to filter by');
