//---------------------------------------------------------------------------
//WHAT IS KEPT ABOUT A PIECE OF WORK OF MY OWN.
//
//A DOCUMENT IN THE WORKSPACE'S DRAWER, not on the host. A cut only means
//something inside one workspace — two workspaces with a `main` are two different
//branches — and these are named after cuts, so they follow the folder. Same
//reasoning as ../runners/sessions, which keys what it keeps by branch cut for
//the same reason.
//
//WHAT IS KEPT AND WHAT IS ASKED FOR EVERY TIME. Kept: the title, the notes, the
//cut, which machine was taken for it, and whether I have called it done. NOT
//kept: whether that machine is running, whether it is holding a sign-in, what
//has been pushed. Those are facts about the world that go stale the moment they
//are written down, and a pane reading a remembered "running" beside a machine
//that is off is worse than a pane that says nothing.
//
//THE RULES ARE HERE AND NOT IN THE PANE. The picker not offering a taken cut is
//a courtesy; this is the refusal. A window is one of the ways in — see
//../../CLAUDE.md on a rule the window enforces alone being a rule the command
//line does not have.
//---------------------------------------------------------------------------

//---- THE ONE-PER-CUT RULE, AND WHY IT IS NOT A PREFERENCE ------------------
//
//A cut is laid down on a machine as a WHOLE WORKSPACE: every repository checked
//out on that branch, with origin pointing back at this host. Two pieces of work
//sharing one would be two sets of commits arriving on one branch with nothing
//saying which was whose — and either of them could give its machine back, which
//rolls the machine to its base snapshot and takes the other's uncommitted work
//with it.
//
//So it is not "one is tidier". It is that the second one can destroy the first
//one's work and neither would be doing anything wrong.
function taken(items, branch, exceptId) {
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.id === exceptId) continue;
        if (it.cut && it.cut === branch) return it;
    }
    return null;
}

function clean(s) { return String(s == null ? '' : s).trim(); }

module.exports = function makeStore(doc) {
    //ASKED FOR ON EVERY CALL, NOT HELD. `state.here.doc` resolves which
    //workspace is open each time it is asked, which is what makes switching
    //folders automatic — holding the document would pin this to whichever one
    //happened to be open when the plugin came up.
    async function read() {
        var box = await doc();
        var kept = box.read({ items: [], next: 1 }) || {};
        return {
            box: box,
            items: Array.isArray(kept.items) ? kept.items : [],
            next: Number(kept.next) > 0 ? Number(kept.next) : 1
        };
    }

    async function write(now, items, next) {
        now.box.write({ items: items, next: next == null ? now.next : next });
        return items;
    }

    async function all() { return (await read()).items; }

    async function get(id) {
        var found = (await read()).items.filter(function (x) { return x.id === id; })[0];
        return found || null;
    }

    //---- STARTING ONE ------------------------------------------------------
    //
    //A COUNTER RATHER THAN A CLOCK. Two started in the same millisecond would
    //share an id, and what that breaks is not the second one — it is every
    //later edit, which would change both.
    async function start(input) {
        var a = input || {};
        var now = await read();

        var title = clean(a.title);
        if (!title) throw new Error('Give it a title — it is what the list shows.');

        var cut = clean(a.cut) || null;
        if (cut) {
            var held = taken(now.items, cut, null);
            if (held) {
                throw new Error('"' + cut + '" already belongs to "' + held.title + '". One piece of work per cut: '
                    + 'two on one branch is two sets of commits with nothing saying which is whose, and giving '
                    + 'either machine back would roll away the other\'s work.');
            }
        }

        var it = {
            id: 'diy-' + now.next,
            title: title,
            notes: clean(a.notes),
            cut: cut,
            machine: null,
            state: 'open',
            madeAt: new Date().toISOString(),
            changedAt: null
        };

        await write(now, [it].concat(now.items), now.next + 1);
        return it;
    }

    //---- CHANGING ONE ------------------------------------------------------
    //
    //THE TITLE AND THE NOTES ARE MINE TO REWRITE. The cut is not, once it is
    //set: work is already pushed to it, and changing this field would not MOVE
    //anything — it would point the record somewhere else and leave what was
    //pushed with nothing naming it.
    //
    //SETTING ONE THAT WAS NEVER PICKED IS NOT CHANGING IT. Something written
    //down before there was anywhere to push it is the ordinary way round, so
    //that case is allowed and goes through the same one-per-cut refusal.
    //
    //UNDEFINED MEANS "LEAVE IT". A caller sending only a title must not blank
    //the notes, which is what `a.notes || ''` would do and is the shape this
    //kind of function usually fails in.
    async function change(id, input) {
        var a = input || {};
        var now = await read();
        var it = now.items.filter(function (x) { return x.id === id; })[0];
        if (!it) throw new Error('There is no piece of work called "' + id + '".');

        var next = Object.assign({}, it);

        if (a.title !== undefined) {
            var title = clean(a.title);
            if (!title) throw new Error('Give it a title — it is what the list shows.');
            next.title = title;
        }

        if (a.notes !== undefined) next.notes = clean(a.notes);

        if (a.cut !== undefined) {
            var want = clean(a.cut) || null;
            if (it.cut && want !== it.cut) {
                throw new Error('The cut cannot be changed once it is set. "' + it.title + '" is on "' + it.cut
                    + '" and work is pushed there; pointing it somewhere else would leave that behind with nothing '
                    + 'naming it. Start another piece of work for another branch.');
            }
            if (!it.cut && want) {
                var held = taken(now.items, want, id);
                if (held) {
                    throw new Error('"' + want + '" already belongs to "' + held.title + '". One piece of work per cut.');
                }
                next.cut = want;
            }
        }

        if (a.state !== undefined) {
            var state = clean(a.state);
            if (state !== 'open' && state !== 'done') {
                throw new Error('A piece of work is "open" or "done", not "' + state + '".');
            }
            next.state = state;
        }

        //`null` TAKES THE MACHINE OFF, which is a different act from not
        //mentioning it — giving one back has to be able to say so.
        if (a.machine !== undefined) next.machine = clean(a.machine) || null;

        next.changedAt = new Date().toISOString();

        await write(now, now.items.map(function (x) { return x.id === id ? next : x; }));
        return next;
    }

    async function forget(id) {
        var now = await read();
        var it = now.items.filter(function (x) { return x.id === id; })[0];
        if (!it) return false;
        await write(now, now.items.filter(function (x) { return x.id !== id; }));
        return true;
    }

    //WHICH CUTS ARE SPOKEN FOR, so a caller offering a choice can leave them
    //out — the same answer the refusal above is made from, rather than a second
    //reading of the same list that could disagree with it.
    async function cutsTaken() {
        var out = {};
        (await read()).items.forEach(function (it) {
            if (it.cut) out[it.cut] = { id: it.id, title: it.title };
        });
        return out;
    }

    return { all: all, get: get, start: start, change: change, forget: forget, cutsTaken: cutsTaken };
};
