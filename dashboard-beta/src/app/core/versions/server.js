//---------------------------------------------------------------------------
//WHAT WAS APPROVED, KEPT.
//
//THE HOLE THIS FILLS IS SHARPER THAN "HISTORY WOULD BE NICE". A library entry
//carries `lapsed` — "somebody approved this and it has been edited since" — and
//the text they approved was gone. The app could tell you your agreement was
//stale and not what you had agreed to.
//
//ON APPROVAL, NOT ON EVERY SAVE. Approval is the act with meaning and it is a
//person's: drafts churn, and versioning them would bury the handful that
//somebody actually stood behind. Nothing unapproved can run anyway.
//
//ITS OWN PLUGIN BECAUSE TWO ALREADY WANT IT — ../../library keeps jobs, prompts
//and contracts, ../../supervisor keeps the skill, and a copy of this inside
//either would be the other one reaching across.
//
//IN THE HOST'S DRAWER, NOT THE WORKSPACE'S. A prompt, a contract and a skill are
//the host's; only a job is per workspace, and a caller with a per-workspace
//thing qualifies its own id. This does not guess at that.
//---------------------------------------------------------------------------

var fs = require('node:fs');
var path = require('node:path');

var diff = require('./diff');

//A FOLDER NAME, and never a caller's string used raw. An id comes from a library
//entry and a kind from a call site, and neither is this file's to trust with a
//path separator.
function safe(s) {
    return String(s == null || s === '' ? 'unknown' : s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
}

function stamp(at) {
    return String(at || new Date().toISOString()).replace(/[:.]/g, '-');
}

plugin.consumes = ['app', 'log', 'state'];
plugin.provides = ['versions'];
async function plugin(imports, register) {
    var log = imports.log.on('versions');
    var host = imports.app.host;
    var actions = host && host.actions;

    function root() {
        var at = imports.state.app && imports.state.app.where;
        return at ? path.join(at, 'approved') : null;
    }

    function dirFor(kind, id) {
        var at = root();
        return at ? path.join(at, safe(kind), safe(id)) : null;
    }

    //---- everything kept for one thing, newest first -----------------------
    //
    //METADATA ONLY. A listing of twenty versions of a skill would be half a
    //megabyte of text nobody asked to read; the text comes from `read`.
    function list(kind, id) {
        var dir = dirFor(kind, id);
        if (!dir) return [];

        var names;
        try { names = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }); }
        catch (e) { return []; }

        return names.map(function (f) {
            try {
                var it = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                return {
                    at: it.at, by: it.by || null, why: it.why || null,
                    characters: (it.text || '').length,
                    added: it.added, gone: it.gone, note: it.note || null,
                    //THE FIRST ONE IS NOT A CHANGE TO ANYTHING, and saying so is
                    //better than showing it as an enormous addition.
                    first: !!it.first
                };
            } catch (e) { return null; }
        }).filter(Boolean).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    }

    function newest(kind, id) {
        var all = list(kind, id);
        return all.length ? read(kind, id, all[0].at) : null;
    }

    function read(kind, id, at) {
        var dir = dirFor(kind, id);
        if (!dir) return null;
        try { return JSON.parse(fs.readFileSync(path.join(dir, stamp(at) + '.json'), 'utf8')); }
        catch (e) { return null; }
    }

    //---- and keeping one ---------------------------------------------------
    //
    //THE DIFF IS WORKED OUT NOW, AGAINST WHAT WAS APPROVED BEFORE, and kept with
    //the version rather than computed when somebody looks. Two reasons and the
    //second is the one that matters: the answer must not change later. A diff
    //recomputed next month against whatever is newest then would silently
    //rewrite what this version was a change TO.
    function keep(kind, id, text, meta) {
        var m = meta || {};
        var body = String(text == null ? '' : text);
        var dir = dirFor(kind, id);

        if (!dir) {
            //NOT FATAL. Approving is the act; keeping a copy of it is a service
            //to whoever reads later, and losing that must not stop somebody
            //approving a contract.
            log.warn('nothing is open to keep a version in, so ' + kind + ' "' + id + '" was approved '
                + 'without one being kept');
            return null;
        }

        var before = newest(kind, id);
        var was = before ? String(before.text || '') : null;

        //ALREADY KEPT, WORD FOR WORD. Approving the same text twice is an
        //ordinary thing — a person re-reading and confirming — and a second
        //identical copy is noise in the one list that should be all signal.
        if (was !== null && was === body) {
            log.info(kind + ' "' + id + '" was approved again, unchanged — the version already kept still stands');
            return before;
        }

        var d = was === null ? null : diff.of(was, body, { around: 3 });
        var at = m.at || new Date().toISOString();

        var it = {
            kind: String(kind), id: String(id), at: at,
            by: m.by || null,
            //WHY IT WAS APPROVED, WHERE THERE IS A REASON. A skill carries the
            //argument the supervisor made for it; a contract somebody edited at
            //the window may carry nothing, and that is honest.
            why: m.why || null,
            text: body,
            characters: body.length,
            first: was === null,
            added: d ? d.added : null,
            gone: d ? d.gone : null,
            note: d ? d.note : 'The first version kept of this.',
            rows: d ? d.rows : null
        };

        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, stamp(at) + '.json'), JSON.stringify(it, null, 1));
        } catch (e) {
            log.warn('could not keep a version of ' + kind + ' "' + id + '": ' + e.message);
            return null;
        }

        log.good('kept ' + kind + ' "' + id + '" as approved at ' + at + ' — ' + it.note);
        return it;
    }

    var undo = [];
    if (actions) {
        undo.push(actions.define('approved', {
            about: 'Every version of a job, prompt, contract or skill that a person approved, newest first',
            takes: ['kind', 'id'],
            run: function (args) {
                var a = args || {};
                if (!a.kind || !a.id) {
                    throw new Error('Say which: a kind (job, prompt, contract, skill) and an id.');
                }
                var all = list(a.kind, a.id);
                return {
                    kind: a.kind, id: a.id, versions: all,
                    note: all.length
                        ? all.length + ' version(s) kept. The newest is what stands; ask for one by `at` to '
                            + 'read it, with what changed.'
                        : 'Nothing has been approved for that yet, so there is nothing kept. Versions start '
                            + 'at the first approval, not at the first save.'
                };
            }
        }));

        undo.push(actions.define('approvedVersion', {
            about: 'One approved version in full: the text as approved, and what changed to reach it',
            takes: ['kind', 'id', 'at'],
            run: function (args) {
                var a = args || {};
                if (!a.kind || !a.id) throw new Error('Say which: a kind and an id.');

                var it = a.at ? read(a.kind, a.id, a.at) : newest(a.kind, a.id);
                if (!it) {
                    throw new Error(a.at
                        ? 'Nothing was approved for that at "' + a.at + '".'
                        : 'Nothing has been approved for that yet.');
                }

                return Object.assign({}, it, {
                    //THE DIFF AS TEXT TOO, because this is read on a command line
                    //as often as in a window and a list of row objects is not
                    //something anybody reads there.
                    changed: it.rows ? diff.asText({ rows: it.rows }) : null
                });
            }
        }));
    }

    await register(null, {
        versions: {
            keep: keep, list: list, read: read, newest: newest,
            //HANDED OUT so a caller that wants to SHOW a difference without
            //keeping one — a proposal against what is live — uses the same
            //arithmetic as the record does.
            diff: diff.of,
            asText: diff.asText
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
