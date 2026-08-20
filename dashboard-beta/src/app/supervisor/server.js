var makeTodos = require('./todos');

//---------------------------------------------------------------------------
//THE LIST OF THINGS TO DO, as actions.
//
//Written for two callers who are not the same and must not be given the same
//door. See the head of ./todos.js for what this list is and, more usefully, what
//it is NOT — it is neither the task board nor the triage notebook.
//
//A SUPERVISOR MAY WRITE TO IT. That is the point of it existing: a decision taken
//at 3am that cannot be acted on until somebody is awake has nowhere else to go,
//and a note in the conversation is lost the moment the conversation is long. So
//it may add, change and finish.
//
//A SUPERVISOR MAY NOT DELETE. "Done" and "gone" are different claims: done is
//kept and shown, gone leaves no trace that anything was ever there. A list the
//worker can empty is a list nobody can use to check up on the worker, and that is
//the whole reason a person looks at this tab. Deleting is a person's, in the
//window, like every other irreversible thing here.
//
//THE REFUSAL SURVIVED THE MOVE UNCHANGED, WHICH WAS THE POINT OF MOVING THIS ONE
//SECOND. Over there it turns on `_overTheWire || _driven`; here it is
//`_overTheWire` alone, and that is not a weakening. `_driven` covered the window
//being worked from outside, and ../core/drive refuses to press a guarded button
//at all — the refusal moved earlier rather than being dropped. So the Remove
//button on the pane is `protected`, and both halves of the rule are real.
//---------------------------------------------------------------------------

plugin.consumes = ['app', 'log', 'state'];
plugin.provides = [];
async function plugin(imports, register) {
    var host = imports.app.host;
    var actions = host && host.actions;
    var log = imports.log.on('todo');

    //`actions` is absent when this half is built against a bare host — the test
    //suite does exactly that. See ../core/okc/server.js.
    if (!actions) return register(null, {});

    //IN THE HOST'S DRAWER, NOT THE WORKSPACE'S. What somebody is carrying spans
    //whatever folder they happened to be looking at — the same reasoning the app
    //being ported from gives for keeping this beside the triage notebook rather
    //than per workspace. ../core/state has both; this one is `app`.
    var todos = makeTodos(imports.state.app.doc('todo'));

    //ONE SHAPE FOR EVERY ANSWER THAT RETURNS THE LIST, so the window and a model
    //are reading the same thing.
    function board() {
        var all = todos.all();
        function counted(s) { return all.filter(function (t) { return t.state === s; }).length; }
        return { todos: all, open: counted('open'), doing: counted('doing'), done: counted('done') };
    }

    var undo = [];

    undo.push(actions.define('todos', {
        about: 'The list of things to do: what is open, what is being done, and what is finished',
        run: function () {
            var now = board();
            return Object.assign({}, now, {
                states: todos.STATES,
                note: now.todos.length
                    ? null
                    : 'Nothing on the list. todoAdd puts something on it — a line saying what is to be done, and why if the line is not enough on its own.'
            });
        }
    }));

    undo.push(actions.define('todoAdd', {
        about: 'Put something on the list: what is to be done, and why',
        takes: ['what', 'why', 'state'],
        run: function (args) {
            var a = args || {};
            var by = actions.whoAsked(a);
            var one = todos.add(a.what, a.why == null ? null : a.why, a.state || 'open', by);
            log.good(one.ref + ' "' + one.what + '" — added by ' + by);
            return Object.assign({}, one, board(), { note: one.ref + ' is on the list.' });
        }
    }));

    undo.push(actions.define('todoSet', {
        about: 'Change something on the list: its wording, its reason, or what state it is in',
        takes: ['id', 'what', 'why', 'state'],
        run: function (args) {
            var a = args || {};
            var was = todos.get(a.id);
            if (!was) throw new Error('There is no todo "' + a.id + '". Ask for the list to see what there is.');

            var by = actions.whoAsked(a);
            var one = todos.edit(a.id, { what: a.what, why: a.why, state: a.state, by: by });

            //SAID ONLY WHEN IT MOVED. Rewording something is not an event worth a
            //line in the record; finishing it is, and so is picking it up.
            if (was.state !== one.state) log.good(one.ref + ' "' + one.what + '" — ' + was.state + ' to ' + one.state + ', by ' + by);
            return Object.assign({}, one, board(), { was: was.state, note: one.ref + ' is ' + one.state + '.' });
        }
    }));

    undo.push(actions.define('todoRemove', {
        about: 'Take something off the list for good. A person, in the window — a supervisor marks things done instead',
        takes: ['id'],
        run: function (args) {
            var a = args || {};

            //THE REFUSAL THAT MAKES THE LIST WORTH READING.
            //
            //Everything else here is open to both ends deliberately. This one is
            //not, because a list that the thing doing the work can empty says
            //nothing about what the work was — and "it is no longer on the list"
            //would stop meaning "it was dealt with".
            if (a._overTheWire) {
                throw new Error(
                    'Taking something off the list for good is done in the window, by a person. '
                    + 'Mark it done instead — done is kept and shown; removed leaves no trace that it was ever there.'
                );
            }

            var one = todos.remove(a.id);
            log.warn(one.ref + ' "' + one.what + '" removed');
            return Object.assign({}, one, board(), { note: one.ref + ' is gone. It was ' + one.state + '.' });
        }
    }));

    await register(null, {
        onDestroy: function () { while (undo.length) undo.pop()(); }
    });
}
module.exports = plugin;
