//---------------------------------------------------------------------------
//THE STORY OF A CUT: everything that touched it, in time, newest first.
//
//WHAT A PERSON WANTS FROM A CUT IS THE REVIEW OF HOW IT GOT HERE: what came
//in from GitHub (an issue opened, a maintainer's tag, a comment under the
//pull request), what went out in the person's name (a reply, the pull
//request itself, a push onto it), what the supervisor decided at each
//waking, and the machine work between -- tasks landing, judges concluding.
//Read from the records that already exist and from the events log; nothing
//here is a fact of its own.
//
//Pure: hand it the pieces, get the entries. The action beside it gathers.
//
//An entry:  { at, kind, dir, who, text, ref, url }
//  kind  issue | github | supervisor | task | judgement | cut | pull
//  dir   'in' (arrived from outside) | 'out' (left this host) | null
//---------------------------------------------------------------------------

function short(s, n) {
    var t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function refsOf(tasks, judgements) {
    var out = [];
    (tasks || []).forEach(function (t) { if (t.number) out.push('#' + t.number); });
    (judgements || []).forEach(function (j) { if (j.ref) out.push(j.ref); });
    return out;
}

function compose(bits) {
    var b = bits || {};
    var rec = b.rec || {};
    //SEVERAL CUTS FOR ONE ISSUE: an issue's story takes `cuts: [rec…]` and
    //tells each cut's opening, refresh and standing in turn.
    var cuts = Array.isArray(b.cuts) ? b.cuts : (rec.source ? [rec] : []);
    var note = b.note || null;
    var issue = b.issue || null;
    var tasks = b.tasks || [];
    var judgements = b.judgements || [];
    var events = b.events || [];
    var hostLogin = b.hostLogin || null;
    var out = [];

    function add(e) { if (e && e.at) out.push(e); }

    //---- the issue: opened, then every turn --------------------------------
    if (issue) {
        var key = issue.on + '#' + issue.number;
        add({
            at: issue.at, kind: 'issue', dir: 'in', who: issue.by, ref: key, url: issue.url,
            text: 'opened ' + key + (issue.title ? ' — "' + short(issue.title, 80) + '"' : '')
                + (issue.reading && issue.reading.kind === 'request' ? ' (tagged in the issue)' : '')
        });
        (issue.said || []).forEach(function (c) {
            //A TAG IS ALWAYS SOMETHING COMING IN, whoever wrote it -- on a
            //sandbox the maintainer and this host's login are one person, and
            //a request read as "out" would be the story backwards.
            var asked = c.reading && c.reading.kind === 'request';
            var mine = !asked && hostLogin && c.by === hostLogin;
            add({
                at: c.at, kind: 'github', dir: mine ? 'out' : 'in', who: c.by, ref: key, url: c.url,
                text: (mine ? 'replied on ' : (asked ? 'tagged on ' : 'commented on ')) + key + ': "' + short(c.text != null ? c.text : c.body, 140) + '"'
            });
        });
    }

    //---- the branch, cut for it --------------------------------------------
    if (note && note.made) {
        add({
            at: note.made, kind: 'cut', dir: null, who: note.by, ref: rec.source || null,
            text: 'cut the branch' + (note.cutFrom ? ' from ' + note.cutFrom : '') + (note.reason ? ' — ' + short(note.reason, 160) : '')
        });
    }

    //---- tasks on it --------------------------------------------------------
    tasks.forEach(function (t) {
        var ref = '#' + t.number;
        add({
            at: t.created, kind: 'task', dir: null, who: t.by || null, ref: ref,
            text: 'task ' + ref + ' written' + (t.becauseOf ? ' because of ' + t.becauseOf : '') + (t.title ? ' — "' + short(t.title, 100) + '"' : '')
        });
        if (t.state === 'done' || t.state === 'failed' || t.delivered) {
            add({
                at: t.updated, kind: 'task', dir: null, who: t.machine || null, ref: ref,
                text: 'task ' + ref + ' ' + (t.state === 'failed' ? 'failed' : 'landed')
                    + (t.commits != null ? ' — ' + t.commits + ' commit(s)' : '')
            });
        }
    });

    //---- judgements of it --------------------------------------------------
    judgements.forEach(function (j) {
        add({
            at: j.written, kind: 'judgement', dir: null, who: j.by || null, ref: j.ref,
            text: j.ref + ' asked for' + (j.question ? ' — "' + short(j.question, 120) + '"' : '')
        });
        if (j.concluded || j.state === 'done' || j.state === 'failed') {
            add({
                at: j.read || j.touched, kind: 'judgement', dir: null, who: j.machine || null, ref: j.ref,
                text: j.ref + (j.concluded ? ' concluded: ' + j.concluded : (j.state === 'failed' ? ' failed' : ' finished without a conclusion'))
            });
        }
    });

    //---- the pull requests: opened, refreshed, where they stand -----------
    var pulls = [];
    cuts.forEach(function (c) {
        var mine = (c.pulls || []).filter(function (p) { return p.number; });
        mine.forEach(function (p) { pulls.push(Object.assign({}, p, { cutSource: c.source, cutTarget: c.target })); });
        if (c.opened) {
            add({
                at: c.opened, kind: 'pull', dir: 'out', who: c.by || null,
                ref: c.source + ' -> ' + c.target,
                text: 'opened ' + (mine.length ? mine.map(function (p) { return p.repo + ' #' + p.number; }).join(', ') : 'the pull request(s)')
                    + ' into ' + c.target
            });
        }
        if (c.refreshed) {
            add({
                at: c.refreshed, kind: 'pull', dir: 'out', who: null, ref: c.source + ' -> ' + c.target,
                text: 'pushed the branch onto the open pull request(s) as it now stands'
            });
        }
        mine.forEach(function (p) {
            var r = p.reviews || null;
            var standing = p.merged || p.state === 'merged' ? 'merged' : (p.state || 'open');
            add({
                at: c.touched || c.opened, kind: 'pull', dir: null, who: null, ref: p.repo + ' #' + p.number, url: p.url,
                text: p.repo + ' #' + p.number + ' is ' + standing
                    + (r ? ' — reviews: ' + (r.approved || 0) + ' approved, ' + (r.changesRequested || 0) + ' changes requested' : '')
                    + (p.head ? ' — head ' + String(p.head).replace(/^[^:]+:/, '') : '')
            });
        });
    });

    //---- the events log: what the supervisor and GitHub said ---------------
    var refs = refsOf(tasks, judgements);
    var issueKey = issue ? issue.on + '#' + issue.number : null;
    var pullKeys = pulls.map(function (p) { return '#' + p.number; });
    function about(text, tags) {
        var t = String(text || '');
        var tg = (tags || []).join(' ');
        if (cuts.some(function (c) { return c.source && t.indexOf(c.source) >= 0; })) return true;
        if (issueKey && t.indexOf(issueKey) >= 0) return true;
        if (refs.some(function (r) { return new RegExp('(^|[^A-Za-z0-9])' + r.replace('#', '#') + '(?![0-9])').test(t); })) return true;
        //A PULL REQUEST NUMBER ONLY WHERE THE TAG NAMES ITS PLACE, since #2 is
        //a different thing on every repository.
        return pulls.some(function (p) {
            return p.into && tg.indexOf(p.into) >= 0 && new RegExp('#' + p.number + '(?![0-9])').test(t);
        });
    }
    events.forEach(function (e) {
        var tags = e.tags || [];
        var t = String(e.text || '');
        if (!about(t, tags)) return;
        var isSup = tags.indexOf('supervisor') >= 0;
        var isGh = tags.indexOf('github') >= 0;
        if (isSup) {
            if (/^waking it/.test(t)) add({ at: e.at, kind: 'supervisor', dir: 'in', who: null, text: short(t, 200) });
            else if (/^it said:/.test(t)) add({ at: e.at, kind: 'supervisor', dir: 'out', who: tags[1] || null, text: short(t.replace(/^it said:\s*/, ''), 240) });
            return;
        }
        if (isGh) {
            if (/^replied on|^closed|^posted/.test(t)) add({ at: e.at, kind: 'github', dir: 'out', who: null, text: short(t, 160) });
            else if (/was tagged by/.test(t)) add({ at: e.at, kind: 'github', dir: 'in', who: null, text: short(t, 160) });
            else if (/refreshed the cut|^cut /.test(t)) add({ at: e.at, kind: 'pull', dir: 'out', who: null, text: short(t, 160) });
        }
    });

    //---- newest first, and one line per moment ------------------------------
    var seen = {};
    return out.filter(function (e) {
        var k = e.at + '|' + e.text;
        if (seen[k]) return false;
        seen[k] = true; return true;
    }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
}

module.exports = { compose: compose, short: short };
