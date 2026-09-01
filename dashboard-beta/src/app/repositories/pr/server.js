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

//A MODULE, NOT A SERVICE. What an allowance MEANS is a rule about two values and
//belongs beside the pane that uses it — the same arrangement ./revising.js has.
var allowing = require('./allowing');
var reviewsIn = require('./reviews');
var storyOf = require('./story');

plugin.consumes = ['app', 'log', 'git', 'github', 'keys', 'workspace', 'state', 'settings', 'refs',
    //`inbox` FOR ONE ERRAND: a change that is out and has not been merged. See
    //the source at the foot of this file.
    'inbox'];
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
    //---- REFS FOR READING ---------------------------------------------------
    //
    //../refs reads each repository once for the whole group and knows when to
    //stop believing it -- through ../../git's own announcement of a write, and
    //through a watch on .git for the branch somebody cut in a terminal.
    //
    //ASKING git DIRECTLY FOR THESE WAS A SECOND READ of what a sibling pane had
    //already just done, on this pane's own timer. `origin` is the one worth
    //naming: it cannot change through this app at all -- ../../git's url read is
    //fixed argv with no set-url door -- so it is the cheapest thing here to stop
    //re-reading, and it was being asked four times a draw.
    //
    //EVERYTHING THAT IS NOT A REF READ STAYS ON git: the diffs, the commit
    //counts, and every write.
    var refs = imports.refs;

    var settings = imports.settings;

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
        },
        //---- THE ONE BLOCK THAT IS ON UNLESS SOMEBODY TURNS IT OFF ----------
        //
        //THE OTHERS PUBLISH THIS APP'S INTERNAL NOTES and are rightly off. This
        //publishes GITHUB'S OWN FACT ABOUT GITHUB'S OWN OBJECT -- which issue the
        //change is for -- and the person who tagged that issue asked for exactly
        //this link. Off, the failure is the one the drills already record: the
        //issue stays open through the merge and is closed by hand. On, the cost
        //is one line a reader expects to find. It writes nothing at all when the
        //cut has no issue, so a branch cut by hand is untouched.
        //
        //"Closes" IS GITHUB'S KEYWORD, and what it does is theirs: the issue
        //closes when the pull request merges into the DEFAULT branch of the
        //repository the issue lives on -- or, across repositories, when the
        //person merging has write access there. Into a fork, or into a branch
        //that is not the default, it links the two and closes nothing. That is
        //the case `issueClose` still exists for.
        {
            id: 'closes',
            label: 'The issue it closes',
            about: 'Closes owner/repo#N, from the issue the branch was cut for. GitHub then closes that issue when this merges into the default branch of the repository it lives on (or when the person merging has write access there); into a fork or a non-default branch it links but does not close.',
            defaultOn: true,
            write: function (c) {
                var it = c && c.note && c.note.issue;
                if (!it || !it.on || !(it.number > 0)) return null;
                return 'Closes ' + it.on + '#' + it.number;
            }
        }
    ];

    //ON OR OFF, WITH THE DEFAULT BELONGING TO THE BLOCK. A block nobody has
    //decided about is what its author said it is; a block somebody switched
    //is what they switched it to, including an explicit false written over a
    //default of true.
    function isOn(chosen, b) {
        return chosen[b.id] === undefined ? !!b.defaultOn : !!chosen[b.id];
    }

    async function blocksOn() {
        var chosen = (await read(template)) || {};
        return BLOCKS.map(function (b) {
            return { id: b.id, label: b.label, about: b.about, manyOnly: !!b.manyOnly, on: isOn(chosen, b) };
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
            if (!isOn(chosen, b)) continue;
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
    //---- AND MERGED IS THE ONE ANSWER THAT CANNOT CHANGE BACK ---------------
    //
    //GITHUB WILL NOT REOPEN A MERGED PULL REQUEST. Closed can be reopened and
    //open can become either, so both have to be asked about every time; merged
    //is the end of the road, and asking again can only ever be told the same
    //thing. Twenty-six of the twenty-six cuts on this host are merged.
    //
    //THIS IS NOT THE CACHE ABOVE AND IT IS NOT KEPT WITH IT. ../../core/cached
    //holds answers that may be evicted, and its own header says what may never
    //be put there: a thing somebody DECIDED. That a pull request was merged is a
    //fact about what happened, so it is written into the cut's record beside the
    //number and the url, and it survives whatever the caches do.
    //
    //WHICH DIRECTION THIS CAN BE WRONG IN MATTERS, and it is the safe one. The
    //app being ported from was burned by trusting a stale OPEN: the record was
    //written when a pull request was cut and never refreshed, so every cut this
    //host ever made read "open" for ever, and a sweep once reported fifteen
    //outstanding pull requests that had all been merged days earlier. That is
    //the opposite of this. A stale "merged" cannot invent work that is not
    //there; it can only fail to notice a repository being deleted out from under
    //a pull request that had already landed, which changes nothing anybody is
    //waiting on.
    //
    //IT IS STILL ASKED ONCE. Nothing is believed merged until GitHub said so —
    //this only stops it being asked a second time.
    function isFinal(p) { return !!p.mergedAt; }

    async function stateOf(rec) {
        var now = [];
        for (var i = 0; i < (rec.pulls || []).length; i++) {
            var p = rec.pulls[i];
            if (!p.number) { now.push(Object.assign({}, p, { state: 'never opened' })); continue; }

            if (isFinal(p)) {
                now.push(Object.assign({}, p, { state: 'merged', settled: true }));
                continue;
            }

            var where = p.into || null;
            var found = null;
            try {
                if (where) {
                    var bits = String(where).split('/');
                    var r = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + p.number);
                    if (r.status === 200 && r.body) found = shapePull(r.body);
                }
                if (!found) {
                    var remote = await refs.origin(p.repo);
                    if (remote && remote.owner) {
                        var r2 = await github.call('GET', '/repos/' + remote.owner + '/' + remote.repo + '/pulls/' + p.number);
                        if (r2.status === 200 && r2.body) found = shapePull(r2.body);
                    }
                }
                //REVIEWS, FOR THE ONES STILL OPEN. This is GitHub's answer to
                //"is it reviewed", read rather than remembered.
                if (found && found.state === 'open') {
                    found.reviews = await reviewsOf(found.into || where, p.number);
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
        //`into` ONLY WHEN GITHUB SAID. The landing record already carries the
        //address this host opened it at, and `stateOf` lays this answer over
        //that record -- a null here would erase a name that was right.
        var onRepo = (body.base && body.base.repo && body.base.repo.full_name) || null;
        var out = {
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
            //WHEN IT LAST MOVED, which the detail panel has always tried to
            //draw and never could — `p.updated` was read off a shape that did
            //not carry it, so the row simply never appeared. For a cut that is
            //still out this is the only thing on the row that says whether
            //anybody has touched it since it was opened.
            updated: body.updated_at || null,
            //---- WHETHER IT WOULD GO IN, AND WHY NOT --------------------
            //
            //`mergeable` IS THREE-VALUED AND THE THIRD ONE MATTERS. GitHub
            //computes it in the background: a pull request read moments after
            //it was opened answers `null`, meaning "not worked out yet", which
            //is NOT "it is fine". Anything that treats null as clean says a
            //conflicted cut is ready, once, at the moment somebody is most
            //likely to press Merge.
            //
            //`mergeable_state` IS THE REASON. `dirty` is a real conflict,
            //`behind` is a base that moved under it, `blocked` is a check or a
            //review it is waiting on, `unstable` is a check that failed and
            //does not block. "It will not merge" is one word for four
            //different afternoons.
            mergeable: body.mergeable == null ? null : !!body.mergeable,
            mergeableState: body.mergeable_state || null,
            //THE COMMIT, THE AUTHOR'S NUMBER, AND THE REPOSITORY IT IS ON.
            //Dropped until now, and a review needs all three: it is pinned to a
            //commit, GitHub refuses one from the pull request's own author, and
            //the reviews live on the repository the pull request is open on --
            //which for a fork is the parent, not where the branch was pushed.
            headSha: (body.head && body.head.sha) || null,
            byId: (body.user && body.user.id) || null
        };
        if (onRepo) out.into = onRepo;
        return out;
    }

    //---- WHAT GITHUB SAYS ABOUT WHETHER IT IS REVIEWED ----------------------
    //
    //ONE MORE REQUEST PER OPEN PULL REQUEST, and only open ones: a merged or
    //closed pull request's reviews are history. Fingerprinted like every read,
    //so an unchanged list is a 304 and costs nothing against the hour. Null
    //when GitHub would not say -- a read that failed is not "nobody reviewed
    //it", and the two must not look alike on a pane.
    //
    //`latestByThisHost` IS THE ONE FACT ONLY THIS HOST CAN ADD: which review
    //was its own, by the login the token signs in as. The judge must not review
    //the same commit twice, and a person releasing a review draft should see
    //one is already there. See ./reviews.js for GitHub's own counting rule.
    async function reviewsOf(on, number) {
        var bits = String(on || '').split('/');
        if (bits.length !== 2 || !bits[0] || !bits[1] || !(number > 0)) return null;
        var me = null;
        try {
            var held = imports.keys && imports.keys.github && typeof imports.keys.github.held === 'function'
                ? imports.keys.github.held() : null;
            me = held && held.login ? held.login : null;
        } catch (e) { me = null; }
        try {
            var got = await github.all('/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + number + '/reviews');
            if (!got || !got.ok || !Array.isArray(got.items)) return null;
            return reviewsIn.summariseReviews(got.items, me);
        } catch (e) { return null; }
    }

    //=======================================================================
    //SENDING A CHANGE OUT, WHICH IS THE ONE ACT WITH CONSEQUENCES OUTSIDE THIS
    //HOST.
    //
    //THE GATE IN THE APP BEING PORTED FROM IS A JUDGEMENT. Over the pipe,
    //`prCutMake` requires that something has read the code — a judgement of the
    //line or of any branch it is made of, done, not stale against what it read,
    //and not rejected. Without it, the one step where a change leaves this host
    //and reaches somebody else's repository would be the only step taken on
    //nothing but a model's own confidence.
    //
    //IT IS PORTED NOW, AND `notFromThePipe` IS NO LONGER WHAT GUARDS THE
    //SENDING. `judgementsFor` in ../../judge answers the two facts this could
    //not work out on its own — what has been read about these branches, and
    //which of those readings still describes what is there — and `mustBeJudged`
    //below decides what that means for sending a change out. The staleness rule
    //stays in the judge, where its `tips` are.
    //
    //`notFromThePipe` STAYS ON `prCutUpdate`, which is stricter than the app
    //being ported from — that one has no wire refusal on it at all — and is
    //left exactly as it was. Building this gate is not a reason to loosen a
    //different one.
    //
    //The paragraph below is what was true until then, kept because it is the
    //argument for why a two-thirds gate was refused rather than shipped:
    //
    //STALENESS IS MEASURED BY `staleAgainst` AND `tipsFor`, which were internals
    //of the judging half rather than actions anything could ask for — so a port
    //then could check that a judgement EXISTS and could not check that it describes
    //what is there NOW.
    //
    //SO THE PIPE IS REFUSED OUTRIGHT INSTEAD. That is stricter than the original,
    //deliberately: a gate ported at two thirds is worse than no gate, because it
    //reads as the whole one. A person at the window may still send — they have
    //read the change, or decided they need not, which is the same boundary as
    //approving a job.
    //
    //WHEN THE JUDGE PORTS, this becomes the three-part check and not before —
    //which is `mustBeJudged` below. This is what still guards `prCutUpdate`.
    function notFromThePipe(a) {
        if (!a || !a._overTheWire) return;
        throw new Error(
            'Changing what a cut says is done in the window, by a person. Over the pipe it is refused: '
            + 'the words on a pull request are what somebody else reads to decide, and rewriting them '
            + 'from here would be this app editing its own case after it was made.');
    }

    //---- AND THE THREE-PART CHECK, WHICH IS THE ONE ON SENDING -------------
    //
    //A CHANGE GOES OUT WHEN SOMETHING HAS READ IT. Over the pipe there is no
    //person looking, so the reading has to exist and has to be worth something:
    //
    //    has read it     a judgement, done, of this line or any branch it is
    //                    made of
    //    still true      not stale against the tips it was made on
    //    did not reject  the last current one is not "rejected"
    //
    //BY THE NAMES A JUDGE COULD ACTUALLY HAVE READ, which is not only the
    //line's own. A judgement is made against a BRANCH — `fix/csvstat-lockfile-
    //ignore` — and `branchAsLine` then gives that branch a line name, `csvstat
    //lockfile ignore`. Searching only for the LINE name means the flow the
    //supervisor is told to follow — judge it, make it a line, cut it — cannot
    //pass its own gate, because the name searched for is one nothing has ever
    //judged, by construction. Over there it refused with "Nothing has judged
    //it" about a change that had just been accepted: correct machinery,
    //true-sounding sentence, wrong fact.
    //
    //THE FACTS COME FROM ../../judge AND THE DECISION IS MADE HERE. Staleness
    //is its rule and its `tips`; what a reading means for SENDING is this
    //plugin's. Asked through the action table because that plugin consumes
    //`prcuts`, so consuming it back would be a cycle.
    //
    //AND A REFUSAL WHEN IT CANNOT BE ASKED. `relayed` answers null on failure —
    //if the judge cannot be reached, this does not know whether anything read
    //the change, and "I could not find out" is not permission.
    async function mustBeJudged(a, names) {
        if (!a || !a._overTheWire) return;

        var said = await relayed('judgementsFor', { branches: names });
        if (!said) {
            throw new Error('Nothing here could say whether this change has been judged, so it is not being '
                + 'sent out. A change goes out over the pipe when a judge has read it; not knowing is not '
                + 'the same as yes.');
        }

        if (!(said.judgements || []).length) {
            throw new Error('Nothing has judged "' + names[0] + '" or the branch it is made of, so there is '
                + 'no reading of this change but your own — and you cannot see the code. Ask for a judgement '
                + 'of it, read what it handed back, and send it out when a judge has looked.');
        }

        if (!(said.current || []).length) {
            throw new Error('Every judgement of "' + names[0] + '" was made before the last push, so none of '
                + 'them describes what is there now. Judge it again — a judgement of an earlier state is '
                + 'exactly as useful as none.');
        }

        var latest = said.latest;
        if (latest && latest.verdict === 'rejected') {
            throw new Error(latest.ref + ' read "' + latest.reads + '" and came back "' + latest.verdict
                + '". Fix what it found and have it judged again — a change goes out when the judge is '
                + 'satisfied, not when it has been asked twice.');
        }
    }

    //WHICH REPOSITORIES ACTUALLY CARRY SOMETHING. A cut that opens a pull request
    //in a repository with nothing in it is noise in three places at once — a
    //reviewer's list, the cut's own state, and the branch board.
    async function carrying(source, target) {
        var lines = await relayed('lines');
        var all = (lines && (lines.lines || lines.groups)) || [];
        var from = all.filter(function (g) { return g.name === source; })[0];
        var into = all.filter(function (g) { return g.name === target; })[0];
        if (!from) throw new Error('There is no line called "' + source + '".');
        if (!into) throw new Error('There is no line called "' + target + '".');

        var out = [];
        for (var i = 0; i < from.on.length; i++) {
            var p = from.on[i];
            if (!p.stillHere || !p.there) continue;
            var base = (into.on.filter(function (x) { return x.repo === p.repo; })[0] || {}).branch;
            if (!base) continue;

            var ahead = 0;
            try { ahead = (await git.commits(p.repo, base, p.branch)).length; } catch (e) { ahead = 0; }
            if (ahead > 0) out.push({ repo: p.repo, head: p.branch, base: base, ahead: ahead });
        }
        return { from: from, into: into, on: out };
    }

    async function relayed(name, args) {
        if (!actions) return null;
        try { return await actions.call(name, args || {}); }
        catch (e) { return null; }
    }

    //---- opening one, in the right place ------------------------------------
    //
    //IN THE PARENT, WHEN THERE IS ONE. A pull request from a fork is created in
    //the repository being merged INTO, with the head written `owner:branch`.
    //
    //GETTING THIS WRONG DOES NOT FAIL LOUDLY. It opens a pull request inside the
    //fork, from the fork's branch into the fork's own default — which looks
    //perfectly normal, reports success, and lands the work nowhere anybody is
    //watching. That is the worst shape a bug can have here, and it is why the
    //target is asked for rather than assumed.
    async function openOne(repo, want) {
        var remote = await refs.origin(repo);
        if (!remote || remote.kind !== 'github') {
            return { repo: repo, opened: false, why: '"' + repo + '" has no GitHub remote to open a pull request on.' };
        }

        var known = await relayed('repositories');
        var row = ((known && known.repos) || []).filter(function (r) { return r.repo === repo; })[0];

        //---- WHERE IT GOES IS ASKED, NOT ASSUMED -----------------------------
        //
        //THIS FELL BACK TO YOUR OWN REMOTE, so a repository nobody had chosen a
        //destination for opened a pull request FROM your fork INTO your fork —
        //quietly, and looking exactly like a cut that had gone somewhere. On a
        //workspace of somebody else's forks that was every repository at once.
        //
        //`want.into` STILL WINS, because a cut may name its own destination and
        //the New PR Cut pane does. What is gone is guessing when nobody said.
        var chose = row && row.target ? row.target : null;
        var target = want.into || (chose && chose.on) || null;
        if (!target) {
            return {
                repo: repo, opened: false,
                why: chose && chose.off
                    ? '"' + repo + '" is set to send work nowhere, so no pull request is opened from it. '
                        + 'Repositories → Repos → Where work goes, if that should change.'
                    : 'Nothing is picked for "' + repo + '", so there is nowhere to open a pull request. '
                        + 'Repositories → Repos → Where work goes — pick the fork or the project it should go '
                        + 'to, or pick "nowhere" if this repository should not send work at all.'
            };
        }
        var bits = String(target).split('/');
        var crossing = target !== (remote.owner + '/' + remote.repo);
        var head = crossing ? remote.owner + ':' + want.head : want.head;

        //DOES THE BASE EVEN EXIST THERE, asked before anything is sent. GitHub
        //answers this with `PullRequest base invalid` in a 422, which is accurate
        //and says nothing a person can act on — it does not name the base and it
        //does not say where it was looked for.
        var there = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/branches/' + encodeURIComponent(want.base));
        if (there.status === 404) {
            return {
                repo: repo, opened: false,
                why: target + ' has no branch called "' + want.base + '", so a pull request cannot be opened against it.'
                    + (row && row.target && row.target.chosen
                        ? ' That is where "' + repo + '" sends work.'
                        : ' Nothing has been picked for "' + repo + '", so work stays on your own remote — walk the fork chain and say where work goes.')
            };
        }

        var body = { title: want.title, body: want.body, head: head, base: want.base };
        if (want.draft) body.draft = true;
        if (crossing) body.head_repo = remote.owner + '/' + remote.repo;

        var r = await github.call('POST', '/repos/' + bits[0] + '/' + bits[1] + '/pulls', body);
        if (r.status === 201) {
            return {
                repo: repo, opened: true, number: r.body.number, url: r.body.html_url,
                state: r.body.state, into: target, head: head, base: want.base
            };
        }
        return {
            repo: repo, opened: false,
            why: (r.body && r.body.message) || ('GitHub answered ' + r.status)
                + (r.body && r.body.errors ? ' — ' + JSON.stringify(r.body.errors) : '')
        };
    }

    //=======================================================================
    //WHICH INCOMING PULL REQUESTS A JUDGE MAY READ, AND AT WHICH COMMIT.
    //
    //Everything else this app judges is its own: a branch cut here, or a cut this
    //host made. A pull request that ARRIVES is different in kind — it is somebody
    //else's code, and judging it means fetching that code onto a machine holding
    //a Claude credential, a token that can push, and this app's own ssh key.
    //Rolling the machine back afterwards does not help: anything sent out during
    //the run has already gone.
    //
    //SO A PERSON SAYS WHICH ONES, ONE AT A TIME, AND NOTHING ELSE CAN.
    //
    //KEYED TO THE COMMIT, NOT TO THE PULL REQUEST, and that is the whole reason
    //this is a record rather than a flag on a row. A pull request is a moving
    //target: its author can push again a second after it is allowed, and an
    //approval naming only the number would carry silently onto code nobody read.
    //The head sha is recorded and an allowance stops applying the moment the head
    //moves.
    //
    //WHAT IT DOES NOT SAY. That a judge may READ this commit. It is not a
    //statement that the code is safe to RUN, and nothing should ever read it as
    //one.
    //
    //IN THE HOST'S DRAWER, NOT THE WORKSPACE'S. It names `owner/name#number`,
    //which is true wherever the folder is, and a person's decision about
    //somebody else's code should not quietly stop applying because a different
    //workspace was opened.
    //
    //`prFetch` HAS NOT MOVED, and it reads the app being ported from — so an
    //allowance given here does not reach it and it refuses. That is the safe
    //direction and it is temporary: bringing an arrived pull request into the
    //workspace is a git FETCH of `pull/<n>/head`, which is a door the write half
    //of `git` does not have yet, and there is nothing to bring one here FOR
    //until a judge can read it.
    //=======================================================================
    function allowKey(on, number) { return allowing.keyFor(on, number); }

    function allowances() { return state.app.doc('pr-allowed'); }

    //WHAT IS KEPT IS THIS FILE'S BUSINESS; WHAT AN ALLOWANCE MEANS IS ./allowing.
    //
    //The deciding used to be written out here, reading the record and judging it
    //in one function — which meant the rule protecting this host from somebody
    //else's code could only be exercised by a real pull request on GitHub with a
    //real person allowing it. It never was. The same separation ./revising.js
    //has, for the same reason.
    function allowCheck(on, number, sha) {
        var said = (allowances().read({}) || {})[allowKey(on, number)] || null;
        return allowing.check(said, sha);
    }

    var undo = [];
    if (actions) {
        //ASKS GITHUB, unlike the same question on the Overview row, which is
        //answered from the last gathering because it is redrawn every few
        //seconds. This one is pressed on purpose and the answer that matters is
        //about the commit the pull request is on NOW.
        undo.push(actions.define('prJudging', {
            about: 'Pull requests that have arrived, who wrote them, and whether a judge may read them',
            run: async function () {
                var known = await relayed('repositories');
                var mine = (known && known.repos) || [];
                var rows = [];

                //WHOSE REMOTES ARE OURS, worked out once, and the test is where
                //the branch LIVES rather than who typed it. A cut this host made
                //pushes to a fork this host owns, so its head repository is one
                //of ours; anything else came from somewhere this app does not
                //control.
                var ours = {};
                mine.forEach(function (r) {
                    if (r.remote && r.remote.owner) ours[r.remote.owner + '/' + r.remote.repo] = true;
                });

                //FROM EVERY PLACE EACH REPOSITORY READS PULL REQUESTS FROM.
                //
                //THIS READ ONE PLACE — wherever work was SENT — and arriving
                //pull requests do not turn up there. They turn up where the
                //person who wrote them opened one, which for a fork of a fork
                //is as likely to be the project above as the fork in between.
                //So a pull request waiting to be allowed could sit unseen on a
                //repository this workspace watches, and nothing anywhere said
                //it existed.
                //
                //`reads.pulls` IS THE SET, and it defaults to where work goes,
                //so nothing changes for a workspace that has never said
                //otherwise. See `readsOf` in ../repos/server.js.
                //ONE PLACE ASKED ONCE, however many repositories name it. Two
                //forks of the same project both reading from that project is
                //the ordinary arrangement, and asking per repository would
                //fetch it twice and list every pull request on it twice — one
                //pull request, two rows, two allow buttons for one decision.
                var asked = [];
                var already = {};
                mine.forEach(function (r) {
                    var places = (r.reads && r.reads.pulls && r.reads.pulls.length)
                        ? r.reads.pulls
                        : [r.issuesOn || (r.remote && r.remote.owner ? r.remote.owner + '/' + r.remote.repo : null)];
                    places.filter(Boolean).forEach(function (on) {
                        if (already[on]) return;
                        already[on] = true;
                        asked.push({ r: r, on: on });
                    });
                });

                for (var i = 0; i < asked.length; i++) {
                    var r = asked[i].r;
                    var on = asked[i].on;
                    var bits = on.split('/');
                    var said = null;
                    try { said = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls?state=open&per_page=100'); }
                    catch (e) { continue; }
                    if (said.status !== 200 || !Array.isArray(said.body)) continue;

                    said.body.forEach(function (p) {
                        var from = String((p.head && p.head.repo && p.head.repo.full_name) || '').trim();
                        var sha = (p.head && p.head.sha) || null;
                        var isOurs = from ? !!ours[from] : false;
                        var may = allowCheck(on, p.number, sha);
                        rows.push({
                            on: on, repo: r.repo, number: p.number, title: p.title, url: p.html_url,
                            author: (p.user && p.user.login) || null,
                            //GitHub's own word for how close the author is to the
                            //repository. Reported rather than interpreted — "is
                            //this person trusted" is not this app's judgement to
                            //make, and the answer it would give is somebody's
                            //GitHub permissions rather than their intentions.
                            association: p.author_association || null,
                            headRepo: from || null, headSha: sha,
                            ours: isOurs,
                            allowed: isOurs ? true : may.allowed,
                            stale: isOurs ? false : may.stale,
                            why: isOurs ? null : may.why,
                            said: may.said || null
                        });
                    });
                }

                //AND WHETHER ANYBODY HAS REVIEWED EACH ONE, THIS HOST INCLUDED.
                //A judge that already reviewed this commit should not be sent
                //to read it again, and that is a fact GitHub holds. One request
                //per open pull request, fingerprinted; null when it would not
                //say.
                for (var ri = 0; ri < rows.length; ri++) {
                    rows[ri].reviews = await reviewsOf(rows[ri].on, rows[ri].number);
                    rows[ri].reviewedHere = !!(rows[ri].reviews && rows[ri].reviews.latestByThisHost
                        && rows[ri].reviews.latestByThisHost.sha === rows[ri].headSha);
                }

                var waiting = rows.filter(function (x) { return !x.ours && !x.allowed; });
                return {
                    pulls: rows,
                    waiting: waiting.length,
                    note: rows.length
                        ? (waiting.length
                            ? waiting.length + ' pull request(s) arrived from outside and cannot be judged until you allow it. '
                                + 'Allowing names the commit: if the author pushes again it has to be allowed again.'
                            : 'Every open pull request here is either this host\'s own or has been allowed at the commit it is on.')
                        : 'No open pull requests.'
                };
            }
        }));

        undo.push(actions.define('prAllowJudging', {
            about: 'Allow a judge to read an incoming pull request, at the commit it is on now',
            takes: ['repo', 'number', 'note'],
            run: async function (args) {
                var a = args || {};
                //A MODEL MAY NOT DECIDE THAT SOMEBODY ELSE'S CODE IS FIT TO BE
                //READ HERE. This is the same boundary as approving a job, and it
                //is the one the standing rule about incoming pull requests is
                //about.
                //AND A PRESS DRIVEN FROM THE COMMAND LINE IS THE COMMAND LINE.
                //This read the wire alone. ../../core/drive refuses a PROTECTED
                //button before it reaches here, and the drill that found this in
                //the app being ported from says exactly why that is not enough:
                //"one windowClick opened the confirm dialog and stopped, which
                //looked like the guard working and was only the dialog. The
                //guard itself was not there."
                //
                //NOT `_fromTest`: a drill may allow one, which is how the judging
                //suite gets a pull request it can then have read. The line is the
                //same one approving draws.
                if (a._overTheWire || a._driven) {
                    throw new Error('Allowing a pull request to be judged is done in the window, by a person who has looked at it. '
                        + 'A model may not decide that somebody else\'s code is fit to be read here. '
                        + 'A press driven from the command line is the command line, whichever button it lands on.');
                }

                var repo = String(a.repo || '').trim();
                var number = Number(a.number);
                if (!repo || !number) throw new Error('Say which repository and which pull request.');

                var known = await relayed('repositories');
                var row = ((known && known.repos) || []).filter(function (r) { return r.repo === repo; })[0];
                if (!row) throw new Error('There is no repository called "' + repo + '" in this workspace.');

                var on = row.issuesOn || (row.remote && row.remote.owner ? row.remote.owner + '/' + row.remote.repo : null);
                if (!on) throw new Error('"' + repo + '" has no GitHub remote this host can read from.');

                var bits = on.split('/');
                var r = await github.call('GET', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + number);
                if (r.status !== 200 || !r.body) throw new Error(on + ' has no pull request #' + number + '.');

                //WITHOUT A COMMIT THERE IS NOTHING TO RECORD IT AGAINST, and an
                //allowance with no commit is one that carries onto whatever the
                //author pushes next.
                var sha = r.body.head && r.body.head.sha;
                if (!sha) {
                    throw new Error('GitHub did not say which commit ' + on + '#' + number + ' is at, so there is nothing to record an allowance against.');
                }

                var doc = allowances();
                var all = doc.read({}) || {};
                all[allowKey(on, number)] = {
                    on: on, number: number, sha: sha,
                    //WHO ALLOWED A STRANGER'S CODE TO BE READ HERE is exactly the
                    //question somebody asks afterwards, and the answer must not
                    //be reconstructed from memory.
                    by: actions.whoAsked(a),
                    note: a.note ? String(a.note) : null,
                    at: new Date().toISOString()
                };
                doc.write(all);

                log.good('#' + number + ' on ' + on + ' may be judged at ' + sha.slice(0, 7));
                return {
                    allowed: all[allowKey(on, number)],
                    note: on + '#' + number + ' may be read at ' + sha.slice(0, 7) + '. '
                        + 'This says a judge may READ that commit — it is not a statement that the code is safe to run, '
                        + 'and the allowance stops applying the moment the author pushes again.'
                };
            }
        }));

        undo.push(actions.define('prForbidJudging', {
            about: 'Take back an allowance to judge an incoming pull request',
            takes: ['repo', 'number'],
            run: async function (args) {
                var a = args || {};
                //IN THE WINDOW, LIKE GIVING ONE. Taking one back is the safe
                //direction and could be argued either way — but an allowance is
                //a person's statement, and something that can be withdrawn from
                //outside can be withdrawn at a moment nobody notices, which is
                //how a judging job fails in a way that reads as a bug.
                //THE SAME PAIR OF FLAGS AS GIVING ONE, because it is the same
                //statement withdrawn: a guard on one direction only is a guard
                //somebody walks round by going the other way.
                if (a._overTheWire || a._driven) {
                    throw new Error('Taking an allowance back is done in the window, like giving one. '
                        + 'A press driven from the command line is the command line, whichever button it lands on.');
                }

                var repo = String(a.repo || '').trim();
                var number = Number(a.number);
                if (!repo || !number) throw new Error('Say which repository and which pull request.');

                var known = await relayed('repositories');
                var row = ((known && known.repos) || []).filter(function (r) { return r.repo === repo; })[0];
                if (!row) throw new Error('There is no repository called "' + repo + '" in this workspace.');
                var on = row.issuesOn || (row.remote && row.remote.owner ? row.remote.owner + '/' + row.remote.repo : null);
                if (!on) throw new Error('"' + repo + '" has no GitHub remote this host can read from.');

                var id = allowKey(on, number);
                var doc = allowances();
                var all = doc.read({}) || {};
                var had = all[id] || null;
                if (had) { delete all[id]; doc.write(all); log.warn('#' + number + ' on ' + on + ' may no longer be judged'); }
                return {
                    forgotten: had,
                    note: had
                        ? on + '#' + number + ' may no longer be judged. A judgement already running is not stopped by this — '
                            + 'it stops the next one being asked for.'
                        : 'Nothing was allowing ' + on + '#' + number + '.'
                };
            }
        }));
        //---- ONE PAIR, READ FROM GITHUB ----------------------------------
        //
        //`prCuts` ANSWERS ABOUT ALL OF THEM and asks GitHub about every pull
        //request in every cut to do it — three requests each, for cuts that
        //landed months ago. Anything following ONE change through does not want
        //that, and asking the whole board to find out about a pair somebody
        //already named is how a check becomes too slow to run.
        //
        //THE SAME `stateOf`, so the answer cannot disagree with the board. What
        //is different is only which records it is asked about.
        //
        //`landed: null` FOR A PAIR NOBODY SENT, which is a third answer and not a
        //no. "It has not landed" about a change that was never sent out reads as
        //a failure to land rather than as nothing having happened.
        //---- THE STORY OF A CUT ---------------------------------------------
        //
        //EVERYTHING THAT TOUCHED IT, IN TIME, NEWEST FIRST -- what came in from
        //GitHub, what went out in the person's name, what the supervisor said
        //at each waking, and the tasks and judgements between. Gathered from
        //the records and the events log; ./story.js is the composition and
        //is pure. Asked for by the pane while a cut is picked.
        undo.push(actions.define('prCutStory', {
            about: 'Everything that touched a cut, in time, newest first: what arrived from GitHub, what went out, '
                + 'what the supervisor said, and the tasks and judgements between',
            takes: ['source', 'target'],
            run: async function (args) {
                var a = args || {};
                var source = String(a.source || '').trim();
                var target = String(a.target || '').trim();
                if (!source || !target) return { source: source || null, target: target || null, entries: [], note: 'Say which cut: source and target.' };

                var all = (await read(landings)) || {};
                var rec = all[key(source, target)] || null;

                var board = (await relayed('branchBoard')) || {};
                var row = ((board.branches) || []).filter(function (b) { return b.name === source; })[0] || null;
                var note = row ? row.note : null;

                var issue = null;
                if (note && note.issue) issue = await relayed('issueRead', { on: note.issue.on, number: note.issue.number });

                var tasks = (((await relayed('tasks')) || {}).tasks || []).filter(function (t) { return t.branch === source; });
                var judgements = (((await relayed('judging')) || {}).judgements || []).filter(function (j) {
                    var s = j.subject || {};
                    return s.branch === source || (s.kind === 'cut' && s.source === source);
                });
                var events = (((await relayed('events', { limit: 3000 })) || {}).events || []);
                var held = (await relayed('githubHeld')) || {};

                //THE PULL REQUESTS AS GITHUB HAS THEM NOW, reviews included,
                //over what the record remembers.
                var live = rec ? await relayed('prCutState', { source: source, target: target }) : null;
                var merged = rec ? Object.assign({}, rec) : { source: source, target: target };
                if (live && Array.isArray(live.pulls) && live.pulls.length) {
                    merged.pulls = (rec.pulls || []).map(function (p) {
                        var now = live.pulls.filter(function (x) { return x.repo === p.repo; })[0];
                        return now ? Object.assign({}, p, now) : p;
                    });
                }

                var entries = storyOf.compose({
                    rec: merged, note: note, issue: issue, tasks: tasks, judgements: judgements,
                    events: events, hostLogin: held.login || null
                });
                return {
                    source: source, target: target, entries: entries,
                    issue: note && note.issue ? note.issue : null,
                    note: entries.length
                        ? entries.length + ' moment(s), newest first. The last one is where it started.'
                        : 'Nothing is recorded about this cut yet.'
                };
            }
        }));

        undo.push(actions.define('prCutState', {
            about: 'What became of a change that was sent out: each pull request, read from GitHub',
            takes: ['source', 'target'],
            run: async function (args) {
                var a = args || {};
                var source = String(a.source || '').trim();
                var target = String(a.target || '').trim();

                if (!source || !target) {
                    throw new Error('Two lines: --source what carries the change, --target what it goes into.');
                }

                var all = await read(landings);
                if (all === null) throw new Error('No workspace is open, so there are no PR cuts.');

                var rec = all[key(source, target)];
                if (!rec) {
                    return {
                        source: source, target: target, landed: null, pulls: [],
                        note: 'This pair has not been sent out from here.'
                    };
                }

                var at = await stateOf(rec);

                //WHAT IS TRUE OF THE PARTS, in the words the board uses. A cut is
                //landed only when every pull request in it is merged — the point
                //of holding them together is that they land together — so
                //anything less says how far it got rather than "no".
                var said = [
                    at.merged ? (at.merged + ' merged') : null,
                    at.open ? (at.open + ' still open') : null,
                    at.closed ? (at.closed + ' closed without merging') : null
                ].filter(Boolean).join(', ') || 'nothing was opened';

                return Object.assign({}, at, {
                    note: at.landed
                        ? 'Landed: all ' + at.of + ' pull request(s) are merged.'
                        : said + '. It is not landed until every one of them is.'
                });
            }
        }));

        undo.push(actions.define('prCuts', {
            about: 'Every PR cut: one act, one pull request per repository, and how far each has got',
            run: async function () {
                var all = await read(landings);
                if (all === null) return { cuts: [], drafts: [], note: 'No workspace is open, so there are no PR cuts.' };

                //---- ASKED TOGETHER, NOT ONE AFTER ANOTHER -------------------
                //
                //THIS WAS A `for` LOOP WITH AN `await` IN IT, and it is the whole
                //reason this tab took twenty-three seconds. Twenty-six cuts,
                //twenty-six round trips to GitHub, each waiting for the one
                //before it to come back — and every one of them answering that a
                //pull request merged weeks ago is still merged.
                //
                //THE BOUND IS ../../github's, deliberately. How many things this
                //app may ask GitHub for at once is a fact about GitHub, and the
                //plugin that owns the connection is the one place it can be
                //changed once rather than guessed at per pane.
                //
                //ORDER IS KEPT by `many`, which matters here: these become rows
                //somebody reads down.
                var names = Object.keys(all);
                var rows = await github.many(names, function (n) { return stateOf(all[n]); });

                //---- WHAT WAS LEARNED IS WRITTEN DOWN, ONCE ------------------
                //
                //A PULL REQUEST THAT GITHUB SAYS IS MERGED IS MERGED FOR GOOD,
                //and recording it here is what stops the next load asking. See
                //`isFinal` above for why this direction is the safe one.
                //
                //AFTER THE POOL AND NOT INSIDE IT. Eight of these run at once,
                //and eight of them reading, changing and writing one document
                //would lose whichever landed first — a race that shows up as a
                //cut quietly reverting to "open" and being asked about for ever.
                //One write, off the answers that came back.
                var learned = [];
                for (var r = 0; r < rows.length; r++) {
                    var was = all[names[r]] || {};
                    (rows[r].pulls || []).forEach(function (p, at) {
                        var before = (was.pulls || [])[at] || {};
                        if (p.state === 'merged' && p.mergedAt && !before.mergedAt) {
                            learned.push({ name: names[r], at: at, mergedAt: p.mergedAt });
                        }
                    });
                }

                if (learned.length) {
                    var doc = await landings();
                    var held = doc.read({}) || {};
                    learned.forEach(function (it) {
                        var cut = held[it.name];
                        var p = cut && (cut.pulls || [])[it.at];
                        if (!p) return;
                        p.state = 'merged';
                        p.mergedAt = it.mergedAt;
                    });
                    doc.write(held);
                    log.info(learned.length + ' pull request(s) have merged and will not be asked about again');
                }

                //A DRAFT IS A CUT THAT HAS NOT LEFT YET, and it belongs at the
                //top rather than sorted among the finished ones. Seventeen landed
                //cuts are history and want nothing; the one thing waiting for a
                //person is the reason somebody opened this pane.
                //AND A DRAFT WHOSE PAIR HAS ALREADY BEEN CUT IS NOT ONE. The
                //text was written for that cut and the cut exists; listing it
                //again as "not sent" is asking for the same thing twice, and the
                //second copy is the one that reads as outstanding work.
                var written = (await read(drafts)) || {};
                var waiting = Object.keys(written)
                    .filter(function (k) { return !all[k]; })
                    .map(function (k) {
                        return Object.assign({ id: k, draft: true }, written[k]);
                    });

                var live = rows.filter(function (r) { return !r.landed; });
                //---- WHAT STILL WANTS SOMETHING, FIRST -----------------------
                //
                //SORTING BY DATE ALONE PUT A WALL OF GREEN AT THE TOP. Thirty
                //landed cuts are history and want nothing; one that is still out
                //is the reason somebody opened this pane, and on a busy day it
                //sat underneath twenty finished ones from the same afternoon.
                //
                //NEWEST FIRST WITHIN EACH GROUP, and no ordering BETWEEN the
                //groups beyond this one: among the landed there is no more or
                //less landed.
                var byWhen = function (a, b) {
                    return String(b.touched || b.opened).localeCompare(String(a.touched || a.opened));
                };
                var stillOut = rows.filter(function (r) { return !r.landed; }).sort(byWhen);
                var finished = rows.filter(function (r) { return r.landed; }).sort(byWhen);

                return {
                    cuts: stillOut.concat(finished),
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

        //A DRAFT IS THE ONE THING HERE THAT CAN BE UNDONE COMPLETELY, because
        //nothing about it has left this host. Without this, text written for a
        //pair of lines could be replaced and never removed: a draft whose branch
        //no longer carries anything sat on the list as something waiting to be
        //sent, for ever, and the only way to clear it was to send it.
        //
        //NOT A GATE. Sending is the act with consequences somewhere else, and it
        //has one; throwing away a paragraph that never left is not that, and a
        //confirm dialog on it would teach people to click through the one that
        //matters.
        undo.push(actions.define('prDraftForget', {
            about: 'Throw away what was written for a pair of lines',
            takes: ['source', 'target'],
            run: async function (args) {
                var a = args || {};
                if (!a.source || !a.target) throw new Error('Say which two lines.');
                var doc = await drafts();
                if (!doc) throw new Error('No workspace is open.');
                var all = doc.read({}) || {};
                var k = key(a.source, a.target);
                var had = !!all[k];
                delete all[k];
                doc.write(all);
                //WHAT WAS THERE IS SAID BACK, because this is the last moment
                //anything could. "Thrown away" with nothing named reads the same
                //whether it removed a paragraph or nothing at all.
                return {
                    forgotten: had ? k : null,
                    note: had
                        ? 'Thrown away. Nothing was on GitHub, so nothing there changed.'
                        : 'There was none — nothing had been written for "' + a.source + '" into "' + a.target + '".'
                };
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

        //---- WHAT WOULD ACTUALLY GO OUT --------------------------------------
        //
        //THE LAST THING BETWEEN WRITING A PULL REQUEST AND PUBLISHING IT. What
        //`prDraftSave` stores is what somebody typed; what goes to GitHub is
        //that with every template block on this host appended under it, into a
        //repository this host does not own. Those are not the same text and not
        //obviously the same address, and the difference is only visible here.
        //
        //IT PUBLISHES NOTHING, which is why it is allowed over the wire when
        //`prCutMake` is not: reading what a press would do is not the press.
        //
        //AND IT NEVER GUESSES. Before a cut exists its pull requests have no
        //numbers, so the cross-links show `?` rather than a plausible number —
        //a preview that invents is the one thing a preview must not do, since
        //its whole job is being believed.
        undo.push(actions.define('prTemplatePreview', {
            about: 'What the pull requests would say for a pair of lines, composed from the blocks that are on',
            needs: 'workspace',
            takes: ['source', 'target', 'title', 'body', 'repo'],
            run: async function (args) {
                var a = args || {};
                var source = String(a.source || '').trim();
                var target = String(a.target || '').trim();

                var pair = await carrying(source, target);

                //CARRYING NOTHING IS AN ANSWER, not a refusal. It is the
                //ordinary state of a pair somebody is still working on, and the
                //pane draws it as a sentence rather than as an error.
                if (!pair.on.length) {
                    return {
                        text: '', repos: [], where: [],
                        note: '"' + source + '" carries nothing that "' + target + '" does not already '
                            + 'have, so no pull request would be opened.'
                    };
                }

                //REAL NUMBERS WHEN THERE ARE ANY. Once a cut exists its pull
                //requests have numbers, so the cross-links can be the ones an
                //edit would actually write.
                var kept = ((await landings()).read({}) || {})[key(source, target)] || null;
                var real = (kept && kept.pulls ? kept.pulls : []).filter(function (p) { return p.number; });

                //THE PLACEHOLDER IS BUILT BELOW, once the destinations are
                //known — see `pulls` after `where`. The numbers are the only
                //part that genuinely cannot exist yet.
                var pulls = real.length
                    ? real.map(function (p) { return { repo: p.repo, number: p.number, url: p.url }; })
                    : null;

                var on = pair.on.map(function (r) { return r.repo; });
                var which = a.repo && on.indexOf(a.repo) >= 0 ? a.repo : on[0];
                var typed = String(a.body || '').trim();

                //---- WHERE EACH ONE WOULD GO ---------------------------------
                //
                //`repos` IS A LIST OF NAMES, which answers "how many" and not
                //"into whose". Only one of those is worth asking before pressing
                //a button that publishes: a pull request goes FROM a fork this
                //host pushes to, INTO a repository somebody else owns, and here
                //those are two different accounts.
                //
                //THE WHOLE ADDRESS, NOT ONLY THE OWNER AND NAME. Two forks can
                //differ by one character in the middle of a word, and which of
                //them receives this is exactly what is being checked.
                //THE TARGET IS WORKED OUT THE WAY `openOne` WORKS IT OUT, from
                //`repositories`' own `target.on`, falling back to this
                //repository's own remote. Not from anything on the git remote
                //itself: `git.origin` answers `{ url, owner, repo, kind }` and
                //has no idea a fork has a parent, so a preview reading a
                //`parent` field off it would quietly show every pull request
                //going into the fork it came from.
                //
                //THAT IS THE FAILURE `openOne` IS WRITTEN AGAINST — "it opens a
                //pull request inside the fork... which looks perfectly normal,
                //reports success, and lands the work nowhere anybody is
                //watching". A preview that showed it landing in the right place
                //while the press sent it somewhere else would be worse than no
                //preview, because its whole job is being believed.
                var known = await relayed('repositories');
                var rows = (known && known.repos) || [];

                var where = [];
                for (var i = 0; i < pair.on.length; i++) {
                    var r = pair.on[i];
                    var remote = null;
                    try { remote = await refs.origin(r.repo); } catch (e) { remote = null; }

                    var mine = remote && remote.owner ? remote.owner + '/' + remote.repo : null;
                    var row = rows.filter(function (x) { return x.repo === r.repo; })[0];
                    //NULL WHERE NOBODY PICKED, so the preview shows the same
                    //nothing the cut would refuse on rather than drawing your
                    //own remote as the destination. `intoWhy` is the sentence
                    //the pane puts in its place.
                    var chose = row && row.target ? row.target : null;
                    var into = (chose && chose.on) || null;

                    //THE COMMIT EACH SIDE IS AT, so the answer is enough on its
                    //own to draw the pair. The window used to look these up in
                    //`lines`, which meant only a pane that had loaded `lines`
                    //could show them — and the pane where somebody presses Send
                    //it had not.
                    //
                    //SHORT, BECAUSE IT IS READ AND NOT USED. It is there to
                    //answer "the same commit I pushed?" at a glance, and a
                    //forty-character sha answers that no better than seven.
                    var at = null;
                    var baseAt = null;
                    try { at = await refs.sha(r.repo, r.head); } catch (e) { at = null; }
                    try { baseAt = await refs.sha(r.repo, r.base); } catch (e) { baseAt = null; }

                    where.push({
                        repo: r.repo, branch: r.head, base: r.base, ahead: r.ahead,
                        at: at ? String(at).slice(0, 7) : null,
                        baseAt: baseAt ? String(baseAt).slice(0, 7) : null,
                        from: mine, into: into,
                        //WHY THERE IS NO DESTINATION, said here so the preview
                        //does not have to guess which of the two it is.
                        intoWhy: into ? null : (chose && chose.off
                            ? 'set to send work nowhere'
                            : 'nothing picked — Repositories → Repos → Where work goes'),
                        //AND WHETHER IT CROSSES AT ALL, which is the one-word
                        //version of the two addresses under it.
                        crossing: !!(mine && into && into !== mine),
                        fromUrl: mine ? 'https://github.com/' + mine : null,
                        intoUrl: into ? 'https://github.com/' + into : null
                    });
                }

                //---- AND THE LINKS, NOW THAT THE DESTINATIONS ARE KNOWN ------
                //
                //IT WAS `https://github.com/…/pull/?` FOR EVERY REPOSITORY, and
                //the elision was doing no work: the owner and name of the
                //repository a pull request opens on is exactly what `where`
                //just worked out. Only the NUMBER cannot be known before the
                //cut exists, so only the number is a question mark.
                //
                //IT READS AS A BROKEN LINK, which is how it was reported. A
                //preview whose whole job is being believed cannot afford a line
                //that looks like a fault — and this one is in the block that
                //links the cut's pull requests to each other, so it is the part
                //a reader of the finished pull request will follow.
                //
                //NOTHING PICKED SAYS SO INSTEAD. A repository with no
                //destination has no address to show, and `…` in its place hid
                //the fact that this half of the cut cannot open at all.
                if (!pulls) {
                    pulls = pair.on.map(function (r) {
                        var to = (where.filter(function (w) { return w.repo === r.repo; })[0] || {}).into;
                        return {
                            repo: r.repo,
                            number: '?',
                            url: to
                                ? 'https://github.com/' + to + '/pull/?'
                                : '(no remote picked for ' + r.repo + ')'
                        };
                    });
                }

                //THE CUT NOTE, WHICH THE PREVIEW NEVER HAD. `reason`, `cutfrom`
                //and `commits` all read from it and all previewed as nothing --
                //the block appeared only on the real pull request, which is the
                //one place a surprise is expensive. Same lookup prCutMake makes.
                var headName = (pair.on[0] || {}).head;
                var board = headName ? ((await relayed('branchBoard')) || {}) : {};
                var row = ((board.branches) || []).filter(function (b) { return b.name === headName; })[0] || null;

                var context = {
                    branch: headName,
                    me: which,
                    repos: on,
                    note: row ? row.note : null,
                    carries: row ? row.on : [],
                    pulls: pulls
                };

                return {
                    repos: on,
                    where: where,
                    showing: which,
                    //SEPARATELY, so the window can recompose as somebody types
                    //without asking again. What the blocks add depends on the
                    //pair and on which copy — never on what is typed — so it is
                    //fetched once and the sentence in front of it joined on
                    //locally.
                    additions: await compose('', context),
                    text: await compose(typed, context),
                    title: String(a.title || '').trim() || (kept && kept.said && kept.said.title) || source,
                    said: (kept && kept.said) || null,
                    existing: kept ? { count: real.length, opened: kept.opened } : null,
                    guessing: !real.length,
                    note: 'As ' + which + ' would read it. ' + on.length + ' repositor'
                        + (on.length === 1 ? 'y' : 'ies') + ' carry work: ' + on.join(', ') + '.'
                        + (real.length
                            ? ' The links are the real pull request numbers.'
                            : ' Nothing is cut yet, so the links show ? until it is.')
                };
            }
        }));

        //---- sending it out --------------------------------------------------
        //
        //ONE LANDING, N PULL REQUESTS. Each repository that carries something
        //gets its branch pushed and a pull request opened, and the whole thing is
        //recorded under one key so it can be read as one change afterwards.
        //
        //PUSHED FIRST, THEN OPENED. A pull request against a branch the far end
        //has never seen is a 422 with nothing useful in it.
        //
        //AND THE CROSSLINKS ARE WRITTEN LAST, in a second pass, because the
        //numbers do not exist until every one of them is open.
        //---- A LIVE CUT FOLLOWS ITS BRANCH ----------------------------------
        //
        //THE PULL REQUEST SAT ON A REJECTED COMMIT FOR AN HOUR while the fix
        //existed here. A follow-up task landed on the branch, a judge accepted
        //it, and nothing pushed: the only thing that pushes was prCutMake, which
        //is for OPENING, and running it again on a pair that already has pull
        //requests got as far as the push and then "Validation Failed" from
        //GitHub for the pull request that already existed. It worked by
        //accident, and the supervisor believed the pull request had moved
        //before it had.
        //
        //SO THIS: for every open pull request in a cut, push its branch and
        //re-compose its description from what was said at the cut plus the
        //template blocks (the commit list, the Closes line) as they now stand.
        //Nothing is opened. The same judging gate as opening, for a caller on
        //the pipe: a pushed commit is code a maintainer can merge.
        //
        //AND PRCUTMAKE ON A LIVE PAIR IS THIS, NOT A SECOND PULL REQUEST. A
        //branch with a pull request open gets that pull request updated;
        //"as it wants, un-requested" is the failure the person named.
        async function refreshCut(a, source, target) {
            var all = await read(landings);
            var rec = all && all[key(source, target)];
            //A NUMBER IS THE FACT. `opened` is what the LAST attempt said, and
            //a re-run that got "Validation Failed" from GitHub for a pull
            //request that already existed wrote opened:false over a record that
            //still had its number -- which then read as "no live cut".
            var live = ((rec && rec.pulls) || []).filter(function (p) {
                return p.number && p.state !== 'closed' && !p.merged;
            });
            if (!live.length) return null;

            var pair = { on: [] };
            try { pair = await carrying(source, target); } catch (e) { pair = { on: [] }; }
            await mustBeJudged(a, [source].concat(pair.on.map(function (w) { return w.head; })));

            var env = keys.github.envForPush();
            var helper = keys.github.credentialHelper;
            var board = (await relayed('branchBoard')) || {};
            var said = (rec.said || {});
            var done = [];

            for (var i = 0; i < live.length; i++) {
                var p = live[i];
                //THE BRANCH BY ITS OWN NAME. A record from a cross-repository
                //cut keeps `head` as owner:branch, which is GitHub's spelling
                //and not git's.
                var w = pair.on.filter(function (x) { return x.repo === p.repo; })[0]
                    || { repo: p.repo, head: String(p.head || '').replace(/^[^:]+:/, ''), base: p.base };
                if (!w.head) { done.push({ repo: p.repo, number: p.number, pushed: false, why: 'no branch is recorded for it' }); continue; }

                var sent = await git.push(p.repo, w.head, { env: env, helper: helper });
                if (!sent.pushed) {
                    done.push({ repo: p.repo, number: p.number, pushed: false, why: 'it could not be pushed — ' + sent.why });
                    continue;
                }

                //THE DESCRIPTION, RE-COMPOSED, when what was said at the cut is
                //still here. Composing over a body already composed would put
                //every block in twice, so a cut that never recorded its words
                //keeps the description it has and says so.
                var patched = null;
                if (said.body != null) {
                    var row = ((board.branches) || []).filter(function (b) { return b.name === w.head; })[0] || null;
                    var body = await compose(said.body, {
                        branch: w.head, me: p.repo,
                        repos: live.map(function (x) { return x.repo; }),
                        note: row ? row.note : null,
                        carries: row ? row.on : [],
                        pulls: live
                    });
                    var fields = { body: body };
                    if (said.title) fields.title = String(said.title);
                    var bits = String(p.into || '').split('/');
                    if (bits.length !== 2) {
                        var remote = await refs.origin(p.repo);
                        bits = [remote.owner, remote.repo];
                    }
                    var r = await github.call('PATCH', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + p.number, fields);
                    patched = r.status === 200 ? true : ((r.body && r.body.message) || ('GitHub answered ' + r.status));
                }
                done.push({ repo: p.repo, number: p.number, url: p.url || null, pushed: true, head: w.head, described: patched });
            }

            var doc = await landings();
            var now = doc.read({}) || {};
            var k = key(source, target);
            if (now[k]) {
                now[k] = Object.assign({}, now[k], { touched: new Date().toISOString(), refreshed: new Date().toISOString() });
                doc.write(now);
            }

            var went = done.filter(function (d) { return d.pushed; });
            log.good('refreshed the cut "' + source + '" into "' + target + '" — ' + went.length + ' of ' + done.length
                + ' pull request(s) now carry the branch as it stands');
            return {
                source: source, target: target, pulls: done, refreshed: went.length,
                note: went.length + ' of ' + done.length + ' pull request(s) updated to the branch as it stands. '
                    + (said.body == null
                        ? 'Their descriptions were left as they are — nothing here recorded what was said at the cut. '
                        : 'Their descriptions were re-composed from what was said at the cut. ')
                    + 'Nothing was opened.'
            };
        }

        //---- AND THE OTHER DIRECTION: A BRANCH ONLY THIS HOST HAS -----------
        //
        //THE SAME DEAD END, POINTING THE OTHER WAY. A branch pushed to no
        //remote showed on the Repos tab as *only here*, with its commit, and a
        //disabled button reading "Origin has no branch by this name" — true,
        //and read as "there is nothing to do", when the thing to do is send it.
        //
        //WORK THAT EXISTS IN ONE PLACE IS THE CASE THIS MATTERS FOR. A DIY
        //machine pushes to THIS host, not to GitHub — that is the whole point
        //of the lane — so what somebody spent an afternoon on lives on one
        //disk until they say otherwise. There was no way to say otherwise
        //without opening a pull request, which is a much larger act and needs a
        //judgement first.
        //
        //THE CREDENTIAL IS NOT LOOKED AT HERE. `envForPush()` and
        //`credentialHelper` come from ../../keys and go straight to git; this
        //file could not say what is in either.
        //
        //IT PUSHES TO `origin` AND NOWHERE ELSE, which for a fork is the
        //person's own remote. Nothing here chooses a destination — that is
        //`where work goes`, and it is a question for a pull request rather than
        //for keeping a branch safe.
        //
        //---- WHY IT IS HERE AND NOT WITH ITS PANE --------------------------
        //
        //THE BUTTON IS ON Repos → Branches and this action is not, which breaks
        //the ordinary rule that an action goes where its pane is. It has to.
        //../repos DOES NOT CONSUME `keys` AND MUST NOT: its layering claim is
        //that a pane can get GitHub data without knowing a credential exists —
        //not "does not currently read one", CANNOT — and there is a test that
        //fails the moment `keys` appears in its `consumes`.
        //
        //Adding it there was tried first and that test caught it. So the act
        //lives with the credential, in the plugin that already pushes branches,
        //and the pane calls it by name like any other action.
        undo.push(actions.define('repoPushBranch', {
            about: 'Push a branch to origin, so work that only exists here is somewhere else too',
            takes: ['repo', 'branch'],
            run: async function (args) {
                var a = args || {};
                var name = String(a.repo || '').trim();
                var branch = String(a.branch || '').trim();

                if (!name) throw new Error('Say which repository.');
                if (!branch) throw new Error('Say which branch to push.');

                var found = await workspace.repos();
                if (!found.some(function (r) { return r.name === name; })) {
                    throw new Error('There is no repository called "' + name + '" here. This workspace has: '
                        + found.map(function (r) { return r.name; }).join(', ') + '.');
                }

                var rows = await refs.of(name);
                var b = rows[branch];

                if (!b || !b.local) {
                    throw new Error('There is no branch called "' + branch + '" in ' + name
                        + ' on this host, so there is nothing to push.');
                }

                //ALREADY THERE AND AT THE SAME COMMIT IS AN ANSWER. Pushing it
                //again would succeed and change nothing, and saying "pushed"
                //about that is how somebody stops believing the word.
                if (b.remote && String(b.remote) === String(b.local)) {
                    return {
                        repo: name, branch: branch, pushed: false, already: true, at: b.local,
                        note: '"' + branch + '" is already on origin at ' + String(b.local).slice(0, 7)
                            + ', at the same commit as here.'
                    };
                }

                var env = keys.github.envForPush();
                var helper = keys.github.credentialHelper;

                var sent = await git.push(name, branch, { env: env, helper: helper });
                if (!sent.pushed) {
                    throw new Error('Could not push "' + branch + '" in ' + name + ': '
                        + (sent.why || 'git did not say why'));
                }

                //ASKED AGAIN RATHER THAN ASSUMED. What origin has after a push
                //is a fact about origin, and the row this answer redraws is the
                //one that says whether the two match.
                var now = (await refs.of(name))[branch] || {};

                //`log` IS ALREADY SCOPED TO 'git' IN THIS PLUGIN — see the top of
                //the file. Scoping it again is what the version of this written
                //for ../repos did, and it threw.
                log.good(name + ': pushed "' + branch + '" to origin at '
                    + String(now.remote || b.local).slice(0, 7));

                return {
                    repo: name, branch: branch, pushed: true, already: false,
                    at: now.remote || b.local,
                    note: '"' + branch + '" is on origin now, at '
                        + String(now.remote || b.local).slice(0, 7) + '. It is a branch on your remote and '
                        + 'nothing else — no pull request was opened and nothing was asked of anybody.'
                };
            }
        }));

        undo.push(actions.define('prCutRefresh', {
            about: 'Push a line again and bring every open pull request cut from it up to the branch as it now stands. '
                + 'Nothing is opened; a cut that is already live follows its branch',
            takes: ['source', 'target'],
            run: async function (args) {
                var a = args || {};
                var source = String(a.source || '').trim();
                if (!source) throw new Error('Say which line, by name.');
                var target = String(a.target || '').trim();

                var all = (await read(landings)) || {};
                var pairs = Object.keys(all).filter(function (k) {
                    var c = all[k];
                    return c && c.source === source && (!target || c.target === target);
                });
                var out = [];
                for (var i = 0; i < pairs.length; i++) {
                    var got = await refreshCut(a, all[pairs[i]].source, all[pairs[i]].target);
                    if (got) out.push(got);
                }
                if (!out.length) {
                    return {
                        source: source, target: target || null, cuts: [], refreshed: 0,
                        note: 'No live cut is open from "' + source + '"' + (target ? ' into "' + target + '"' : '')
                            + '. Nothing to bring up to date — prCutMake is what opens one.'
                    };
                }
                return {
                    source: source, target: target || null, cuts: out,
                    refreshed: out.reduce(function (n, c) { return n + c.refreshed; }, 0),
                    note: out.map(function (c) { return c.target + ': ' + c.note; }).join(' ')
                };
            }
        }));

        undo.push(actions.define('prCutMake', {
            about: 'Push a line onward and open a pull request per repository, tracked together as one landing. '
                + 'On a pair that is already cut, the open pull requests are brought up to the branch instead',
            takes: ['source', 'target', 'title', 'body', 'into', 'draft'],
            run: async function (args) {
                var a = args || {};

                var source = String(a.source || '').trim();
                var target = String(a.target || '').trim();
                if (!source || !target) throw new Error('Say which line is being proposed and which it would go into.');
                if (!String(a.title || '').trim()) throw new Error('Give it a title — it is the first thing a reviewer reads.');

                //ALREADY CUT: REFRESH, NEVER A SECOND PULL REQUEST. What was
                //said this time replaces what was said before, so a re-cut with
                //new words is how the description is rewritten.
                var had = await read(landings);
                var have = had && had[key(source, target)];
                if (have && (have.pulls || []).some(function (p) { return p.number && p.state !== 'closed' && !p.merged; })) {
                    var doc0 = await landings();
                    var now0 = doc0.read({}) || {};
                    now0[key(source, target)] = Object.assign({}, now0[key(source, target)], {
                        said: Object.assign({}, (have.said || {}), { title: String(a.title).trim(), body: String(a.body || ''), at: new Date().toISOString() })
                    });
                    doc0.write(now0);
                    var again = await refreshCut(a, source, target);
                    if (again) {
                        return Object.assign({}, again, {
                            opened: 0, pulls: again.pulls,
                            note: '"' + source + '" into "' + target + '" was already cut, so nothing was opened: ' + again.note
                        });
                    }
                }

                var pair = await carrying(source, target);
                if (!pair.on.length) {
                    throw new Error('"' + source + '" carries nothing that "' + target + '" does not already have.');
                }

                //THE GATE GOES HERE AND NOT AT THE TOP, because it needs the
                //names a judge could have read — the line's own, and every
                //branch the line is made of — and those are not known until
                //`carrying` has worked out what this cut is.
                //
                //STILL BEFORE ANYTHING LEAVES THIS HOST: nothing is pushed and
                //nothing is opened above this line.
                await mustBeJudged(a, [source].concat(pair.on.map(function (w) { return w.head; })));

                //THE CREDENTIAL COMES FROM ../../keys AND IS NOT LOOKED AT HERE.
                //`env` and `helper` go straight to git; this file never reads
                //either, and could not say what is in them.
                var env = keys.github.envForPush();
                var helper = keys.github.credentialHelper;

                var doc = await landings();
                var opened = [];

                for (var i = 0; i < pair.on.length; i++) {
                    var w = pair.on[i];

                    var sent = await git.push(w.repo, w.head, { env: env, helper: helper });
                    if (!sent.pushed) {
                        opened.push({ repo: w.repo, opened: false, head: w.head, base: w.base, why: 'it could not be pushed — ' + sent.why });
                        continue;
                    }

                    var note = ((await relayed('branchBoard')) || {});
                    var row = ((note.branches) || []).filter(function (b) { return b.name === w.head; })[0] || null;

                    var body = await compose(a.body, {
                        branch: w.head, me: w.repo,
                        repos: pair.on.map(function (x) { return x.repo; }),
                        note: row ? row.note : null,
                        carries: row ? row.on : [],
                        pulls: opened
                    });

                    opened.push(await openOne(w.repo, {
                        head: w.head, base: w.base, title: String(a.title).trim(),
                        body: body, into: a.into || null, draft: !!a.draft
                    }));
                }

                //RECORDED WHATEVER HAPPENED, including the ones that did not
                //open. A cut where two of three went out is the state somebody
                //most needs to see, and losing the record of it would leave two
                //pull requests nothing here knows about.
                var all = doc.read({}) || {};
                var k = key(source, target);
                var was = all[k] || { source: source, target: target, opened: new Date().toISOString(), by: actions.whoAsked(a), pulls: [] };
                var merged = was.pulls.slice();
                opened.forEach(function (p) {
                    var at = merged.map(function (x) { return x.repo; }).indexOf(p.repo);
                    if (at < 0) { merged.push(p); return; }
                    //A FAILED ATTEMPT DOES NOT ERASE A PULL REQUEST THAT EXISTS.
                    //"Validation Failed" for a pull request already open was
                    //being written over its number's row as opened:false, and
                    //the cut then read as having nothing live.
                    if (!p.opened && merged[at].number) {
                        merged[at] = Object.assign({}, merged[at], { lastTry: p.why || null, triedAt: new Date().toISOString() });
                        return;
                    }
                    merged[at] = Object.assign({}, merged[at], p);
                });
                all[k] = Object.assign({}, was, {
                    pulls: merged, touched: new Date().toISOString(),
                    //WHAT WAS SAID, KEPT, so a refresh can compose the body
                    //again over the same words. Before this only prCutUpdate
                    //recorded it, and a cut never edited had no words to
                    //re-compose from.
                    said: Object.assign({}, was.said || {}, { title: String(a.title).trim(), body: String(a.body || ''), at: new Date().toISOString() })
                });
                doc.write(all);

                //AND THE DRAFT IS DONE WITH, because it has been sent.
                try {
                    var dd = await drafts();
                    var written = dd.read({}) || {};
                    if (written[k]) { delete written[k]; dd.write(written); }
                } catch (e) { /* nothing was written for it */ }

                var went = opened.filter(function (p) { return p.opened; });
                var stuck = opened.filter(function (p) { return !p.opened; });
                log.good('cut "' + source + '" into "' + target + '" — ' + went.length + ' pull request(s) opened');

                return {
                    source: source, target: target, pulls: opened, opened: went.length,
                    note: went.length + ' of ' + opened.length + ' opened.'
                        + (stuck.length ? ' ' + stuck.map(function (p) { return p.repo + ' — ' + p.why; }).join('; ') : '')
                };
            }
        }));

        //---- landing it ------------------------------------------------------
        //
        //A PERSON PRESSING THE BUTTON IN THE WINDOW IS THAT PERSON LANDING THEIR
        //OWN CHANGE. Anything else is a model merging into somebody's repository,
        //and that has to have been said out loud first — which is what testing
        //mode being on for this workspace means.
        undo.push(actions.define('prCutLand', {
            about: 'Merge every pull request in a cut, so the change lands as one thing',
            takes: ['source', 'target', 'how'],
            run: async function (args) {
                var a = args || {};
                if (a._overTheWire) {
                    var may = await settings.allowed();
                    if (!may.allowed) {
                        throw new Error('Landing a cut from outside the window is only done while testing mode is on for this workspace. '
                            + may.why + ' A person pressing the button in the window is that person landing their own change; '
                            + 'this is a model merging into somebody\'s repository, and that needs to have been said out loud first.');
                    }
                }

                var all = await read(landings);
                if (all === null) throw new Error('No workspace is open.');
                var rec = all[key(a.source, a.target)];
                if (!rec) throw new Error('Nothing has been cut from "' + a.source + '" into "' + a.target + '" from here.');

                var at = await stateOf(rec);
                var open = at.pulls.filter(function (p) { return p.number && p.state !== 'merged' && p.state !== 'closed'; });
                var already = at.pulls.filter(function (p) { return p.state === 'merged'; });

                if (!open.length) {
                    return {
                        merged: [], note: already.length
                            ? 'Already landed: all ' + already.length + ' pull request(s) are merged.'
                            : 'There is nothing open to merge in this cut.'
                    };
                }

                //---- HOW IT MERGES, AND THE DEFAULT IS `merge` ---------------
                //
                //THIS SAID `squash` AND THAT WAS DRIFT, not a choice. The app
                //this is ported from defaults to `merge` in both the helper and
                //its caller, and the difference is the whole shape of the
                //history afterwards: a merge keeps the commit that was made and
                //the pull request it came through, so the graph reads "Merge
                //pull request #7 from <fork>/<branch>" with the work hanging off
                //it. A squash throws both away and leaves one flat commit on the
                //default branch, authored by whoever pressed the button.
                //
                //WHICH LOOKS EXACTLY LIKE COMMITTING STRAIGHT ONTO master. Five
                //runs of the order drill landed that way in local-repo-a, sitting
                //on master under the human's name, indistinguishable from someone
                //pushing to a protected branch — and the drill passed every time,
                //because merging is all it asserted.
                //
                //IT ALSO BREAKS THE READING AFTERWARDS. A squash rewrites the
                //commits, so the fork looks diverged from a change it already
                //carries and `git cherry` becomes the only way to tell — see
                //../repos, which has a whole panel explaining that state to
                //somebody. Choosing it by default is choosing that explanation
                //for everybody.
                //
                //STILL ASKED FOR, because a squash is a legitimate thing to want
                //on purpose. It is the DEFAULT that was wrong.
                var how = String(a.how || 'merge');
                var done = [];
                for (var i = 0; i < open.length; i++) {
                    var p = open[i];
                    var bits = String(p.into || '').split('/');
                    if (bits.length !== 2) {
                        var remote = await refs.origin(p.repo);
                        bits = [remote.owner, remote.repo];
                    }
                    var r = await github.call('PUT', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + p.number + '/merge',
                        { merge_method: how });
                    //`sha`, `into` AND `how` COME BACK, which they did not, and
                    //that absence is why a drill could not tell a merge from a
                    //squash. "It merged" is the same word for both; the commit
                    //it produced and the method that produced it are not.
                    done.push({
                        repo: p.repo, number: p.number,
                        merged: r.status === 200,
                        sha: (r.body && r.body.sha) || null,
                        into: bits.join('/'),
                        how: how,
                        why: r.status === 200 ? null : ((r.body && r.body.message) || ('GitHub answered ' + r.status))
                    });
                }

                var went = done.filter(function (d) { return d.merged; });
                log.warn('landed ' + went.length + ' of ' + done.length + ' in "' + a.source + '"');
                return {
                    merged: done, landed: went.length,
                    //PARTLY LANDED IS THE STATE WORTH SAYING LOUDEST. The whole
                    //point of a cut is that it lands as one thing, and half of it
                    //being in is the situation somebody has to deal with by hand.
                    note: went.length === done.length
                        ? 'Landed: ' + went.length + ' pull request(s) merged.'
                        : went.length + ' of ' + done.length + ' merged — this change is PARTLY IN. '
                            + done.filter(function (d) { return !d.merged; })
                                .map(function (d) { return d.repo + ' #' + d.number + ' — ' + d.why; }).join('; ')
                };
            }
        }));

        undo.push(actions.define('prCutUpdate', {
            about: 'Change the title, the description, or the state of every pull request in a cut at once',
            takes: ['source', 'target', 'title', 'body', 'state'],
            run: async function (args) {
                var a = args || {};
                notFromThePipe(a);

                var all = await read(landings);
                if (all === null) throw new Error('No workspace is open.');
                var rec = all[key(a.source, a.target)];
                if (!rec) throw new Error('Nothing has been cut from "' + a.source + '" into "' + a.target + '" from here.');

                var fields = {};
                if (a.title != null) fields.title = String(a.title);
                if (a.body != null) fields.body = String(a.body);

                //A PULL REQUEST IS "open" OR "closed", AND NOTHING ELSE. The app
                //being ported from refused anything else here and this passed the
                //string straight into a PATCH — so "close", "merged" or a typo
                //reached GitHub as a change to somebody's repository and came
                //back as a 422 naming a field rather than the word that was
                //wrong. Refused before anything is sent, which is also the
                //difference between one bad word and one bad word per repository.
                if (a.state != null) {
                    var want = String(a.state).trim().toLowerCase();
                    if (want !== 'open' && want !== 'closed') {
                        throw new Error('A pull request is "open" or "closed" — "' + a.state + '" is neither. '
                            + 'Merging one is `prCutLand`, which is a different act and has its own rules.');
                    }
                    fields.state = want;
                }

                if (!Object.keys(fields).length) throw new Error('Say what to change — a title, a description, or the state.');

                var done = [];
                for (var i = 0; i < (rec.pulls || []).length; i++) {
                    var p = rec.pulls[i];
                    if (!p.number) continue;
                    var bits = String(p.into || '').split('/');
                    if (bits.length !== 2) {
                        var remote = await refs.origin(p.repo);
                        bits = [remote.owner, remote.repo];
                    }
                    var r = await github.call('PATCH', '/repos/' + bits[0] + '/' + bits[1] + '/pulls/' + p.number, fields);
                    done.push({
                        repo: p.repo, number: p.number, changed: r.status === 200,
                        why: r.status === 200 ? null : ((r.body && r.body.message) || ('GitHub answered ' + r.status))
                    });
                }

                //WHAT WAS SAID IS KEPT, so the next thing that composes a body
                //starts from what is actually on the pull requests.
                var doc = await landings();
                var now = doc.read({}) || {};
                var k = key(a.source, a.target);
                if (now[k]) {
                    now[k] = Object.assign({}, now[k], {
                        said: Object.assign({}, now[k].said || {}, fields, { at: new Date().toISOString() })
                    });
                    doc.write(now);
                }

                var went = done.filter(function (d) { return d.changed; });
                return {
                    on: done, changed: went.length,
                    note: went.length + ' of ' + done.length + ' changed.'
                        + (went.length === done.length ? '' : ' ' + done.filter(function (d) { return !d.changed; })
                            .map(function (d) { return d.repo + ' #' + d.number + ' — ' + d.why; }).join('; '))
                };
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

    //---- AND WHAT IS OUT AND WAITING ON SOMEBODY ---------------------------
    //
    //THIS PLUGIN PUT NOTHING IN THE INBOX AT ALL, which is how three pull
    //requests sat open with nothing anywhere saying so. They were found by
    //reading `prCutState` by hand, after somebody asked why the dashboard had
    //not mentioned them — and the honest answer was that it had no source for
    //it. The inbox is "everything waiting on you", and a change that is out and
    //not merged is the definition of that: by this app's own rule a person
    //presses merge, so it is waiting on a person from the moment it opens.
    //
    //NAMED BY OWNER AND REPOSITORY, NOT BY THE WORKSPACE NAME. The app being
    //ported from says `local-repo-b #1`, and in a workspace of forks OF forks
    //that names nothing — "#1 on which one, and into what?" is a real question
    //somebody asked about a real pull request. So each is `owner/name#n`, with
    //the branch it would merge into.
    //
    //IT ASKS GITHUB, so an inbox that cannot reach it says nothing rather than
    //guessing — the same rule ../branches follows, and the right way round for
    //a list whose whole worth is that everything on it is real. The pool and
    //the etags are `prCuts`'s, so this costs what that pane costs and not a
    //round trip per cut.
    if (imports.inbox) {
        undo.push(imports.inbox.source({
            name: 'changes that are out and not merged',
            waiting: async function () {
                var all = await read(landings);
                if (!all) return [];
                var names = Object.keys(all);
                if (!names.length) return [];

                var rows = [];
                try {
                    rows = await github.many(names, function (n) { return stateOf(all[n]); });
                } catch (e) { return []; }

                return rows.filter(function (c) {
                    //STILL OPEN SOMEWHERE. `landed` is every pull request merged
                    //and `open` is how many are neither merged nor closed — a cut
                    //whose pull requests were all closed unmerged is finished
                    //with, and nagging about it would be nagging about a decision
                    //somebody already made.
                    return !c.landed && c.open > 0;
                }).map(function (c) {
                    var where = (c.pulls || []).filter(function (p) {
                        return p.number && p.state !== 'merged' && p.state !== 'closed';
                    }).map(function (p) {
                        return (p.into || p.repo) + '#' + p.number + ' → ' + (p.base || '?');
                    });

                    return imports.inbox.item(
                        'change out and not merged',
                        c.source + ' into ' + c.target,
                        'Open and waiting on a merge, as last read from GitHub — and merging is a person\'s '
                            + 'press. ' + where.join(', '),
                        //THE PANE PICKS A CUT BY `source -> target`, the same
                        //id it draws with, and this handed it the source alone
                        //-- so Go to landed on the pane with nothing picked.
                        imports.inbox.at('Repositories', 'PR cuts', c.source + ' -> ' + c.target),
                        { since: c.opened || null, id: c.source + ' -> ' + c.target }
                    );
                });
            }
        }));
    }

    await register(null, {
        prcuts: {
            all: function () { return read(landings); },
            stateOf: stateOf,
            compose: compose,
            blocks: blocksOn,
            key: key,
            //ONE PLACE ANSWERS "MAY THIS BE READ HERE", and everything that
            //leads to the same room asks it here rather than reading the store
            //itself. A second reader is a second chance to get the staleness
            //rule slightly different.
            allowed: { check: allowCheck, all: function () { return allowances().read({}) || {}; } }
        },
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
