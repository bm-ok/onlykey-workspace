//---------------------------------------------------------------------------
//A PR CUT: ONE ACT, ONE PULL REQUEST PER REPOSITORY, HELD TOGETHER.
//
//GitHub has no idea the three are one change. It knows about three pull
//requests in three repositories, each with its own number, its own reviewers and
//its own merge button — and holding them together is the part only this can do.
//
//A CUT IS KEYED ON THE PAIR OF LINES: what is being proposed, and what it would
//go into. Not on a branch name, because the same branch name in three
//repositories is three branches, and not on a date, because the same pair can be
//sent more than once.
//
//---- what is stored, and what is asked -------------------------------------
//
//STORED: which pull requests were opened, in which repository, with which
//number, and what was said when they were made. That is a record of an act.
//
//ASKED EVERY TIME: whether each is still open, merged, or closed. That is a fact
//about GitHub which changes without this app being told, and storing it would
//mean showing a merged pull request as open until somebody happened to press
//something. It is why this pane is the slowest in the app, and why nothing else
//reads it on a timer.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'git', 'github', 'keys', 'workspace', 'state'];
plugin.provides = ['prcuts'];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('git');
    var git = imports.git;
    var github = imports.github;
    var keys = imports.keys;
    var workspace = imports.workspace;
    var state = imports.state;

    //---- the three stores, all per workspace -------------------------------
    async function landings() { return state.here.doc('landings'); }
    async function drafts() { return state.here.doc('pr-drafts'); }
    async function template() { return state.here.doc('pr-template'); }

    function key(source, target) { return String(source) + ' -> ' + String(target); }

    async function read(doc) {
        try { return (await doc()).read({}) || {}; }
        catch (e) { return null; }
    }

    //=======================================================================
    //WHAT GOES IN THE BODY OF A PULL REQUEST, and it is composed rather than
    //typed twice.
    //
    //EVERY BLOCK IS OFF UNTIL SOMEBODY TURNS IT ON. What this app knows about a
    //change — why the branch was cut, what it was cut from, which commits — is
    //useful in a pull request and is nobody else's decision to make. A template
    //that arrives switched on writes somebody's internal notes into a public
    //repository the first time they press the button.
    //=======================================================================
    var BLOCKS = [
        {
            id: 'crosslinks',
            label: 'Links to the other pull requests in this change',
            about: 'Each pull request names the others by number and link. Written after all of them exist, because the numbers do not exist before that.',
            //ONLY WHEN THERE IS MORE THAN ONE. A pull request that says "this
            //change is also in:" and then lists nothing is worse than silence.
            manyOnly: true,
            write: function (c, me) {
                var others = (c.pulls || []).filter(function (p) { return p.number && p.repo !== me; });
                if (!others.length) return null;
                return ['**This change is also in:**'].concat(others.map(function (p) {
                    return '- ' + p.repo + ' — ' + p.url;
                })).join('\n');
            }
        },
        {
            id: 'reason',
            label: 'Why the branch was cut',
            about: 'The reason recorded when the branch was made, which this app refuses to create one without.',
            write: function (c) {
                return c.note && c.note.reason ? '**Why this branch exists:** ' + c.note.reason : null;
            }
        },
        {
            id: 'cutfrom',
            label: 'What it was cut from',
            about: 'The line or branch this work started from, recorded at the time — git stops being able to say once both have moved on.',
            write: function (c) {
                if (!c.note) return null;
                var from = c.note.group ? 'the "' + c.note.group + '" line' : c.note.cutFrom;
                return from ? '**Cut from:** ' + from : null;
            }
        },
        {
            id: 'commits',
            label: 'The commits it carries',
            about: 'What this branch adds to what it was cut from, by subject.',
            write: function (c, me) {
                var mine = (c.carries || []).filter(function (a) { return a.repo === me; })[0];
                if (!mine || !mine.commits || !mine.commits.length) return null;
                return ['**Commits:**'].concat(mine.commits.map(function (x) {
                    return '- `' + String(x.sha).slice(0, 7) + '` ' + x.subject;
                })).join('\n');
            }
        },
        {
            id: 'origin',
            label: 'That this app opened it',
            about: 'A line saying which tool made the pull request, so a reader knows what wrote the rest of the body.',
            write: function () { return '_Opened by the dashboard, as one act across every repository this change touches._'; }
        }
    ];

    async function blocksOn() {
        var chosen = (await read(template)) || {};
        return BLOCKS.map(function (b) {
            return { id: b.id, label: b.label, about: b.about, manyOnly: !!b.manyOnly, on: !!chosen[b.id] };
        });
    }

    //THE BODY SOMEBODY WROTE COMES FIRST, ALWAYS. Everything composed is
    //appended under it, so a person's own words are never rearranged or wrapped.
    async function compose(said, context) {
        if (!context) return String(said || '');
        var chosen = (await read(template)) || {};
        var parts = [String(said || '').trim()];

        for (var i = 0; i < BLOCKS.length; i++) {
            var b = BLOCKS[i];
            if (!chosen[b.id]) continue;
            if (b.manyOnly && (context.repos || []).length < 2) continue;
            var text = null;
            try { text = b.write(context, context.me); } catch (e) { text = null; }
            if (text) parts.push(String(text).trim());
        }

        return parts.filter(Boolean).join('\n\n');
    }

    //---- what a cut is, right now ------------------------------------------
    //
    //ASKED OF GITHUB PER PULL REQUEST, because whether one is merged is not
    //something this app is told about. `into` is where it actually lives — a
    //pull request from a fork is IN THE PARENT — so it is asked for there first
    //and only then looked for on the repository itself.
    async function stateOf(rec) {
        var now = [];
        for (var i = 0; i < (rec.pulls || []).length; i++) {
            var p = rec.pulls[i];
            if (!p.number) { now.push(Object.assign({}, p, { state: 'never opened' })); continue; }

            var where = p.into || null;
            var found = null;
            try {
                if (where) {
                    var bits = String(where).split('/');
                    var r = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + p.number);
                    if (r.status === 200 && r.body) found = shapePull(r.body);
                }
                if (!found) {
                    var remote = await git.origin(p.repo);
                    if (remote && remote.owner) {
                        var r2 = await github.call('GET', '/repos/' + remote.owner + '/' + remote.repo + '/pulls/' + p.number);
                        if (r2.status === 200 && r2.body) found = shapePull(r2.body);
                    }
                }
                now.push(found
                    ? Object.assign({}, p, found)
                    : Object.assign({}, p, { state: 'could not be found', why: (p.into || p.repo) + ' did not answer for #' + p.number }));
            } catch (e) {
                now.push(Object.assign({}, p, { state: 'could not be read', why: e.message }));
            }
        }

        var opened = now.filter(function (p) { return p.number; });
        var merged = now.filter(function (p) { return p.state === 'merged'; });
        var closed = now.filter(function (p) { return p.state === 'closed'; });

        return Object.assign({}, rec, {
            pulls: now,
            //WHERE THE CUT AS A WHOLE STANDS, and it is the WORST of its parts
            //for the same reason a line's is: the point of holding them together
            //is that they land together.
            landed: opened.length > 0 && merged.length === opened.length,
            partly: merged.length > 0 && merged.length < opened.length,
            merged: merged.length,
            closed: closed.length,
            open: opened.length - merged.length - closed.length,
            of: opened.length
        });
    }

    function shapePull(body) {
        return {
            number: body.number,
            title: body.title,
            url: body.html_url,
            draft: !!body.draft,
            by: body.user && body.user.login,
            at: body.created_at,
            base: body.base && body.base.ref,
            head: body.head && body.head.ref,
            //MERGED IS NOT CLOSED, and GitHub reports both as `state: closed`.
            //Reading the state alone turns every merged pull request into a
            //rejected one, which is the opposite news.
            state: body.merged_at ? 'merged' : body.state,
            mergedAt: body.merged_at || null,
            mergeable: body.mergeable == null ? null : !!body.mergeable
        };
    }

    var undo = [];
    if (actions) {
        undo.push(actions.define('prCuts', {
            about: 'Every PR cut: one act, one pull request per repository, and how far each has got',
            run: async function () {
                var all = await read(landings);
                if (all === null) return { cuts: [], drafts: [], note: 'No workspace is open, so there are no PR cuts.' };

                var rows = [];
                var names = Object.keys(all);
                for (var i = 0; i < names.length; i++) {
                    rows.push(await stateOf(all[names[i]]));
                }

                //A DRAFT IS A CUT THAT HAS NOT LEFT YET, and it belongs at the
                //top rather than sorted among the finished ones. Seventeen landed
                //cuts are history and want nothing; the one thing waiting for a
                //person is the reason somebody opened this pane.
                var written = (await read(drafts)) || {};
                var waiting = Object.keys(written).map(function (k) {
                    return Object.assign({ id: k, draft: true }, written[k]);
                });

                var live = rows.filter(function (r) { return !r.landed; });
                return {
                    cuts: rows.sort(function (a, b) { return String(b.touched || b.opened).localeCompare(String(a.touched || a.opened)); }),
                    drafts: waiting,
                    note: (waiting.length ? waiting.length + ' written and not sent. ' : '')
                        + (rows.length
                            ? rows.length + ' cut' + (rows.length === 1 ? '' : 's') + ', ' + live.length + ' not landed yet.'
                            : 'Nothing has been sent from here yet.')
                };
            }
        }));

        undo.push(actions.define('prDrafts', {
            about: 'What has been written for a pair of lines and not sent',
            run: async function () {
                var all = await read(drafts);
                if (all === null) return { drafts: [], note: 'No workspace is open.' };
                var rows = Object.keys(all).map(function (k) { return Object.assign({ id: k }, all[k]); });
                return {
                    drafts: rows,
                    note: rows.length ? rows.length + ' written and not sent.' : 'Nothing written and unsent.'
                };
            }
        }));

        undo.push(actions.define('prDraft', {
            about: 'What has been written for one pair of lines',
            takes: ['source', 'target'],
            run: async function (args) {
                var a = args || {};
                if (!a.source || !a.target) throw new Error('Say which two lines — what is being proposed, and what it would go into.');
                var all = (await read(drafts)) || {};
                var k = key(a.source, a.target);
                return { id: k, source: a.source, target: a.target, draft: all[k] || null, note: all[k] ? null : 'Nothing written for this pair yet.' };
            }
        }));

        undo.push(actions.define('prDraftSave', {
            about: 'Keep what has been written for a pair of lines, without cutting anything',
            takes: ['source', 'target', 'title', 'body'],
            run: async function (args) {
                var a = args || {};
                if (!a.source || !a.target) throw new Error('Say which two lines.');
                var doc = await drafts();
                var all = doc.read({}) || {};
                var k = key(a.source, a.target);
                all[k] = {
                    source: a.source, target: a.target,
                    title: a.title == null ? (all[k] || {}).title : String(a.title),
                    body: a.body == null ? (all[k] || {}).body : String(a.body),
                    by: actions.whoAsked(a),
                    at: new Date().toISOString()
                };
                doc.write(all);
                //NOTHING IS SENT, and the sentence says so — this button sits
                //beside one that does send, and the two must not read alike.
                return { id: k, draft: all[k], note: 'Kept. Nothing has been pushed and no pull request has been opened.' };
            }
        }));

        undo.push(actions.define('prTemplate', {
            about: 'Which blocks are added to the body of every pull request this app opens',
            run: async function () {
                var rows = await blocksOn();
                var count = rows.filter(function (b) { return b.on; }).length;
                return {
                    blocks: rows,
                    note: count
                        ? count + ' of ' + rows.length + ' blocks are added under whatever is written.'
                        : 'Nothing is added. What is typed is what is sent.'
                };
            }
        }));

        undo.push(actions.define('prTemplateSet', {
            about: 'Turn a template block on or off',
            takes: ['id', 'on'],
            run: async function (args) {
                var a = args || {};
                var id = String(a.id || '').trim();
                if (!BLOCKS.some(function (b) { return b.id === id; })) {
                    throw new Error('"' + id + '" is not a block. It is one of: '
                        + BLOCKS.map(function (b) { return b.id; }).join(', ') + '.');
                }
                var want = a.on === true || a.on === 'true' || a.on === 1 || a.on === '1';
                var doc = await template();
                var now = doc.read({}) || {};
                now[id] = want;
                doc.write(now);

                var row = (await blocksOn()).filter(function (b) { return b.id === id; })[0];
                return { blocks: await blocksOn(), note: '"' + row.label + '" is ' + (want ? 'added' : 'not added') + '.' };
            }
        }));

        undo.push(actions.define('prCutForget', {
            about: 'Stop tracking a PR cut here. The pull requests on GitHub are untouched',
            takes: ['source', 'target'],
            run: async function (args) {
                var a = args || {};
                if (!a.source || !a.target) throw new Error('Say which two lines.');
                var doc = await landings();
                var all = doc.read({}) || {};
                var k = key(a.source, a.target);
                if (!all[k]) throw new Error('There is no cut from "' + a.source + '" to "' + a.target + '" here.');

                var was = all[k];
                delete all[k];
                doc.write(all);

                log.warn('stopped tracking the cut ' + k);
                return {
                    forgotten: k, was: was,
                    //THE PULL REQUESTS ARE UNTOUCHED, and saying so is the point.
                    //"Forget" is a word somebody might read as "close them".
                    note: 'No longer tracked here. The ' + (was.pulls || []).length
                        + ' pull request(s) on GitHub are untouched — open, merged or closed exactly as they were.'
                };
            }
        }));
    }

    await register(null, {
        prcuts: {
            all: function () { return read(landings); },
            stateOf: stateOf,
            compose: compose,
            blocks: blocksOn,
            key: key
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
