//---------------------------------------------------------------------------
//THE LIBRARY: what a worker is told, the rules it is held to, and the code that
//does the telling. Three kinds, one set of rules.
//
//    task <- job <- prompt
//
//A PROMPT is what a worker is told. A JOB is code — a script this app runs,
//given a prompt. A CONTRACT is what a worker may and may not do while doing it.
//All three are text somebody has to READ, and reading them is the whole point:
//the approval is a person saying they read this one.
//
//WHY THIS IS A PLUGIN AND NOT THE WORKER'S. Both ../worker and ../judge are a
//set of jobs, prompts and contracts, and what each does with them is ask
//../queue for work. Neither owns the library — they are two views of it, keyed
//by `kind` — so it is its own plugin, by the same rule that put `pages` in
//../core/io and the ref reads in ../repositories/refs.
//
//---- kept for this COMPUTER, not for a workspace ---------------------------
//
//THE OPPOSITE OF ../core/archive, deliberately. Everything about a task belongs
//to the folder of repositories it delivers into; a prompt does not. "Read the
//README against the code and say where they disagree" names no branch and no
//repository, and a library that emptied itself when somebody switched workspace
//is a library nobody would spend an afternoon building.
//
//So it sits in `state.app` with the keys and the approvals — the other things
//that are true whatever is being worked on.
//
//---- what makes an approval mean anything ---------------------------------
//
//A HASH OF THE THING THAT WILL ACTUALLY BE USED, so an edit is NOTICED rather
//than trusted. A job read and approved in January can be handed a rewritten
//instruction in March and do something nobody agreed to, while every tick on
//the screen stays green — unless the approval is against the words.
//
//AND THE CONTRACT IS PART OF WHAT WAS APPROVED. Changing which rules a prompt
//runs under changes what somebody agreed to as much as rewriting a sentence
//does — more, since the words look identical afterwards.
//---------------------------------------------------------------------------

//THE SAME SHAPE AS THE DRILLS' FINGERPRINT: short, stable, and about the text
//rather than about when it was written.
function hash(text) {
    var s = String(text == null ? '' : text);
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h.toString(16) + '-' + s.length;
}

//AN ID FROM THE NAME, so an entry is findable by a person reading the file and a
//reference to one is legible in whatever consumes it.
function idFor(name) {
    return String(name == null ? '' : name).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

//---- one of the three is not like the other two ---------------------------
//
//A JOB IS KEPT PER WORKSPACE; a prompt and a contract are kept per computer.
//That is not an oversight to tidy up. A job is a SCRIPT that runs against the
//folder of repositories that is open — "the jobs this workspace has" — while
//"read the README against the code and say where they disagree" names no
//repository at all.
//
//SO THE DOCUMENT IS AWAITED. `state.here.doc` is async and `state.app.doc` is
//not, and awaiting covers both.
//
//    what   the word this uses in its refusals: 'prompt', 'job', 'contract'
//    doc    () => the ../core/state document these are kept in, or a promise
//                 for one
//    opts   bodyOf(entry)         what the approval is against. A prompt's own
//                                 text; a job's CODE, which lives on disk
//           writes                the fields a save may set, beyond name/about
module.exports = function library(what, doc, opts) {
    var o = opts || {};
    var bodyOf = o.bodyOf || function (e) { return e.text; };
    var writes = o.writes || [];

    async function read() {
        var kept = (await doc()).read([]);
        return Array.isArray(kept) ? kept : [];
    }

    async function write(list) { (await doc()).write(list); return list; }

    //ANYTHING THE BODY NEEDS THAT HAS TO BE FETCHED, worked out ONCE per call
    //rather than per entry. A job's body is a file on disk under the workspace's
    //own folder, and finding that folder is a question for ../core/state.
    async function context() { return o.context ? await o.context() : null; }

    //EVERY ONE, WITH WHAT IT IS APPROVED AGAINST COMPARED TO WHAT IT SAYS NOW.
    //
    //`kind` IS FILLED AT READ TIME, so an entry written before there were two
    //libraries answers rather than answering undefined. Everything written
    //before there were two was written for work.
    async function all() {
        var ctx = await context();
        return (await read()).map(function (e) {
            var now = hash(bodyOf(e, ctx));
            return Object.assign({}, e, {
                kind: e.kind === 'judge' ? 'judge' : 'task',
                hash: now,
                approved: !!(e.approval && e.approval.hash === now),
                //LAPSED IS NOT UNAPPROVED. Somebody read this and said so, and
                //then it changed — which is a different thing from never having
                //been read, and asks for a different action.
                lapsed: !!(e.approval && e.approval.hash !== now),
                approvedAt: e.approval ? e.approval.at : null,
                approvedBy: e.approval ? e.approval.by : null,
                //ABSENT MEANS IN USE. Everything written before setting aside
                //existed carries no flag and must keep working, so the question
                //asked everywhere is "has it been set aside", never "has it been
                //marked usable".
                setAside: e.setAside === true
            });
        });
    }

    async function get(id) {
        return (await all()).filter(function (e) { return e.id === String(id); })[0] || null;
    }

    function mustFind(list, id) {
        var at = -1;
        for (var i = 0; i < list.length; i++) if (list[i].id === String(id)) at = i;
        if (at === -1) throw new Error('There is no ' + what + ' called "' + id + '".');
        return at;
    }

    //---- written, or rewritten ---------------------------------------------
    //
    //THE ID NEVER CHANGES ONCE MADE: something may be pointing at it, and a
    //rename that silently becomes a different entry is the quietest way to break
    //a reference.
    //
    //`by` DECIDES WHETHER SAVING APPROVES IT. Written at the window it is
    //approved by whoever wrote it — writing it there IS the reading. Written
    //down the pipe it waits for a person, because a model may write one and may
    //not ratify its own.
    async function save(input, by) {
        var it = input || {};
        var who = by || 'the window';
        var atWindow = who === 'the window';

        var title = String(it.name == null ? '' : it.name).trim();
        if (!title) {
            throw new Error('Give it a name. A ' + what + ' with no name is one nobody finds again.');
        }

        var list = await read();
        var ctx = await context();
        var key = it.id || idFor(title);
        if (!key) throw new Error('That name has no letters or numbers in it.');

        var at = -1;
        for (var i = 0; i < list.length; i++) if (list[i].id === key) at = i;
        var now = new Date().toISOString();

        //WHAT THIS ENTRY IS FOR: being given to a worker doing work, or to one
        //judging it. Two libraries in one store, so a judging chain cannot be
        //picked for work or the other way round with nothing but a name to tell
        //them apart. An existing entry keeps what it had.
        var kind = it.kind === undefined
            ? (at === -1 ? 'task' : (list[at].kind || 'task'))
            : (String(it.kind) === 'judge' ? 'judge' : 'task');

        var made = Object.assign({}, at === -1 ? {} : list[at], {
            id: key,
            name: title,
            about: String(it.about == null ? '' : it.about).trim() || null,
            kind: kind
        });

        //EVERY OTHER FIELD A SAVE MAY SET, AND LEFT ALONE WHEN NOTHING IS SENT.
        //A save that means "rename this" must not quietly unbind the rules, or
        //blank the text.
        writes.forEach(function (field) {
            if (it[field] === undefined) {
                if (at === -1) made[field] = o.blank && o.blank[field] !== undefined ? o.blank[field] : null;
                return;
            }
            var value = it[field];
            made[field] = typeof value === 'string' ? (value.trim() || null) : value;
        });

        var was = at === -1 ? null : list[at];
        var body = bodyOf(made, ctx);
        if (o.needsBody && !String(body == null ? '' : body).trim()) {
            throw new Error(o.needsBody);
        }

        //WHAT COUNTS AS A CHANGE. The body, and anything the caller says is part
        //of what was approved — the contract a prompt runs under is, because
        //changing which rules it is held to changes what somebody agreed to.
        var changed = !was || hash(bodyOf(was, ctx)) !== hash(body)
            || (o.approvedWith || []).some(function (f) { return (was[f] || null) !== (made[f] || null); });

        if (!was) {
            made.written = now;
            made.edited = null;
            made.approval = atWindow ? { at: now, by: who, hash: hash(body) } : null;
            list.push(made);
        } else {
            made.edited = changed ? now : was.edited;

            //A CHANGED SAVE IS RE-APPROVED ONLY IF A PERSON IS THE ONE SAVING.
            //An unchanged one keeps whatever approval it had — OR TAKES ONE, if
            //it had none and a person is saving.
            //
            //THAT LAST CLAUSE IS THE WHOLE OF A BUG THAT COST AN HOUR. The
            //dialog says, truthfully, "saving it here approves it: writing it at
            //the window IS the reading" — and this only stamped when something
            //had CHANGED. So a person opening an unapproved entry, reading it,
            //and pressing Save left it unapproved for ever, with the window
            //reporting "saved, and waiting to be read" exactly as designed. The
            //only way through was to edit it first, which nobody would guess and
            //which makes reading-then-approving impossible without altering what
            //you read.
            //
            //READING IT AND PRESSING SAVE IS THE APPROVAL. Nothing down the pipe
            //approves itself by saving twice, because `atWindow` is false there.
            made.approval = atWindow
                ? { at: now, by: who, hash: hash(body) }
                : (changed ? null : was.approval || null);

            list[at] = made;
        }

        //WRITTEN FIRST, so anything the body lives outside the record in — a
        //job's script — is already on disk when the record naming it is.
        if (o.onSave) await o.onSave(made, it, ctx);
        await write(list);
        return Object.assign({}, await get(key), { created: at === -1 });
    }

    //---- a person says they read it ----------------------------------------
    //
    //AGAINST THE BODY AS IT IS NOW, which is what makes the approval mean
    //something later: the next edit lapses it.
    async function approve(id, note) {
        var list = await read();
        var ctx = await context();
        var at = mustFind(list, id);
        list[at] = Object.assign({}, list[at], {
            approval: {
                at: new Date().toISOString(),
                by: 'the window',
                note: String(note == null ? '' : note).trim() || null,
                hash: hash(bodyOf(list[at], ctx))
            }
        });
        await write(list);
        return await get(id);
    }

    async function withdraw(id) {
        var list = await read();
        var at = mustFind(list, id);
        list[at] = Object.assign({}, list[at], { approval: null });
        await write(list);
        return await get(id);
    }

    //---- in play, or kept and out of the way -------------------------------
    //
    //A LIBRARY ONLY GROWS. Everything ever written stays, because what a worker
    //was held to six weeks ago has to remain readable — and the cost of that is
    //a list where the two that are current sit among six that are not. A
    //supervisor choosing from the whole of it is choosing from history.
    //
    //SO THIS IS NOT DELETING. `forget` deletes; this sets aside. The text, the
    //approval and the record are untouched, and the only thing that changes is
    //whether anything is offered it.
    //
    //BRINGING ONE BACK OVER THE WIRE COSTS ITS APPROVAL, AND THAT IS THE WHOLE
    //SAFETY OF IT. Setting aside is harmless from anywhere — it takes something
    //out of play. Putting it BACK is the direction that matters: without this,
    //anything that could set aside and restore could take an approved entry,
    //park it, and bring it back whenever it liked, which is the approval gate
    //with a door beside it. At the window it is a person doing it and the
    //approval stands; over the wire it waits to be read again, exactly like a
    //rewrite.
    async function use(id, on, how) {
        var by = (how && how.by) || 'the window';
        var list = await read();
        var at = mustFind(list, id);

        var wanted = on !== false && on !== 'false';
        var wasAside = list[at].setAside === true;
        var next = Object.assign({}, list[at], { setAside: wanted ? false : true });

        if (wanted && wasAside && by !== 'the window') next.approval = null;

        list[at] = next;
        await write(list);
        return await get(id);
    }

    async function forget(id) {
        var list = await read();
        var at = mustFind(list, id);
        var found = list[at];
        await write(list.filter(function (e) { return e.id !== found.id; }));
        //AND WHATEVER THE BODY LIVED IN. A record naming a script that is still
        //on disk is a script nothing points at.
        if (o.onForget) await o.onForget(found, await context());
        return { forgotten: found.id, name: found.name };
    }

    return {
        what: what,
        all: all, get: get, save: save, approve: approve,
        use: use, withdraw: withdraw, forget: forget,
        hash: hash, idFor: idFor,
        read: read, write: write
    };
};

module.exports.hash = hash;
module.exports.idFor = idFor;
