//---------------------------------------------------------------------------
//WHAT A MACHINE IS RUNNING, OF EITHER KIND, ANSWERED IN ONE PLACE.
//
//EVERY ENDPOINT A GUEST CAN REACH ASKS THIS QUESTION, AND NONE OF THEM ASKS THE
//GUEST. A machine says which machine it is by holding its own token, and this
//host looks up what that machine was given. There is no argument to lie about,
//and that is what makes the whole guest-facing surface safe rather than any
//check further in.
//
//In the app being ported from it was written out four times as
//`tasks.read().find(t => t.machine === name && t.state === 'given')`, which was
//right while a task was the only thing a machine could run. A judgement is the
//second, and four copies of a lookup is four places to remember when there is a
//third.
//
//---- judgement first, and that order is deliberate ------------------------
//
//A MACHINE RUNS ONE THING AT A TIME, so the two can only both answer if
//something has already gone wrong. Of the two possible wrong answers, "this is a
//judgement" is the one that refuses a push and files nothing against the work.
//When the record is confused, the safe reading wins.
//
//---- one shape for both ----------------------------------------------------
//
//So a caller can do its job without knowing which it got: what to call it, what
//to file things under, and the record itself for the callers that do care.
//
//THE `uid` IS WHAT A SESSION AND AN ARTIFACT ARE FILED UNDER. Never the number,
//which is only unique within a kind — a judgement and a task can both be 4, and
//filing them together would hand one's transcript to the other.
//---------------------------------------------------------------------------

module.exports = function onmachine(deps) {
    var d = deps || {};

    var tasks = d.tasks;            //() -> [task]
    var judgements = d.judgements;  //() -> [judgement]
    var refOf = d.refOf;            //(number) -> string

    function given(rows, machine) {
        return (rows || []).filter(function (x) {
            return x && x.machine === machine && x.state === 'given';
        })[0] || null;
    }

    //ASYNC, AND IT WAS NOT — WHICH MEANT IT HAD NEVER ANSWERED ANYTHING.
    //
    //Both readers are async: ../../queue's `task.all` and ../../judge's `all`
    //each read a document off disk. This called them and handed the PROMISE
    //straight to `given`, so every call threw `(rows || []).filter is not a
    //function` — every call, from the first one this app ever made.
    //
    //IT HID BECAUSE OF WHERE IT IS ASKED. ../runs wraps it in a try that says "a
    //brief that could not be annotated is still the brief", so the throw was
    //caught and the work carried on with a slightly poorer prompt. ../sessions
    //asks it to decide whether a machine is running anything at all, and a
    //machine that is running nothing is an ordinary answer there — 204, or a
    //409 saying a transcript has nothing to belong to. Nothing anywhere read
    //like a fault.
    //
    //WHAT IT COST is the rule in ../../repositories/gitserve: a judgement may
    //not push to the thing it was asked to READ. That check asks this, and this
    //could only ever throw, so the check has never once fired.
    async function whatIsOn(name) {
        var machine = String(name || '');
        if (!machine) return null;

        var judgement = given(await judgements(), machine);
        if (judgement) {
            return {
                kind: 'judgement',
                ref: refOf(judgement.number),
                uid: judgement.uid,
                id: judgement.id,
                number: judgement.number,
                //WHAT IT IS READING, WHICH IS NOT A BRANCH IT MAY WRITE TO. The
                //git route refuses a push from a judging machine, and this is
                //the field it refuses by.
                reads: judgement.subject && judgement.subject.name,
                title: judgement.title,
                item: judgement
            };
        }

        var task = given(await tasks(), machine);
        if (task) {
            return {
                kind: 'task',
                ref: '#' + task.number,
                uid: task.uid,
                id: task.id,
                number: task.number,
                title: task.title,
                item: task
            };
        }

        return null;
    }

    return { whatIsOn: whatIsOn };
};
