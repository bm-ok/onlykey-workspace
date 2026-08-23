var makeOnMachine = require('./onmachine');

//---------------------------------------------------------------------------
//THE JOIN BETWEEN THE TWO BOARDS AND THE MACHINES.
//
//A PLUGIN OF ITS OWN BECAUSE NEITHER BOARD OWNS THE QUESTION. ../../queue knows
//what tasks exist and ../../judge knows what judgements exist; "what is kit-1
//running" is answered by looking at both, and putting it in either would mean
//that one reaching into the other's store to answer a question about a third
//thing. See ./onmachine.js for why judgement is checked first.
//
//IT CONSUMES THE TWO AND NEITHER CONSUMES IT, which is what keeps the graph
//acyclic. The queue DOES need this answer — `vmDispatch` decorates a brief with
//it — but the queue reaches vmDispatch through the ACTION TABLE rather than
//through the graph, and that is exactly the difference the table exists for.
//
//---- who asks -------------------------------------------------------------
//
//    ../runs         a continuation says so, in the brief it hands over
//    ../../vms/https every endpoint a guest can reach: which session to
//                    continue, where an artifact is filed, and the refusal of a
//                    push from a machine that is judging
//
//NONE OF THEM ASKS THE GUEST. A machine says which machine it is by holding its
//own token; this host looks up what that machine was given. There is no argument
//to lie about, and that is what makes the guest-facing surface safe — not any
//check further in.
//---------------------------------------------------------------------------

plugin.consumes = ['queue', 'judge'];
plugin.provides = ['whatIsOn'];
async function plugin(imports, register) {
    var made = makeOnMachine({
        //READ AT ASK TIME, NOT HELD FROM HERE. A machine's work changes while
        //the app runs, and a list captured at wiring time would answer about the
        //board as it was at start-up — reporting a working machine as free.
        tasks: function () { return imports.queue.task.all(); },
        judgements: function () { return imports.judge.all(); },
        refOf: imports.judge.refOf
    });

    await register(null, {
        //A BARE FUNCTION RATHER THAN AN OBJECT WITH ONE METHOD ON IT. There is
        //one question here and there is not going to be a second: anything else
        //about a machine belongs to whichever board owns it.
        whatIsOn: made.whatIsOn
    });
}
module.exports = plugin;
