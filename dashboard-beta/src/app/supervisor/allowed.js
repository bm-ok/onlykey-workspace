//---------------------------------------------------------------------------
//WHAT A SUPERVISOR MAY ASK THIS HOST FOR, and nothing else exists for it.
//
//A supervisor is a machine running Claude Code whose job is to drive work
//through this app: write a task, queue it, watch what came back, and decide what
//to write next. It is a project manager rather than a worker — it does none of
//the work itself, and the machine it runs on is out of the task pool for good.
//
//NOT THE COMMAND LINE, WHICH WAS THE ORIGINAL PLAN. Handing a supervisor
//`okc.js` is the obvious way to let it drive, and it is a security fault rather
//than a shortcut: the CLI is the WHOLE action surface — it deletes machines,
//approves jobs, hands out credentials, opens and merges pull requests. A
//supervisor with a shell has all of it, and so does anything that talks its way
//into that shell. A model reading a repository is a model reading text somebody
//else wrote.
//
//AN ALLOWLIST, NOT A FILTER. Every action a supervisor may ask for is named
//here, one line each, with why it is on the list. The consequence is the point:
//adding an action to this app adds nothing to what a supervisor can do. A
//deny-list, or a rule like "anything that only reads", would quietly grant each
//new capability on the day it was written, and the person writing it would not
//be thinking about supervisors at all.
//
//IT STILL GOES THROUGH THE ACTIONS. What is named here is called through the
//same `call()` every other caller uses, so every refusal, every workspace gate
//and every record still applies. This decides WHETHER, never HOW.
//
//---- and it is the fence that counts --------------------------------------
//
//THERE ARE THREE, AND THE OTHER TWO ARE ON THE MACHINE: ../vms/provision/
//scripts/okc-mcp.js offers only these verbs as tools, and Claude Code is
//launched with every built-in denied. Both live where a supervisor could reach
//them. THIS ONE IS ON THE HOST, and it refuses anything off the list whatever
//asked — so the file on the machine being edited gains nothing.
//
//---- why it is here rather than in core -----------------------------------
//
//IT IS A POLICY ABOUT THIS APP'S OWN ACTIONS, which makes it app logic wearing
//no disguise. The app being ported from kept it in `core/`, where it was the
//only thing in core that knew every verb this particular app happens to have —
//and a scaffold lifted into another project would have carried it.
//
//---- what is deliberately absent, each a decision rather than an oversight --
//
//  approving anything     jobApprove, promptApprove, contractApprove. Approving
//                         is already refused over the wire, on purpose, and a
//                         supervisor is over the wire. It may PROPOSE a job, a
//                         prompt or a contract — see the saves below, which
//                         write one that waits — and it cannot approve its own.
//                         A person reads it in the window and says yes.
//  deleting anything      taskRemove, branchDelete, jobForget, prCutForget. A
//                         project manager that can throw work away is one bad
//                         turn from an empty board, and nothing here needs it.
//  machines               every vm*. It is a machine itself; giving it the power
//                         to start, snapshot or delete machines makes it the
//                         administrator of the thing it runs on.
//  credentials and keys   never. It does not need to see one to use one, and
//                         "a model may know something was done in the Keys tab
//                         without knowing what" is the rule this app is built to.
//  MERGING a change       prCutLand, and this is the line rather than an absence
//                         of one. A supervisor may push work onward and open the
//                         pull requests — that is the flow it exists to drive —
//                         and it may not merge them. Landing is the act that
//                         changes what everybody else builds on, and it is the
//                         one place a person reads the change and says yes.
//                         Everything before it is reversible from GitHub; this
//                         is not.
//  editing or closing     prCutUpdate can close every pull request in a cut, and
//  a pull request         prCutForget stops tracking one here. Neither is needed
//                         to send work out, and both undo somebody's reading of
//                         it. Off until there is a reason. What it may do
//                         instead is write what the pull requests will SAY
//                         before they exist — see prDraftSave.
//  deleting a branch      branchDelete, branchDeleteRemote. Tidying up after a
//                         merge is part of landing, which is not a supervisor's.
//  judging                taskJudge. A verdict decides whether work was any
//                         good, and a supervisor judging its own delivery is a
//                         worker marking its own homework.
//---------------------------------------------------------------------------

//THE LIST, AND THE REASON EACH ONE IS ON IT. The reason is not decoration: it is
//shown to the supervisor when it asks what it may do, so it can choose without
//guessing, and it is what somebody adding a line here has to be able to write.
var MAY = {
  // ---- talking to the person, which is the only way it is heard -------------
  //
  // A supervisor decides things, and a decision nobody was told about is a
  // machine going quietly ahead. These two are how it is answerable: what was
  // said to it, and what it says back.
  //
  // `whatsNew` is deliberately one call rather than four. A supervisor wakes,
  // reads, decides and stops — everything it needs on waking is "what changed
  // since last time", across the conversation, the board and this host's own
  // record. One bookmark, handed back each time, instead of a model keeping four
  // of them correctly across a restart.
  whatsNew: 'everything that changed since a bookmark: what was said to you, what finished, what is waiting',
  supervisorSays: 'say something to the person — it appears on the Chat tab, signed with this machine',

  // ---- what it may see -----------------------------------------------------
  tasks: 'the board: every task, and whether its branch has anything on it yet',
  taskProgress: 'every attempt at one task, and what its worker is doing now',
  taskLog: "one attempt's output, so it can read why a run did what it did",
  branchBoard: 'every branch, who claims it, and what is on it',
  lines: 'the named lines, which are what a branch is cut from',
  jobs: 'the jobs it may write a task under — a job is a script a person approved',
  job: 'one job with its script in full, so it can read what it is proposing to change',
  prompts: 'the prompt library, which is what a worker can be told',
  contracts: 'the contract library, which is the rules a worker is held to',
  contract: 'one contract with its rules in full',
  prCuts: 'every change that has been sent out, and how far each has got',
  prCutState: 'what became of one change once it was sent, read from GitHub rather than remembered',
  judgements: 'what has been judged about a change, and whether it still describes what is there',
  // ---- WHAT IT MAY NOT SEE: THE CODE ITSELF --------------------------------
  //
  // Five entries were here and are deliberately gone: taskArtifact, taskDiff,
  // changeRead, branchArtifact and repoOverview. Each handed a supervisor the
  // contents of the repositories — a diff, the files a task delivered, what one
  // line carries that another does not.
  //
  // A SUPERVISOR DOES NOT KNOW WHAT IS IN THE CODEBASE, and that is the design
  // rather than a restriction bolted on. It decides what to do next on a line
  // from what a JUDGE says about it: run a judge, read what the judge handed
  // back, decide whether to write a task, run a judge again to see whether the
  // task was done correctly. Judging is the only sense it has.
  //
  // WHY THAT IS BETTER THAN LETTING IT READ. A supervisor that reads the code
  // forms its own opinion of it, and then its decisions rest on an unrecorded
  // reading nobody approved, made by the thing whose work is being checked. A
  // judge's reading is a job, a prompt and a contract a person approved, run on
  // a machine, with what it found kept as files. The first is a hunch; the
  // second is evidence with a name on it.
  //
  // So the window onto the code is judgementFindings, and if a judge says
  // nothing then nothing is known — which is the right outcome rather than a
  // gap to route around.
  judging: 'every judgement: what is waiting to be read, what is being read, and what was decided',
  judgementFindings: 'what a judgement handed back, and one of those files in full — the only way it learns anything about the code',
  // AND WHY THERE IS NOTHING TO READ, when there is nothing. A judgement that
  // failed hands nothing back, and `judgementFindings` can only say so -- it
  // cannot say why. This is the transcript of the run, which is where the reason
  // is, and it exists because a supervisor went looking for one and had nowhere
  // to look: it asked `taskLog` three times and was refused three times, because
  // a judgement is not a task.
  judgementLog: "the output of a judgement's run, kept on this host — the only thing that says WHY one came back empty",
  // WHAT KINDS OF MACHINE THERE ARE, which is what a task's tag names. Without
  // this it could put a tag on a task and had no way to know which tags exist —
  // and the queue WAITS for a tagged machine rather than falling back, so a
  // guessed tag is work that sits queued for ever. It is the small question:
  // kinds, counts and how many are free. Not vmList, which carries addresses,
  // snapshots and which machines hold a credential.
  pools: 'the kinds of machine there are, how many of each, and how many are free to take work',
  // WORK THAT TURNED UP, which is the one thing here that does not start with
  // somebody writing a task. A supervisor deciding what to do next is mostly
  // reading this. Paged on purpose: a busy tracker has thousands, and a hundred
  // of five thousand is not a short list, it is a wrong one.
  issues: "a repository's issues, a page at a time — this workspace's, or any repository named owner/name",
  pulls: "a repository's pull requests, a page at a time — everything open there, not only what this host cut",
  repositories: 'the repositories this workspace holds, and where each points',
  repoBranches: "one repository's branches: where each is here, where origin has it, and which are out of step",

  // ---- what it may do ------------------------------------------------------
  //
  // Four verbs, and they are one flow: cut a branch, write a task on it, queue
  // it, and take it back out if it was wrong. Everything else a supervisor wants
  // to do is one of these repeated.
  branchCreate: 'cut a branch across the repositories, which is where a task delivers',
  taskCreate: 'write a task on a branch that has been cut, under a job and contract a person approved — or pass '
    + 'the task `cutFrom` (a line) and `reason` to cut that branch in the same act, which is the same door the '
    + 'person at the window presses on Add task',
  taskQueue: 'put a task in the queue, so the next free machine takes it',
  taskUnqueue: 'take a task back out of the queue, for one that should not have gone in',

  // ---- AND THE LOOP THIS IS ALL FOR ---------------------------------------
  //
  // Run a judge on a line. Read what it handed back. Decide whether the line
  // needs a change, and if it does, write a task on it. Run a judge again to
  // find out whether the task was done correctly. Repeat.
  //
  // The supervisor never reads the code at any point in that loop — see the
  // note above the judging entries. What it may not do is REACH a verdict:
  // judgementVerdict is absent, because a supervisor recording its own verdict
  // on work it commissioned is the thing this whole arrangement exists to
  // prevent. It asks; a judge answers; a person decides what that is worth.
  judgementCreate: 'ask for a judgement of a branch cut or a PR cut, under a judging chain a person approved',
  judgementQueue: 'put a judgement in the queue — it goes ahead of tasks, because it reads work already waiting',
  judgementUnqueue: 'take a judgement back out of the queue',

  // ---- AND WHAT IT IS IN THE MIDDLE OF ------------------------------------
  //
  // A supervisor is woken, reads, decides and stops, carrying one bookmark
  // across. That is enough while a decision finishes inside one waking, and this
  // flow does not: an issue becomes a judgement, becomes a line, becomes a task,
  // becomes another judgement. Six wakings before anything lands.
  //
  // Without somewhere to put it, every waking re-derives where it had got to by
  // reading the board and guessing, and a guess about "did I already ask for
  // that" is how one judgement gets queued twice.
  //
  // THE NOTEBOOK HOLDS THE INTENT; THE STORES HOLD THE TRUTH. "triage" resolves
  // each entry against the records and says which of the things it was waiting
  // on have finished, so "still running" and "the answer is sitting there" stop
  // looking identical from its own notes.
  triage: 'what you are in the middle of, and which of those things finished while you were away',
  triageSet: 'write down what you are waiting on and why, so the next waking knows what you already asked for',
  triageForget: 'stop carrying something. Nothing about the task or judgement itself is touched',

  // ---- and what there is to DO, which is neither of the above ---------------
  //
  // Triage says where something that already exists has got to. This is for the
  // things that exist nowhere else: a decision taken at three in the morning
  // that cannot be acted on until somebody is awake, a doubt worth raising
  // before recommending anything, a check that needs a person's eyes. Without
  // somewhere to put those, they go in the conversation and are gone the moment
  // the conversation is long.
  //
  // ADD, CHANGE AND FINISH, AND NOT DELETE. `todoRemove` is deliberately absent
  // from this list and refuses over the wire besides. "Done" and "gone" are
  // different claims: done is kept and shown, gone leaves no trace anything was
  // ever there — and a list the worker can empty is a list nobody can use to
  // check up on the worker, which is most of why a person opens that tab.
  todos: 'the list of things to do: what is open, what is being done, what is finished',
  todoAdd: 'put something on that list — a line saying what is to be done, and why if the line is not enough on its own',
  todoSet: 'change something on the list, or move it between open, doing and done. Finishing one is how you take it off — you may not delete',

  // ---- and what it may PROPOSE ---------------------------------------------
  //
  // A supervisor that can only write tasks under definitions somebody else wrote
  // is a project manager who may not suggest anything. It can write a job, a
  // prompt or a contract — and what it writes WAITS.
  //
  // That is not a rule added here. A definition written over the wire is
  // unapproved by construction, and approving is refused over the wire outright:
  // "a model may write one and may not approve its own". This route makes sure a
  // supervisor is over the wire whatever it says about itself — see server.js —
  // because it calls in process exactly as the window does, and without that a
  // supervisor writing a job would have produced an approved one.
  //
  // So the shape is: it proposes, a person reads it in the window and says yes,
  // and only then can a task be written under it. The asking is the feature; the
  // approving is deliberately somebody else's.
  jobSave: 'propose a job, or a change to one. What it writes is unapproved and cannot run until a person reads it',
  promptSave: 'propose a prompt, or a change to one. It waits for a person the same way',
  contractSave: 'propose a contract, or a change to one. It waits for a person the same way',

  // ---- AND ITS OWN INSTRUCTIONS, WHICH IS THE ONE IT WAS LOCKED OUT OF -----
  //
  // A system meant to get better at this over time cannot be shut out of the one
  // document that says what it is. It had no skill action at all: it could not
  // read its own instructions as a tool, and could not say what it thought was
  // wrong with them.
  //
  // THE SAME SHAPE AS THE THREE ABOVE, and for the same reason. It proposes; a
  // person approves. `skillPropose` writes somewhere nothing serves — see
  // ./server.js, where a proposal is deliberately kept out of the provisioning
  // folder, because a proposal a machine could fetch is a supervisor rewriting
  // its own instructions with one extra step.
  //
  // NO `skills` EITHER, WHICH WAS ALREADY DECIDED. The plain read is off this
  // list deliberately — see test/tabs/supervisor-skills.test.js, which asserts
  // it — and nothing is lost by that: the document is fetched onto the machine
  // at the head of every waking, so it is already in front of it. What it did
  // not have was a way to say what it thought was wrong with it.
  //
  // NO `skillApprove` AND NO `skillSave` HERE, and that is the whole line.
  skillPropose: 'propose a change to a skill, saying why. Nothing is served from it until a person approves it',

  // AND THE TWO READS THAT MAKE PROPOSING WORTH ANYTHING.
  //
  // IT COULD ASK AND NOT FIND OUT. An answered proposal disappears — approving
  // keeps a version and drops it, refusing drops it and says why — so the drawer
  // is empty afterwards either way, and an empty drawer reads exactly like never
  // having asked. Something that cannot tell "still waiting" from "turned down"
  // either asks again into silence or stops asking.
  //
  // NEITHER HANDS BACK A DOCUMENT, which is why they are here and `skills` is
  // not. `skillAsked` says whether something is waiting and how the last few
  // were answered; `skillHistory` says when this changed and by how much. The
  // skill itself is already in front of it — the CLI loads it at the head of
  // every waking — so a verb that hands it over again widens what a model can
  // reach and buys nothing.
  skillAsked: 'whether a change you proposed is still waiting, and how the last few were answered',
  skillHistory: 'what a skill has been: when it changed, by how much, and the argument made for each change',

  // ---- and what it may send onward -----------------------------------------
  //
  // THE FAR END OF THE SAME FLOW, and the reason a supervisor exists: work that
  // never leaves is work nobody can read. It pushes, it opens the pull requests,
  // and it stops there. Merging is the act that changes what everybody else
  // builds on, and it is where a person reads the change and says yes.
  //
  // Pulling is on this list for the same reason pushing is: a fork that has
  // fallen behind its parent makes a pull request full of somebody else's
  // commits, and the fix is a button anybody could press. Fetching and
  // fast-forwarding changes nothing that was not already decided elsewhere.
  // A PULL REQUEST IS NEVER TOUCHED ON ITS OWN. Everything a supervisor may do
  // to one is a PR CUT: one act, one pull request per repository, tracked
  // together. That is how this app manages pull requests at all — there is no
  // action here that opens or edits a single one — and it is the rule for a
  // supervisor rather than an accident of the surface: a change that lands in two
  // repositories out of three is the failure this whole idea exists to prevent,
  // and something driving the flow unattended is exactly what would produce it.
  //
  // So: it may write what the pull requests will SAY before there are any
  // (prDraftSave changes nothing on GitHub), and it may cut them (prCutMake).
  // After that they belong to whoever reads them.
  prDraft: 'what has been written for a pair of lines and not cut yet',
  // AND ALL OF THEM, WITHOUT KNOWING THE PAIR FIRST. `prDraft` answers about a
  // pair somebody already has in mind, which is no use to a supervisor asking
  // "what have I left unfinished" -- the question it should be asking every time
  // it wakes. Reading its own drafts is as harmless as writing them: nothing here
  // has been near GitHub.
  prDrafts: 'everything written for a pair of lines and not cut yet — its own unfinished work, none of it on GitHub',
  prDraftSave: 'write what the pull requests will say, before there are any — this changes nothing on GitHub',
  prTemplatePreview: 'what the pull requests would say for a pair of lines, composed from the blocks that are on',
  repoSync: 'fetch from origin and fast-forward every default branch, so it is not deciding from a stale copy',
  repoSyncBranch: 'fetch and fast-forward one branch, or every branch in one repository',
  lineSync: 'fetch and fast-forward every branch a line names, as one act',
  repoForkSync: "pull each fork's default branch up from its parent on GitHub, so a change is cut from what is current",
  branchAsLine: 'make a line out of a branch, which is what a change has to be before it can be compared or sent',
  prCutMake: 'push a line onward and open a pull request per repository, tracked together as one change — it may SEND work out, and may not land it',
  prComment: 'say what a judge found on a pull request, ending in whether it is recommended for pulling — it may REPORT, and may not merge',};

//---- asking whether -------------------------------------------------------
//
//`hasOwnProperty` RATHER THAN `MAY[what]`. A supervisor asking for
//"constructor" or "toString" would otherwise be answered by something on
//Object's prototype, and a lookup that says yes to a word nobody put on the list
//is the whole of this file failing.
function may(what) {
    return Object.prototype.hasOwnProperty.call(MAY, String(what == null ? '' : what));
}

//THE REFUSAL SAYS WHAT IT MAY DO INSTEAD, because the thing reading it is a
//model that will otherwise try the same call again with a different spelling. It
//does not say why the action was left off — that is in the comment above, for
//people — and it never hints at what else this host can do.
function refuse(what) {
    return 'A supervisor may not ask for "' + what + '". What it may ask for: '
        + Object.keys(MAY).join(', ') + '. '
        + 'Everything else on this host does not exist for a supervisor — it is a named list rather than '
        + 'a filter, so nothing is unlocked by an action being added elsewhere.';
}

//WHAT THE SUPERVISOR IS TOLD WHEN IT ASKS WHAT IT MAY DO. Sorted, so the answer
//is stable and a model comparing two answers sees a real difference.
function list() {
    return Object.keys(MAY).sort().map(function (name) {
        return { what: name, why: MAY[name] };
    });
}

//---- AND HOW MANY TIMES IT HAS ASKED FOR ANYTHING --------------------------
//
//WHAT THIS ANSWERS IS "DID THAT WAKING DO ANYTHING AT ALL". A turn that ends
//normally having asked this host for nothing did nothing, whatever it printed —
//and the commonest cause is a machine that cannot run a model at all: no
//credential, a launcher that is gone, a machine that came up wrong. Every one of
//those ends in seconds and leaves every panel looking exactly as it did before.
//
//That failure has happened here: a wake fired, the model exited in three seconds
//for want of a credential, and the person watching the Chat tab saw their
//message sit unread with nothing anywhere saying why. The host knew — it had
//logged a three-second turn and not one request — and nothing was reading it.
//
//A COUNT RATHER THAN A FLAG, so it works across overlapping turns and needs no
//resetting: the caller takes a reading before and after, and compares.
//
//COUNTED AT THE DOOR AND NOT AT THE FENCE. It goes up for anything that got as
//far as being CALLED — a refusal is the fence working, and a supervisor spending
//a whole turn being refused is very much a turn that did something.
var asked = 0;
function noteAsked() { asked += 1; }
function asksSoFar() { return asked; }

module.exports = {
    MAY: MAY, may: may, refuse: refuse, list: list,
    noteAsked: noteAsked, asksSoFar: asksSoFar
};
