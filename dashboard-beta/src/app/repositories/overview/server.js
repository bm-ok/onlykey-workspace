//---------------------------------------------------------------------------
//EVERYTHING OPEN ACROSS THE WORKSPACE, AS ONE LIST.
//
//The per-repository panes answer "what is going on in this one". Nobody works
//that way: the question somebody actually has when they sit down is "what is
//open", across every repository at once, and answering it by reading four tabs
//and holding the result in your head is how things get missed.
//
//SO ONE ROW PER THING, whatever kind of thing it is — an issue, a pull request,
//or a PR cut. Three kinds in one list, sorted together, because they are three
//kinds of the same question.
//
//A CUT IS ONE ROW, NOT FOUR. A PR cut is this app's own idea: one change, one
//pull request per repository, tracked together. Listing its four pull requests
//loose would say there are four things open when there is one, and the number at
//the top of the pane is the number people scan. So a pull request that belongs
//to a cut is folded into the cut's row and never listed twice.
//
//---- it draws from the note, and asks nothing ------------------------------
//
//NOT LIVE, and that is not a shortcut. This list is redrawn every few seconds
//while somebody looks at it; a draw loop that reaches the network is a draw loop
//that rate-limits a token, and the pane would be waiting on GitHub to say what
//it already knows. What it shows is what the last "Ask GitHub" gathered, and it
//says WHEN, because a fact about a remote is only as true as the moment it was
//read.
//
//THE FIRST HUNDRED. The gathering is not paged, so a repository with five
//thousand open issues shows a hundred here. A hundred of five thousand is not a
//short list, it is a wrong one — `issues` and `pulls` are the paged actions and
//they exist for exactly that.
//---------------------------------------------------------------------------
plugin.consumes = ['app', 'prcuts'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var prcuts = imports.prcuts;

    async function relayed(name, args) {
        if (!actions) return null;
        try { return await actions.call(name, args || {}); }
        catch (e) { return null; }
    }

    var undo = [];
    if (actions) {
        undo.push(actions.define('repoOverview', {
            about: 'Everything open across the workspace — issues, pull requests, and PR cuts as one row each',
            run: async function () {
                var known = await relayed('repositories');
                var rows = (known && known.repos) || [];
                var cuts = prcuts.all() || {};

                //THE JUDGE HAS NOT MOVED HERE YET, so this asks by name and the
                //relay finds it in the app being ported from. Nothing on this
                //row depends on it: `judged` is null when it cannot be reached,
                //which is what a row with nothing read about it looks like
                //anyway.
                var said = await relayed('judging');
                var judgements = (said && (said.judging || said.judgements)) || [];

                //Which pull requests belong to a cut, so they are not also
                //listed loose.
                var partOf = {};
                Object.keys(cuts).forEach(function (k) {
                    ((cuts[k] || {}).pulls || []).forEach(function (p) {
                        if (p.number) partOf[p.repo + '#' + p.number] = k;
                    });
                });

                //WHICH REMOTES ARE OURS, worked out once. A pull request whose
                //head is in a repository this workspace holds is this host's own
                //work arriving back; anything else came from outside.
                var ours = {};
                rows.forEach(function (r) {
                    if (r.remote && r.remote.owner) ours[r.remote.owner + '/' + r.remote.repo] = true;
                });

                var items = [];
                var grouped = {};
                var order = [];

                rows.forEach(function (r) {
                    (r.pulls || []).forEach(function (p) {
                        var belongs = partOf[r.repo + '#' + p.number];
                        if (!belongs) {
                            items.push(loose(r, p));
                            return;
                        }
                        if (!grouped[belongs]) {
                            var cut = cuts[belongs] || {};
                            order.push(belongs);
                            grouped[belongs] = {
                                kind: 'cut', id: belongs, repo: null, repos: [],
                                title: (cut.said && cut.said.title) || cut.source,
                                source: cut.source || null, target: cut.target || null,
                                number: null, url: null, state: 'open',
                                at: cut.opened || null, on: null, parts: []
                            };
                        }
                        var g = grouped[belongs];
                        g.repos.push(r.repo);
                        g.parts.push({
                            repo: r.repo, number: p.number, url: p.url,
                            state: p.merged ? 'merged' : p.state, draft: !!p.draft
                        });
                    });

                    (r.issues || []).forEach(function (i) {
                        items.push({
                            kind: 'issue', id: r.repo + '!' + i.number, repo: r.repo, repos: [r.repo],
                            title: i.title, number: i.number, url: i.url, state: i.state, draft: false,
                            at: i.updated || i.at || null, on: i.on || r.repo, by: i.by,
                            labels: i.labels || [],
                            //Carried so a task can be written from this list
                            //without going back to the per-repository tab to find
                            //the words again.
                            body: i.body || null, parts: null
                        });
                    });
                });

                //---- one arrived pull request, and whether it may be read ----
                function loose(r, p) {
                    //WHOSE IT IS, AND WHETHER ANYBODY HAS SAID IT MAY BE READ.
                    //
                    //A pull request this host cut is its own work arriving back.
                    //One from anywhere else is a stranger's code, and judging it
                    //means fetching it onto a machine that holds a credential —
                    //so it waits on a person.
                    //
                    //ANSWERED FROM THE LAST GATHERING, because this list is drawn
                    //every few seconds and the draw loop must not reach the
                    //network. The consequence: an author who has pushed since
                    //shows as allowed here and is refused at the gate, which
                    //reads the live commit. That is the safe direction to be
                    //wrong in — a row that offers something the gate then
                    //refuses, rather than a gate that trusts this row.
                    var from = String(p.headRepo || '').trim();
                    var mine = from ? !!ours[from] : false;
                    var may = prcuts.allowed.check(r.parent || r.repo, p.number, p.headSha);

                    return {
                        kind: 'pull', id: r.repo + '#' + p.number, repo: r.repo, repos: [r.repo],
                        title: p.title, number: p.number, url: p.url,
                        state: p.merged ? 'merged' : p.state, draft: !!p.draft,
                        at: p.updated || p.at || null, on: r.parent || r.repo, parts: null,
                        by: p.by || null, association: p.association || null,
                        headRepo: from || null, headSha: p.headSha || null,
                        ours: mine,
                        mayBeJudged: mine ? true : may.allowed,
                        staleAllowance: mine ? false : may.stale,
                        whyNot: mine ? null : may.why,
                        allowedBy: may.said || null,

                        //AND WHAT HAS BEEN READ ABOUT IT, on the row where
                        //somebody allowed it in the first place. The judgement
                        //lives on another tab and so does everything a person can
                        //do with it — so allowing a pull request here would send
                        //them elsewhere to find out what came of it, and
                        //elsewhere again to answer the author. A loop that starts
                        //on one screen and finishes on another is a loop people
                        //lose track of.
                        judged: latestOn(r.parent || r.repo, p)
                    };
                }

                function latestOn(on, p) {
                    var name = on + '#' + p.number;
                    //THE LATEST ONE, because asking again is how a pull request
                    //is re-read after a push, and the answer that matters is the
                    //one about the commit it is on now.
                    var mine = judgements.filter(function (j) {
                        return j.subject && j.subject.kind === 'pull'
                            && (j.subject.on + '#' + j.subject.number) === name;
                    });
                    var last = mine[mine.length - 1];
                    if (!last) return null;
                    return {
                        ref: last.ref, id: last.id, state: last.state,
                        sha: (last.subject && last.subject.sha) || null,
                        //WHETHER IT IS ABOUT THIS COMMIT. A judgement of what was
                        //there yesterday is not a reading of what is there now,
                        //and the row must not present it as one.
                        current: !!(last.subject && p.headSha && last.subject.sha === p.headSha),
                        concluded: last.concluded || null,
                        verdict: last.verdict || null,
                        said: last.saidOn || null
                    };
                }

                //A CUT'S STATE IS THE WHOLE CUT'S: merged only when every one of
                //them is, which is the sentence this app exists to be able to
                //say.
                order.forEach(function (k) {
                    var g = grouped[k];
                    var merged = g.parts.filter(function (p) { return p.state === 'merged'; }).length;
                    g.state = merged === g.parts.length
                        ? 'merged'
                        : (g.parts.some(function (p) { return p.state === 'open'; }) ? 'open' : 'closed');
                    g.summary = merged + ' of ' + g.parts.length + ' merged';
                });

                var all = order.map(function (k) { return grouped[k]; }).concat(items);
                var gathered = rows.map(function (r) { return r.gathered; })
                    .filter(Boolean).sort();

                return {
                    items: all,
                    repos: rows.map(function (r) { return r.repo; }),
                    asked: gathered.length ? gathered[0] : null,
                    counts: {
                        all: all.length,
                        open: all.filter(function (x) { return x.state === 'open'; }).length,
                        issues: all.filter(function (x) { return x.kind === 'issue'; }).length,
                        pulls: all.filter(function (x) { return x.kind === 'pull'; }).length,
                        cuts: all.filter(function (x) { return x.kind === 'cut'; }).length,
                        //Arrived from outside, open, and nobody has said it may
                        //be read.
                        toAllow: all.filter(function (x) {
                            return x.kind === 'pull' && x.state === 'open' && !x.ours && !x.mayBeJudged;
                        }).length
                    },
                    note: gathered.length
                        ? 'As of the last time GitHub was asked. Ask again for anything newer.'
                        : 'Nothing has been read from GitHub yet.'
                };
            }
        }));
    }

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
