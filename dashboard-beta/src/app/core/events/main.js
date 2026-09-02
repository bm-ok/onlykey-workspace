var looksLike = require('../secret/looks-like');
var fs = require('fs');
var path = require('path');

//---------------------------------------------------------------------------
//what happened, kept across restarts.
//
//THE LIVE LOG DELIBERATELY DOES NOT DO THIS, and ../log/main.js says why at
//length: command output goes through it, command output carries sign-in URLs and
//tokens being placed, and a file of that is a credential store nothing treats as
//one. That decision stands. This is the other half it asks for — redaction at the
//boundary, and a decision about where it lives — and it arrives through the one
//`keeper` slot that file leaves open rather than through an append call added
//next to a logger.
//
//WHAT IT IS FOR. This app restarts every few minutes while it is being worked on,
//and everything that happened before the restart went with it. So "I restarted
//it, then wrote a task" left no trace of either, and anybody reading afterwards —
//a person coming back, or a model that was not watching — filled the gap with
//whatever they expected. That is how a restart from the keyboard gets reported as
//a process detaching.
//
//NO PANE, AND THEREFORE NO server.js. The rule this port runs on is that an
//action goes where its pane is; this one has no pane, over there or here, because
//it answers "what happened while nobody was looking" and the answer to that is
//read at the command line by whoever just arrived. So it sits with the service it
//reads, which is the same rule with the pane clause spent.
//---------------------------------------------------------------------------

//THE ACTS WORTH KEEPING, BY TAG. Anything not named here is not kept, so adding a
//logger somewhere new does not silently start writing to disk — somebody has to
//decide it belongs. The rule is: anything that makes, destroys, starts or stops
//something.
var KEEP = [
    'app',        //started, closing
    'task',       //written, queued, judged, thrown away — and prompts, jobs, contracts
    //`memory` IS AN ADDITION, and the only one. It is a tag the dashboard's own
    //KEEP list does not name — so over there, what a supervisor decided while
    //nobody was awake is not kept. That looks like an oversight rather than a
    //decision: the store exists exactly because a supervisor works things out
    //between wakings, which is the case that comment describes as the one thing
    //nobody typed.
    //
    //AND IT CARRIES MORE WEIGHT HERE THAN THE `todo` TAG IT REPLACES. The todo
    //list refused deletion down the pipe, so the list itself was the record: a
    //supervisor could not empty it, which is what made it usable for checking up
    //on one. A memory is the supervisor's own and it MAY empty it — so this tag
    //is what is left of that property. Every write and every forget is here, and
    //what it chose to stop believing stays answerable after the note is gone.
    'memory',
    'job',        //a job sent to a machine
    'queue',      //picked up, dispatched, adopted, put away
    'vm',         //made, installed, started, stopped, deleted, snapshotted, credentialed
    'machines',   //the registry behind those
    'git',        //branches cut, deleted, pushed to
    'workspace',  //opened, closed, added, forgotten
    'keys',       //this host's own identity changing
    'github',     //the token being set or thrown away
    'server',     //certificates, ports, startup
    //A MACHINE DECIDING SOMETHING, which is the one thing here nobody typed. A
    //supervisor writes tasks and queues them on its own initiative, so this is
    //what answers "why is there a task nobody wrote" six weeks later — and what a
    //refused call leaves behind when something tries a door it does not have.
    'supervisor'
];

//NOT KEPT, and each for a reason rather than by omission:
//
//  window     which tab somebody is looking at. Not an act.
//  capture    a screenshot was taken. Noise, and it is usually a machine taking it.
//  ipc        a client connected. Says nothing about what it then did.
//  okc        the relay to the dashboard coming and going. Weather.
//  channel    a machine's socket, and every command sent down it. The transcript
//             rather than the act.
//  provision  the long install, which is `out` from a guest anyway.
//  editor     opening VS Code, which changes nothing.
//
//THIS LIST WAS WRITTEN ONCE AND NEVER ENFORCED, which is worse than not writing
//it: it reads as a rule that is being applied. The check asked only whether any
//tag was in KEEP, and a channel entry is tagged ['vm', <name>, 'channel'] — so
//`vm` let every one of them through. The cost was the whole point of the record:
//89 of 400 entries were one poll saying "reading its runs", and the answer to
//"what happened to runner1 while I was away" had scrolled out of the file. A
//record that keeps a heartbeat and drops the acts is worse than none, because it
//is trusted. So NEVER is asked FIRST, below.
var NEVER = ['window', 'capture', 'ipc', 'okc', 'channel', 'provision', 'editor'];

//Enough to answer "what happened while I was away" without becoming an archive
//nobody reads. At roughly 150 bytes a line this is a few hundred kilobytes.
var MOST = 2000;

//REDACTION AT THE BOUNDARY, which is the condition ../log/main.js set on any
//durable record existing at all. The allowlist says which ACTS are kept; this
//says what may not survive inside one, whatever act it was.
//
//It is not decoration. Starting a sign-in writes
//
//    runner1 is waiting to be signed in — open https://claude.ai/oauth/...
//
//under the `vm` tag, which is kept — so without this, beginning a sign-in would
//put an authorize URL on disk. That is the exact thing the live log stays in
//memory to avoid, arriving through the door the allowlist opened.
//
//WHOLE URLS GO, not just their query. The secret in a sign-in link is in the path
//as often as the parameters, and a rule that keeps "the safe half" of a URL is a
//rule somebody has to be right about every time. The host survives, because "it
//is talking to claude.ai" is the useful part and is not the secret.
//
//AND THIS IS WIDER THAN THE LIVE LOG'S, deliberately, which is the opposite of
//the call made there. That one must not mangle a commit hash, because a stream of
//a machine's output is useless if it does. This keeps only sentences this app
//composed about its own acts, and none of those need a 24-character run of random
//to make sense — so anything token-shaped goes, wherever it appears.
//THE LIST LIVES IN ../secret/looks-like.js NOW, and this kept its own until
//20 August 2026 — four patterns here, two in ../log, nine in the app being
//ported from, no two agreeing. See that file's header.
//
//`durable` IS THE RIGHT POLICY FOR THIS ONE and the wrong one for ../log. What
//is written here is kept for ever, so the blunt rules earn their cost: any run
//of 24+ token-shaped characters, and the tail of every URL. A live log of a
//guest's output would become a column of <redacted> under the same rules, which
//is why they are asked for by name rather than applied everywhere.
//
//AND IT CLOSES SOMETHING THIS GOT RIGHT BY LUCK. A GitHub token was caught here
//only because it is long and random — not because anything knew what one looks
//like. It is now caught by a rule that names it, so narrowing the blunt one
//later cannot quietly stop catching it.
function scrub(text) { return looksLike.redact(text, 'durable'); }

//Whether a live-log entry is one of ours to keep. Kept as a plain function so the
//rule can be read and tested rather than inferred from behaviour.
function worthKeeping(entry) {
    if (!entry || entry.level === 'out') return false;
    var tags = entry.tags || [];
    //A MACHINE TALKING, which includes whatever a worker chose to print.
    if (tags.indexOf('guest') >= 0) return false;
    //REFUSED BEFORE THE ALLOWLIST IS ASKED. Every one of these also carries a tag
    //that IS kept, so checking KEEP first means the deny list can never fire.
    if (tags.some(function (t) { return NEVER.indexOf(t) >= 0; })) return false;
    return tags.some(function (t) { return KEEP.indexOf(t) >= 0; });
}

plugin.consumes = ['log', 'dataDir', 'actions'];
plugin.provides = ['events'];
async function plugin(imports, register) {
    var { log, dataDir, actions } = imports;

    var dir = dataDir.at('state');
    var FILE = path.join(dir, 'events.jsonl');
    var kept = null;

    //THE HIGHEST COUNT EVER WRITTEN, kept across restarts by being in the rows.
    //Derived on load rather than stored separately: two places holding the same
    //number is two places to disagree, and the rows are the record.
    var last = 0;

    function load() {
        if (kept) return kept;
        kept = [];
        try {
            fs.readFileSync(FILE, 'utf8').split('\n').forEach(function (line) {
                if (!line.trim()) return;
                try { kept.push(JSON.parse(line)); } catch (e) { /* a half-written last line */ }
            });
        } catch (e) { /* nothing kept yet */ }
        //ROWS WRITTEN BEFORE THE COUNT EXISTED GET ONE, in the order they are
        //already in. Without this a listing that ends on an old row hands back a
        //bookmark of `null`, and the next read starts from the beginning — not
        //wrong, but it reads as the record having forgotten where you were. They
        //keep the numbers on the next write, since the file is rewritten whole.
        kept.forEach(function (e) {
            if (!e.seq) e.seq = ++last;
            else last = Math.max(last, Number(e.seq) || 0);
        });
        return kept;
    }

    //Rewritten whole rather than appended to, because the cap has to hold and a
    //file that only grows is what makes somebody delete the lot. At two thousand
    //lines this is cheap, and it happens on an act rather than on a timer.
    function write() {
        try {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(FILE, kept.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n');
        } catch (e) { /* the act still happened; only the note is lost */ }
    }

    function keep(entry) {
        if (!worthKeeping(entry)) return null;
        load();
        //A COUNT AS WELL AS A TIME, AND THE COUNT IS WHAT A BOOKMARK IS MADE OF.
        //
        //`at` is milliseconds, and two acts in one millisecond is not a rare
        //case here — the queue puts a machine away and writes the next line
        //immediately. Bookmarking on a timestamp then loses the second of them
        //FOR EVER: it is not greater than the mark, so it never comes back, and
        //a watcher following along simply never learns it happened.
        //
        //Its own test caught this by being flaky, which is the only way a
        //same-millisecond bug ever shows up. ../log solved the same problem with
        //ids and could accept them resetting, because it is memory; this cannot,
        //so the count goes in the file and is read back with it.
        kept.push({ seq: ++last, at: entry.at, level: entry.level, tags: entry.tags, text: scrub(entry.text) });
        if (kept.length > MOST) kept.splice(0, kept.length - MOST);
        write();
        return entry;
    }

    //Newest last, like the live log reads. `since` is a timestamp rather than an
    //id, because ids restart with the process and a timestamp does not — which is
    //the whole point of this file.
    function all(opts) {
        var o = opts || {};
        //A NUMBER IS A COUNT, ANYTHING ELSE IS A TIME. A bookmark taken before
        //this existed is a timestamp, and answering it with everything would
        //flood whoever passed it; answering it the old way is right for the
        //rows it can still tell apart. New bookmarks are counts and have no
        //such trouble.
        var since = o.since;
        var byCount = since != null && since !== '' && !isNaN(Number(since));
        var rows = load().filter(function (e) {
            if (since == null || since === '') return true;
            return byCount ? (Number(e.seq) || 0) > Number(since) : e.at > since;
        });
        return rows.slice(-Math.max(1, Math.min(2000, o.limit || 200)));
    }

    //THE ONE SEAM, taken here rather than reached for from the log's side.
    var unkeep = log.keeper(keep);

    var undo = [actions.define('events', {
        about: 'What this app has done, kept across restarts — tasks, the queue, its own starts and stops',
        takes: ['since', 'limit'],
        run: function (args) {
            var a = args || {};
            var rows = all({ since: a.since || null, limit: Number(a.limit) || 200 });
            return {
                events: rows,
                //The newest timestamp, to pass back as `since` next time. A
                //bookmark: reading the whole record every time is how a watcher
                //spends its attention re-reading what it already knows.
                bookmark: rows.length ? (rows[rows.length - 1].seq || null) : (a.since || null),
                where: FILE,
                kept: KEEP.join(', '),
                note: rows.length
                    ? 'The app\'s own acts. Command output and anything a guest said are deliberately not here — see the live log for those, while it lasts.'
                    : 'Nothing kept yet.'
            };
        }
    })];

    await register(null, {
        events: {
            keep: keep,
            all: all,
            clear: function () { kept = []; write(); },
            worthKeeping: worthKeeping,
            scrub: scrub,
            FILE: FILE,
            KEEP: KEEP,
            MOST: MOST
        },
        onDestroy: function () {
            unkeep();
            while (undo.length) undo.pop()();
        }
    });
}
module.exports = plugin;
