var React = require('react');
//WHO THE QUEUE LEAVES ALONE, ASKED OF THE ONE PLACE THAT DECIDES.
//
//`policy` IS PURE -- lists in, lists out, no store and no host -- so requiring
//the file is a lookup, the same way ../../runners/machines requires it. What
//must not happen is a SECOND answer to "does the queue manage that machine",
//which is exactly what the hand-rolled tag test below had become.
var policy = require('../../queue/policy');

//---------------------------------------------------------------------------
//trouble: the shared list, and the only thing in the window that cannot be
//missed.
//
//A LIST, WHICH IS WHY THE OTHER TWO ARE NOT IN IT. Anything worth saying joins
//this; that is exactly why testing mode and a running drill have elements of
//their own, where nothing can take their place.
//
//IT LEAVES THE MOMENT IT IS FIXED, so it cannot become wallpaper. Nothing here
//is dismissible and nothing here is remembered: every line is computed from what
//is true right now, and the way to make one go away is to deal with it.
//
//A THIRD ELEMENT, OPTIONAL: WHERE TO GO ABOUT IT. Every line describes something
//somebody has to do something about, and a line that does not say where leaves
//them to read the sentence, agree with it, and then go hunting.
//
//BUILT AS ONE LIST RATHER THAN AS CONDITIONALS, which is carried over and is
//load-bearing. The version before it wrote the machines in and then, if
//VirtualBox was missing, REPLACED them — so the more serious problem hid the
//other one instead of joining it.
//
//AND A LINE THAT CAN BE ACTED ON CARRIES THE ACT. A warning that describes a fix
//and cannot perform it is one that gets read and postponed. Both of the acts here
//move a credential, so both go through the gate and both are `protect`ed: this
//banner is on every tab, and a press that moves a sign-in is a person's.
//
//THE ACT IS A LINK RATHER THAN A BUTTON, which is a look and not a weakening.
//Every line here is a sentence and the repair is the end of it; a button planted
//there reads as chrome the sentence is wrapped around. The guard is identical —
//same purple, same `protected` class, and the driver refuses it the same way.
//---------------------------------------------------------------------------

module.exports = function trouble(theme, okc, shell) {
    var { Banner, Linky, ask } = theme;

    return function Trouble() {
        //FIVE QUESTIONS, ASKED FROM SOMETHING THAT IS ALWAYS MOUNTED. The old
        //window asked all five on its draw loop three seconds apart, for this
        //same banner; ten is slower than that, and none of these answers is the
        //kind that changes in between.
        var q = okc.use('waiting', {}, 10000);
        var st = okc.use('status', {}, 10000);
        //`vmList` CANNOT BE ALLOWED TO TAKE THE REST DOWN, because a broken
        //VirtualBox is not a broken window. Over there this was the one call
        //without a catch and it did exactly that: every panel emptied, including
        //the two that never touch a machine. Here each question is its own hook,
        //so one failing leaves the others standing on its own.
        var vm = okc.use('vmList', {}, 10000);
        var qs = okc.use('queueState', {}, 10000);
        var cr = okc.use('credentialsHeld', {}, 30000);

        var s = q.state;
        var status = st.state || {};
        var machines = vm.state || {};
        var vms = machines.vms || [];

        var lines = [];

        //---- VirtualBox ----------------------------------------------------
        //
        //Said in the banner and not only in the machines panel, because it is a
        //fact about every tab: a task cannot be given out, a branch cannot be
        //worked on, and the reason has nothing to do with either of them.
        if (st.state && !status.virtualbox) {
            lines.push({
                key: 'novbox',
                bold: 'VirtualBox was not found. ',
                rest: 'Nothing here can make or start a machine until it is installed.'
            });
        }

        if (machines.unreachable) {
            lines.push({
                key: 'vboxsick',
                bold: 'VirtualBox is installed but not answering. ',
                rest: 'Machine actions will hang or fail until it recovers — everything read from this host is'
                    + ' unaffected. It said: ' + machines.unreachable
            });
        }

        //A MACHINE IN THE LIST THAT VIRTUALBOX DOES NOT HAVE.
        vms.filter(function (v) { return !v.live; }).forEach(function (v) {
            lines.push({
                key: 'gone-' + v.name,
                bold: v.name + ' is in this list but VirtualBox has no such machine. ',
                rest: 'It was deleted elsewhere, or never finished being made. Delete it here to tidy up.',
                go: { label: 'Runners', at: function () { shell.go('Runners', 'Virtual machines'); } }
            });
        });

        //---- a repository left mid-change ----------------------------------
        //
        //THIS LINE HAD NEVER FIRED, IN EITHER APP. Both windows read
        //`status.repos` and neither app's `status` ever returned it, so the
        //filter ran over an empty list for as long as the warning has existed —
        //and a repository left dirty on a branch a machine needs went on
        //producing a push failure whose error is about a git configuration
        //variable. It started working the day `status` was ported here.
        //
        //AND THE SENTENCE WAS WRONG THE FIRST TIME IT APPEARED. It ended "or put
        //<repo> back on <home>" unconditionally, which on a repository sitting
        //on its OWN default branch reads "put local-repo-c back on version2"
        //while it is on version2. Being dirty and being on the wrong branch are
        //two different problems and only one of them has that repair.
        (status.repos || []).filter(function (r) { return !r.clean; }).forEach(function (r) {
            var away = r.home && r.on && r.on !== r.home;
            lines.push({
                key: 'dirty-' + r.repo,
                bold: r.repo + ' is on "' + r.on + '" here with uncommitted changes. ',
                rest: 'A machine working on "' + r.on + '" cannot push while that is true, and its own error'
                    + ' will not say why. Commit or discard them'
                    + (away ? ', or put ' + r.repo + ' back on ' + r.home : '') + '.',
                go: { label: 'Changes', at: function () { shell.go('Repositories', 'Changes'); } }
            });
        });

        //---- something is waiting on a person ------------------------------
        //
        //A badge is on a tab somebody is not looking at. That is fine for a
        //count and wrong for a STOP: a job written over the wire sits
        //unapproved, nothing runs it, the supervisor goes on waiting, and the
        //only sign is a number on a tab three along from wherever you are.
        //
        //NOT A FAULT, and the wording says so. Everything else in this list is
        //something that went wrong; this is the machinery working exactly as
        //designed — a model may write one of these and may not ratify it — and
        //reading it as an alarm would teach somebody to dismiss the banner.
        var approvals = (s && s.approvals) || [];
        if (approvals.length) {
            var named = approvals.map(function (a) {
                return a.kind + ' "' + (a.name || a.id) + '"';
            }).join(', ');
            lines.push({
                key: 'approvals',
                bold: approvals.length + (approvals.length === 1 ? ' thing is' : ' things are')
                    + ' waiting for you to approve. ',
                rest: 'Nothing runs them until you have read them: ' + named
                    + '. A model may write a job, a prompt or a contract and may not approve its own.',
                //WHERE THE THING ACTUALLY IS. Over there this went to Actions
                //always, and a judging job, prompt or contract is under Judge →
                //Judges — so pressing it opened a pane with nothing in it, which
                //reads as a button that does not switch tabs.
                go: {
                    label: 'Read them',
                    at: function () {
                        var first = approvals[0];
                        if (first && first.of === 'judge') return shell.go('Judge', 'Judges');
                        if (first && first.kind) return shell.go('Actions', first.kind[0].toUpperCase() + first.kind.slice(1) + 's');
                        return shell.go('Actions');
                    }
                }
            });
        }

        //---- a supervisor that cannot think --------------------------------
        //
        //A runner's natural state is off and holding nothing, and every other
        //rule here says so. A supervisor is the opposite on both counts: it is
        //meant to be up, and it is useless without a sign-in — so the state that
        //is restful for a runner is a fault for a supervisor, and the window said
        //nothing at all. What it DID say was worse: the terminal's own line
        //called it "signed out by design", which is the runner's sentence read
        //out over a machine it is not true of.
        //
        //FROM THE FIELD THAT ANSWERS ABOUT SUPERVISORS. The first version of this
        //asked `guests`, which omits them on purpose — so a host with a
        //supervisor sign-in sitting free was told it had none, and sent off to
        //make one it already had.
        var sup = (cr.state && cr.state.supervisor) || null;
        vms.filter(function (v) {
            return v.running && (v.tags || []).indexOf('supervisor') >= 0 && !v.holdsCredential;
        }).forEach(function (v) {
            //SIGNING IN IS AUTOMATIC, so a supervisor that is up and holding
            //nothing while a sign-in is available is not "somebody forgot to
            //press the button" — it is that the automatic thing did not happen.
            //Worth saying differently, and worth still having a button for: a
            //banner describing a fault the app was supposed to prevent should not
            //also be the one that can do nothing about it.
            if (sup && sup.free) {
                lines.push({
                    key: 'sup-' + v.name,
                    bold: v.name + ' is up and holding no sign-in, and it should have been given one. ',
                    rest: '"' + sup.using + '" is here and free. A supervisor is signed in when it dials in and'
                        + ' again before every wake, so this means one of those did not run.',
                    act: {
                        label: 'Sign it in',
                        cost: 'It places a sign-in on ' + v.name + '. That identity is on that machine until it is taken back.',
                        run: function () { return okc.call('supervisorSignIn', { name: v.name }); }
                    }
                });
                return;
            }

            //EVERYTHING ELSE IS A PERSON'S DECISION, and the reason is written
            //where the decision is made rather than here — copying those
            //sentences into the window is how the two drift apart. No button:
            //both remaining cases are somebody choosing an identity, and the
            //whole point of that boundary is that nothing here does it for them.
            lines.push({
                key: 'sup-' + v.name,
                bold: v.name + ' is up and cannot think: ' + ((sup && sup.why) || 'it is holding no sign-in') + '. ',
                rest: sup && sup.out
                    ? 'One identity cannot be in two places, so nothing here will take it back automatically —'
                        + ' that is somebody deciding which machine is the supervisor.'
                    : 'The worker credentials here are a different identity and are refused on a supervisor.',
                //KEYS, NOT RUNNERS. The sign-in panes moved to the Keys tab and
                //this went on pointing at where they used to be — Runners now
                //has a stub that says "moved", so the one button on the one
                //banner telling somebody to go and sign one in landed them on a
                //signpost instead of on the thing.
                //
                //A `go` THAT NAMES A PANE THAT IS NOT THERE cannot fail loudly:
                //`shell.go` finds no such pane and leaves you on the tab. It was
                //found by following the banner's own instruction.
                go: { label: 'Claude supervisor', at: function () { shell.go('Keys', 'Claude supervisor'); } }
            });
        });

        //---- a machine left on, doing nothing ------------------------------
        //
        //Said because nothing else says it. A runner's natural state is off; one
        //that is up and idle looks exactly like one that is working, and that is
        //how a machine stayed on for hours holding a token while every panel
        //reported it as healthy. It was noticed by eye.
        //
        //THE CREDENTIAL IS WHAT MAKES IT A BANNER rather than a note: an idle
        //machine is the one case where a token is exposed for no reason at all —
        //nothing is using it, and it will keep not being used until somebody
        //looks.
        var busy = {};
        ((qs.state && qs.state.inFlight) || []).forEach(function (f) { busy[f.machine] = true; });

        //---- AND WHAT IS ABOUT TO HAPPEN TO IT, WHICH IS NOT IDLENESS -------
        //
        //`plan.next` IS THE QUEUE SAYING WHERE IT IS ABOUT TO PUT THINGS, and
        //this banner read `queueState` for `inFlight` and dropped it. A machine
        //fifteen seconds from being given a judgement was called "on and doing
        //nothing" and offered a button to strip its credential — which is the
        //banner racing the tick, and losing tells you nothing about who was
        //right.
        //
        //ONLY WHILE THE TICK IS ACTUALLY TURNING, and this went in the wrong way
        //round once already. `plan` answers "what WOULD the tick do", on purpose
        //— ./queue/server.js built it that way so the board can say what is
        //about to happen without letting it happen. So with the queue stopped it
        //names a machine that is about to be given nothing, for ever. Suppressing
        //on that silenced the only machine with a reason to be mentioned, and a
        //banner that goes quiet reads as "all clear".
        var aboutTo = {};
        if (qs.state && qs.state.ticking) {
            (((qs.state && qs.state.plan) || {}).next || []).forEach(function (g) {
                if (g && g.machine) aboutTo[g.machine] = g.entry || true;
            });
        }

        //AND WHETHER ANY OF IT IS GOING TO HAPPEN AT ALL. The line below says
        //"the queue starts one when there is work" — which was simply FALSE with
        //a judgement sitting in `waiting` and the tick switched off, and it is
        //the sentence somebody reads before deciding to shut the machine down.
        //Told to undo the very machine the queue was about to use.
        var stopped = !!(qs.state && qs.state.tickHere && !qs.state.ticking);
        var queued = ((qs.state && qs.state.waiting) || []).length;

        vms.filter(function (v) {
            //A SHELL OPEN ON IT WOULD COUNT AS USING IT, and there is no way to
            //have one here yet — the terminal's live half is not built, so there
            //are no shells to ask about. When it lands, this filter needs the
            //same exclusion the old window has, or the window will argue with
            //itself: the sign-in line offers to hand a machine a credential so
            //`claude` will run, and this would immediately scold you for the
            //credential you were just told to place, on a machine you are
            //visibly sitting in.
            //---- AND NOT A SUPERVISOR, WHICH THIS DID NOT ASK -------------
            //
            //EVERY SENTENCE BELOW IS THE RUNNER'S AND NONE OF THEM IS TRUE OF A
            //SUPERVISOR. "A runner rests off and holding nothing" is exactly
            //backwards for one: it is MEANT to be up, it is MEANT to be holding
            //its sign-in, and sitting quietly between wakes is not idleness —
            //it is what a supervisor does.
            //
            //IT TOLD SOMEBODY TO UNDO A WORKING SUPERVISOR. beta-super1 came up,
            //was signed in as "claude-super-3", took a turn — and this banner
            //said it was "on, doing nothing, and holding a WORKER credential"
            //and offered a "Take it back" button that would have stripped the
            //credential that had just made it work.
            //
            //THE BLOCK BELOW THIS ONE ALREADY LEARNED IT. Its own note says the
            //first machine it ever fired on was "a SUPERVISOR holding a
            //supervisor sign-in" — the fix went in there and not here, one
            //block up, where the same list is filtered a second time.
            //
            //---- AND THEN IT HAPPENED AGAIN, TO A DIY SEAT ------------------
            //
            //`ok-diy1` was opened, and this said "ok-diy1 is on and doing
            //nothing. A runner rests off — THE QUEUE STARTS ONE WHEN THERE IS
            //WORK. Shut it down." Every clause is about the queue, and the queue
            //is the one thing that must never touch a DIY machine: the whole
            //point of the tag is that nothing rolls it back and runs a task over
            //the top of somebody's afternoon. It was scolding a person for
            //sitting in their own seat, and pointing them at Runners to undo it.
            //
            //SO IT ASKS `policy.notForTheQueue` NOW rather than naming a tag.
            //Written out by hand, this test was right about supervisors, wrong
            //about DIY, and would have been wrong about the next role too. There
            //is one place that knows which machines the queue leaves alone, and
            //../../queue/policy.js is it.
            return v.running
                && !policy.notForTheQueue(v)  //not the queue's machine to talk about
                && !busy[v.name]              //the queue is using it
                && !aboutTo[v.name]           //the queue is one tick from using it
                && !v.borrowed                //somebody took it, deliberately
                && v.forTasks !== false       //somebody said keep this one back
                && v.stage !== 'installing';  //it is being built
        }).forEach(function (v) {
            if (v.holdsCredential) {
                lines.push({
                    key: 'idle-' + v.name,
                    bold: v.name + ' is on, doing nothing, and holding a worker credential. ',
                    rest: 'A runner rests off and holding nothing. Take the credential back and shut it down,'
                        + ' or give it something to do.',
                    act: {
                        label: 'Take it back',
                        //THE SAME REPAIR, and the machine is already up so it is
                        //one step rather than three. It leaves a machine it found
                        //running exactly as it found it — this is a repair, not a
                        //tidy-up, and something may be about to use it.
                        cost: 'It takes the sign-in off ' + v.name + ' and leaves the machine running, as it found it.',
                        run: function () { return okc.call('credentialRecover', { name: v.name }); }
                    }
                });
                return;
            }
            //NOT OFFERED HERE. Stopping a machine somebody may be about to use is
            //not a repair, and this line is a nudge rather than a fault — the one
            //above it is the one with something wrong to put right.
            //THE ADVICE DEPENDS ON WHY NOTHING IS HAPPENING, and there are two
            //reasons that look identical on a machine. Nothing to do is a nudge.
            //Something to do and a stopped queue is not this machine's fault at
            //all, and "shut it down" is the wrong end of it — the queue is
            //where the work is stuck, so that is where this points.
            lines.push(stopped && queued
                ? {
                    key: 'idle-' + v.name,
                    bold: v.name + ' is on and doing nothing, and the queue is stopped. ',
                    rest: queued + ' waiting — it is not this machine that is idle so much as the thing that hands'
                        + ' out the work. Start the queue, or shut the machine down until you want it.',
                    go: { label: 'Queue', at: function () { shell.go('Queue', 'Board'); } }
                }
                : {
                    key: 'idle-' + v.name,
                    bold: v.name + ' is on and doing nothing. ',
                    rest: 'A runner rests off — the queue starts one when there is work. Shut it down, or give it'
                        + ' something to do.',
                    go: { label: 'Runners', at: function () { shell.go('Runners', 'Virtual machines'); } }
                });
        });

        //---- off, and still holding one ------------------------------------
        //
        //Which nothing said, because every other rule here is about a machine
        //that is running. A credential is taken back before a machine is shut
        //down, so this state cannot be reached by anything working correctly — it
        //means a machine was stopped from OUTSIDE that sequence. A host that
        //rebooted for an update is the ordinary way, and it happened.
        //
        //IT MATTERS MORE WHEN THE MACHINE IS OFF THAN WHEN IT IS ON, not less. A
        //running machine is at least visible; a powered-off one looks finished,
        //and the credential sits on its disk indefinitely, unmentioned, waiting
        //for somebody to happen to read a field.
        vms.filter(function (v) { return !v.running && v.live && v.holdsCredential; }).forEach(function (v) {
            //WHICH SIGN-IN, BY NAME AND BY KIND. This said "a worker credential"
            //whatever it was holding, and the first machine it ever fired on was
            //a SUPERVISOR holding a supervisor sign-in — the one sentence
            //somebody reads at the moment they least want a procedure, naming the
            //wrong kind of credential on the wrong kind of machine. The name
            //matters more than the kind: this host may hold several, and "a
            //credential" does not say which one is stranded on a disk.
            var what = v.guest
                ? 'the ' + (v.kind || 'worker') + ' sign-in "' + v.guest + '"'
                : 'a ' + (v.kind || 'worker') + ' credential';
            lines.push({
                key: 'stranded-' + v.name,
                bold: v.name + ' is powered off and still holding ' + what + '. ',
                rest: 'That cannot happen in the ordinary sequence — a credential is taken back before a machine'
                    + ' is shut down — so it was stopped from outside it, which a host restart does. Until then it'
                    + ' cannot be snapshotted.',
                act: {
                    label: 'Take it back',
                    //THE INSTRUCTION BECAME A BUTTON. This sentence used to end
                    //"start it, take the credential back, and shut it down again"
                    //— three steps in an order that matters, told to somebody at
                    //the moment they least want a procedure. It can be one press
                    //because every step is decided: the machine ends up off again
                    //exactly as it was found.
                    cost: 'It starts ' + v.name + ', takes the sign-in back, and shuts it down again. About a minute.',
                    run: function () { return okc.call('credentialRecover', { name: v.name }); }
                }
            });
        });

        //NOT PORTED, AND ON PURPOSE. The old window's first line reports that
        //loading states are being held open deliberately. `slowMs` does arrive on
        //`status` — but it is the DASHBOARD's slow mode, and this app has no
        //`windowSlow` of its own, so the line would report a setting that changes
        //nothing about anything on this screen.

        if (!lines.length) return null;

        function press(l) {
            ask({
                title: l.act.label,
                plain: [l.bold + l.rest],
                cost: l.act.cost,
                confirm: l.act.label,
                onYes: function () { return l.act.run(); }
            });
        }

        return (
            <Banner kind="stale">
                {lines.map(function (l) {
                    return (
                        <div key={l.key}>
                            <strong>{l.bold}</strong>
                            <span>{l.rest}</span>
                            {l.go ? <Linky onClick={l.go.at}>{l.go.label}</Linky> : null}
                            {/* A PHRASE, NOT A CONTROL. Every line here is a
                                sentence, and a button planted at the end of one
                                is a second kind of thing sitting in the middle
                                of a paragraph — it reads as chrome the sentence
                                happens to be wrapped around. A guarded Linky is
                                the same press with the same refusal behind it:
                                same purple, same class, same words, and the
                                driver turns it down identically. */}
                            {l.act
                                ? <Linky onClick={function () { press(l); }}>{l.act.label}</Linky>
                                : null}
                        </div>
                    );
                })}
            </Banner>
        );
    };
};
