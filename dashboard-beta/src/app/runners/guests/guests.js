var React = require('react');
var { useState } = React;

module.exports = function guests(theme, okc, remember) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Plus, Card, CardTitle, CardSub,
        Badge, Chips, Chip, Button, Finder, Skeleton, Empty, Note, Mono, Kv, KvRow,
        Notice, Link, ask
    } = theme;

    var day = function (s) { return s ? String(s).replace('T', ' ').slice(0, 16) : null; };

    //WORKING, NOT WORKING, OR NEVER TRIED — three states and not two. A sign-in
    //nobody has used yet is not a broken one, and colouring it as if it were
    //teaches people to ignore the colour.
    function health(g) {
        if (!g.lastCheck) return { kind: 'muted', word: 'not tried yet' };
        if (g.lastCheck.ready) return { kind: 'ok', word: 'worked' };
        return { kind: 'bad', word: 'did not authenticate' };
    }

    function Row({ g, on, onPick }) {
        var h = health(g);
        return (
            <Card pick on={on} onClick={onPick}>
                <CardTitle>
                    <Mono>{g.name}</Mono>
                    <Badge>{g.role}</Badge>
                    <Badge kind={h.kind}>{h.word}</Badge>
                </CardTitle>
                {g.holder
                    ? <CardSub>{'lent to '}<Mono>{g.holder}</Mono></CardSub>
                    : <CardSub>{g.role == 'supervisor' ? 'never lent — this host decides with it' : 'here, not lent'}</CardSub>}
                {g.plan ? <CardSub>{'plan: ' + g.plan}</CardSub> : null}
            </Card>
        );
    }

    function GuestsFor(role) {
      return function Guests() {
        //THE ROLE IS ASKED FOR, and it was not. `guests` answers with a sentence
        //written for the role it was asked about — ./server.js's `noteFor` — and
        //with none it answers for a WORKER. So the supervisor pane said "No
        //worker sign-in yet. A worker is a Claude sign-in kept here under a name
        //— add one with its token, and a machine can be lent it", which is
        //wrong twice over on that pane: wrong kind, and a supervisor sign-in is
        //never lent to anything.
        //
        //The list was filtered here anyway, so it looked right and only the
        //empty sentence gave it away — which is the shape a wrong-field bug has
        //when the wrong field is prose.
        var { state, error, reads, again } = okc.use('guests', { role: role }, 15000);
        var machines = okc.use('vmList', {}, 30000);
        var [find, setFind] = useState('');
        var [only, setOnly] = remember.use('guests', 'only', null);
        var [picked, setPicked] = remember.use('guests', 'picked', null);
        var [said, setSaid] = useState(null);

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Skeleton rows={4} /></Pane>;

        //ONE PAINTER, THREE PANES — the shape the old window arrived at, and
        //for its reason: a worker sign-in, a judge sign-in and a supervisor
        //sign-in are the same object with a different role, so two copies would
        //be two copies that drift and the second is the one nobody remembers to
        //fix. Which pane this is decides only what it filters to and what the
        //sentence at the top says.
        var all = (state.guests || []).filter(function (g) { return g.role == role; });
        var counts = {
            lent: all.filter(function (g) { return g.holder; }).length,
            broken: all.filter(function (g) { return g.lastCheck && !g.lastCheck.ready; }).length
        };

        var rows = all.filter(function (g) {
            if (find && g.name.toLowerCase().indexOf(find.toLowerCase()) < 0) return false;
            if (only == 'broken') return !!(g.lastCheck && !g.lastCheck.ready);
            if (only == 'lent') return !!g.holder;
            return true;
        });

        var on = all.filter(function (g) { return g.name == picked; })[0] || null;
        var vms = (machines.state && machines.state.vms) || [];

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: r.note || 'Done.' }); again(); },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
            );
        }

        //---- signing one in ------------------------------------------------
        //
        //THE URL IS NEVER OPENED AS THE PERSON AT THIS KEYBOARD. That is the
        //whole trap: this host's own browser is signed in as somebody, and
        //following the link here signs THAT account in as the guest — quietly,
        //and there is no undo. The link is meant to be carried to the other
        //account's browser, which is why it is shown as text to copy rather than
        //offered as something to click.
        //IT IS TWO CALLS AND THIS PANE MADE ONE, WITH THE WRONG ARGUMENT.
        //
        //`claudeSignIn` TAKES THE MACHINE, not what to call the credential —
        //`name` there is the supervisor whose desk holds the sign-in open. This
        //passed what somebody typed into "Call it", so the desk was asked for a
        //machine called "super-claude-1" and refused: "not a virtual machine
        //this app made, so it will not touch it". There was no way to sign in
        //from the window at all.
        //
        //AND THE ROLE WAS COLLECTED AND THROWN AWAY. `claudeSignIn` has no role;
        //the role belongs to `claudeSignedIn`, which this never called — so even
        //a working first half had nowhere to put the code, and the credential
        //could never be kept.
        //
        //SO: THE DESK IS NOT NAMED HERE. `claudeSignIn` with no machine lets
        //../guests/desk.js choose the one supervisor, and refuses with the whole
        //reason when there is more than one. A machine field on this dialog
        //would be a third place that decides which supervisor is the desk.
        function signIn() {
            ask({
                title: 'Get a sign-in link for a ' + role,
                plain: [
                    'The sign-in desk hands back a Claude login URL. Every credential this host holds comes from there.',
                    'OPEN IT AS THE ACCOUNT THE SIGN-IN IS FOR, not as yourself. This browser is already signed in as somebody, and following the link here signs that account in under this name.',
                    'Bring the code back and it is kept here under the name, sealed, and never shown again.',
                    //WHICH KIND, SAID RATHER THAN ASKED. It is decided by the
                    //pane the + was pressed on, so the dialog states it — a
                    //thing being decided for you is fine; a thing being decided
                    //for you silently is not.
                    role === 'supervisor'
                        ? 'It will be kept as a SUPERVISOR sign-in: never lent to a machine, and what this host decides work with.'
                        : role === 'judge'
                            ? 'It will be kept as a JUDGE sign-in: lent to a machine to read somebody else’s work, and never the sign-in that produced it.'
                            : 'It will be kept as a WORKER sign-in: lent to a machine while it works, and taken back after.'
                ],
                //---- AND THE ROLE IS NOT ASKED FOR ------------------------
                //
                //THE PANE ALREADY ANSWERED IT. There is a `+` on each of the
                //three panes and this is the same function behind all of them,
                //so which one it was pressed on IS the kind being made — a
                //dropdown here asks a question the screen has already answered,
                //and its default being wrong is how a supervisor sign-in gets
                //filed as a worker from the supervisor pane.
                //
                //A CREDENTIAL FILED UNDER THE WRONG ROLE IS NOT A LABEL. It
                //cannot be lent to the machine it was made for, and the pane it
                //belongs on will not show it — see `guestRole`, which exists to
                //dig one back out.
                fields: [
                    { name: 'as', label: 'Call it', placeholder: 'runner5', hint: 'what it is known as here, and what a machine is lent' }
                ],
                confirm: 'Get the link',
                protect: true,
                onYes: function (f) {
                    var as = String(f.as || '').trim();
                    if (!as) throw new Error('It needs a name.');

                    return okc.call('claudeSignIn', {}).then(function (r) {
                        //THE DESK IS NOW HOLDING ONE OPEN, and it stays open
                        //until the code comes back or it is cancelled. So the
                        //second half opens straight away rather than leaving
                        //somebody to find it: a desk left holding a sign-in
                        //nobody finishes is the state this flow can get stuck in.
                        codeFor(r, as, role);
                    }, function (e) { setSaid({ bad: true, text: e.message }); throw e; });
                }
            });
        }

        //---- and giving the code back --------------------------------------
        //
        //THE URL IS SHOWN AS TEXT TO COPY, never as something to click. This
        //host's browser is signed in as somebody, and following the link HERE
        //signs that account in under this name — quietly, with no undo. That is
        //the whole trap, and the reason the desk exists as a separate user.
        function codeFor(started, as, kind) {
            ask({
                title: 'Sign in as the account this is for, then paste the code',
                plain: [
                    'Copy the address below and open it as THE ACCOUNT THIS SIGN-IN IS FOR — not as yourself, and not in a browser already signed in as somebody else.',
                    'Approve it there. It hands back a code.',
                    'The desk on ' + started.name + ' is holding this open until the code comes back.'
                ],
                reads: started.url,
                readsAre: 'The sign-in address',
                //THE BUTTON THE APP BEING PORTED FROM HAS, and it is not a
                //convenience: an ordinary link on an app page navigates the
                //DASHBOARD to claude.com and takes this dialog — the one waiting
                //for the code — with it. `openOut` hands it to the operating
                //system instead.
                //
                //THE ADDRESS STAYS ABOVE IT for the reason that app gives: a
                //button that silently fails to open leaves nothing to fall back
                //on, and this address is the only way to finish what has already
                //been started on the machine.
                opens: 'Open the sign-in page',
                fields: [
                    { name: 'code', label: 'The code it gave you', placeholder: 'paste it here' }
                ],
                cost: 'It signs that Claude account in and keeps the credential here, sealed.',
                confirm: 'Keep it',
                protect: true,

                //---- AND A WAY OUT THAT ACTUALLY ENDS IT -------------------
                //
                //"NEVER MIND" ONLY CLOSES THIS DIALOG. The desk on the machine
                //goes on holding the sign-in open — a `claude` process sitting
                //at its "paste code here" prompt — and nothing on this screen
                //would ever say so again. The next `+` then starts a second one
                //behind the first.
                //
                //THE APP BEING PORTED FROM HAS THIS AND THIS DID NOT, which is
                //the real gap between the two flows. Its own note is worth
                //keeping: giving up cancels the conversation and nothing else —
                //no machine was borrowed to hold it, so there is nothing to give
                //back.
                extra: {
                    label: 'Give up',
                    onClick: function () {
                        okc.call('claudeSignInCancel', { name: started.name }).then(
                            function (r) { setSaid({ text: r.note || 'The desk is clear.' }); },
                            //IT MAY NEVER HAVE STARTED, or may have finished
                            //while this was open. Neither is worth an error on
                            //the way out.
                            function () { setSaid({ text: 'The desk is clear.' }); }
                        );
                    }
                },
                onYes: function (f) {
                    var code = String(f.code || '').trim();
                    if (!code) throw new Error('Paste the code the sign-in page gave you.');

                    return okc.call('claudeSignedIn', {
                        //THE MACHINE THE DESK IS ON, as the first call answered
                        //it — not asked again, because a second read could pick
                        //a different supervisor than the one holding this open.
                        name: started.name,
                        code: code,
                        as: as,
                        role: kind
                    }).then(function (r) {
                        setSaid({ text: r.note || ('"' + as + '" is kept here now.') });
                        again();
                    }, function (e) { setSaid({ bad: true, text: e.message }); throw e; });
                }
            });
        }

        function lend(g) {
            //ONLY MACHINES THAT COULD TAKE IT. A machine already holding a
            //sign-in is not a candidate — two on one machine is the state this
            //whole arrangement exists to prevent.
            var free = vms.filter(function (v) { return !v.holdsCredential; });
            ask({
                title: 'Lend "' + g.name + '" to a machine?',
                plain: [
                    'The machine can authenticate as this identity while it works, and it is taken back afterwards.',
                    'One machine, one sign-in. Anything already holding one is not offered here.',
                    free.length ? null : 'Nothing is free — every machine is already holding a sign-in.'
                ],
                fields: [{
                    name: 'machine', label: 'To which machine',
                    options: free.map(function (v) { return { value: v.name, label: v.name + (v.running ? ' — running' : ' — off') }; }),
                    disabled: !free.length
                }],
                confirm: 'Lend it',
                onYes: function (f) {
                    if (!f.machine) throw new Error('Say which machine.');
                    return tell(okc.call('guestLend', { name: g.name, machine: f.machine }));
                }
            });
        }

        function back(g) {
            ask({
                title: 'Take "' + g.name + '" back off ' + g.holder + '?',
                plain: [
                    'It comes back here, keeping whatever the worker refreshed — so a session renewed on the machine is not thrown away.',
                    'The machine can no longer authenticate as this identity.'
                ],
                confirm: 'Take it back',
                onYes: function () { return tell(okc.call('guestBack', { name: g.name, machine: g.holder })); }
            });
        }

        function forget(g) {
            ask({
                title: 'Throw "' + g.name + '" away?',
                plain: [
                    'The identity and its token, gone from this host.',
                    //THE OPERATOR'S RULE, IN THE DIALOG WHERE IT APPLIES.
                    //Throwing a sign-in away is not tidying: a machine being
                    //replaced by a new one is an ordinary thing, and a sign-in
                    //that looks unused today is the one the replacement needs
                    //tomorrow. So this never happens on its own — not on a
                    //failed check, not on a machine being deleted, not on a
                    //schedule. Only here, only now, only because somebody said.
                    'This never happens on its own. Not when a check fails, not when a machine goes — a machine being replaced is ordinary, and the sign-in outlives it.',
                    g.lastCheck && !g.lastCheck.ready
                        ? 'Its last check failed, which is a reason to sign in again rather than a reason to throw it away.'
                        : null
                ],
                cost: 'The token is gone. Getting it back means a new sign-in, as that account, from its own browser.',
                confirm: 'Throw it away',
                danger: true,
                protect: true,
                onYes: function () {
                    return tell(okc.call('guestForget', { name: g.name })).then(function () { setPicked(null); });
                }
            });
        }

        var chip = function (key, word) {
            return <Chip on={only == key} count={counts[key]}
                onClick={function () { setOnly(only == key ? null : key); }}>{word}</Chip>;
        };

        return (
            <Pane>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}
                {error ? <Note kind="bad">{error}</Note> : null}

                {/* THE SENTENCE THE OLD PANE LEADS WITH, which says what this
                    kind of sign-in is FOR. Three panes that differ only in a
                    filter need it, or they read as the same list three times. */}
                <Note>{all.length + ' ' + role + ' sign-in' + (all.length == 1 ? '' : 's') + '. ' + (
                    role == 'supervisor'
                        ? 'It is never lent anywhere — it is the sign-in this host decides work with.'
                        : role == 'judge'
                            ? 'It is lent to a machine to read somebody else’s work, and must never be the sign-in that produced it.'
                            : 'It is lent to a machine while it works and taken back after, so two machines never share one.'
                )}</Note>

                <Cols>
                    <Col narrow>
                        <TitleRow>
                            Guests<Grow />
                            <Plus title="Get a sign-in link from the desk" onClick={signIn} />
                        </TitleRow>
                        <Finder value={find} onChange={setFind} placeholder="find a sign-in" />
                        <Chips>
                            {chip('lent', 'lent out')}
                            {chip('broken', 'did not authenticate')}
                        </Chips>
                        <Stack>
                            {rows.length
                                ? rows.map(function (g) {
                                    return <Row key={g.name} g={g} on={g.name == picked}
                                        onPick={function () { setPicked(g.name); }} />;
                                })
                                : <Empty>{all.length ? 'nothing matches' : 'this host holds no sign-ins'}</Empty>}
                        </Stack>

                        {/* AN EMPTY LIST IS NOT AN EMPTY HOST, and on this pane
                            those look identical. This app keeps its own
                            sign-ins, in its own folder, so a subsystem that has
                            just been ported starts with none — which is what
                            makes porting unable to damage a credential a machine
                            is using, and is also exactly what losing them would
                            look like.

                            THE ACTION ASKS RATHER THAN GUESSING: the sentence is
                            only there when the app being ported from actually
                            holds some, so a genuinely fresh host reads as a
                            fresh host and says nothing. */}
                        {!all.length && state.note ? <Note>{state.note}</Note> : null}
                    </Col>

                    <Col>
                        <h2>Actions <span className="muted">{on ? '— ' + on.name : '— nothing selected'}</span></h2>
                        <Panel>
                            {!on ? <Empty>pick a sign-in on the left</Empty> : (
                                <div>
                                    <div className="row">
                                        <Button
                                            disabled={!!on.holder || on.role == 'supervisor'}
                                            title={on.role == 'supervisor'
                                                ? 'a supervisor sign-in is never lent — it is what this host decides with'
                                                : on.holder ? 'it is already lent to ' + on.holder : 'lend it to a machine'}
                                            onClick={function () { lend(on); }}>Lend it</Button>

                                        <Button
                                            disabled={!on.holder}
                                            title={on.holder ? 'take it back off ' + on.holder : 'it is not lent to anything'}
                                            onClick={function () { back(on); }}>Take it back</Button>

                                        <Button kind="danger" protect
                                            title="throw the identity and its token away"
                                            onClick={function () { forget(on); }}>Throw it away</Button>
                                    </div>

                                    {on.lastCheck && !on.lastCheck.ready
                                        ? <Note kind="bad">
                                            {'The last machine to use it could not authenticate. Sign in again as that account — '
                                                + 'throwing it away is a separate decision, and usually the wrong one.'}
                                        </Note>
                                        : null}
                                </div>
                            )}
                        </Panel>
                    </Col>

                    <Col wide>
                        <h2>What it is</h2>
                        {!on ? <Panel><Empty>nothing picked</Empty></Panel> : (
                            <div>
                                <Panel>
                                    <Kv>
                                        <KvRow label="role">{on.role}</KvRow>
                                        {/* THE FINGERPRINT IS HOW TWO SIGN-INS ARE
                                            TOLD APART WITHOUT SHOWING EITHER. It is
                                            the whole reason this pane can be
                                            photographed. */}
                                        <KvRow label="fingerprint"><Mono>{on.fingerprint || 'none'}</Mono></KvRow>
                                        <KvRow label="held">{on.has ? 'yes' : 'no token here'}</KvRow>
                                        <KvRow label="plan">{on.plan || <span className="muted">not known</span>}</KvRow>
                                        {/* AN ACCOUNT IS AN OBJECT, NOT A WORD, and rendering
                                            it as one took the whole window down: React
                                            refuses an object as a child and there is no
                                            boundary between one bad value and a blank app.
                                            It carries {email, uuid, organization}.
                                            
                                            THE UUID IS NOT SHOWN, and that is the same rule
                                            the fingerprint row is written for: this pane
                                            says WHOSE a sign-in is and never enough to be
                                            one. The old window shows the address and the
                                            organization and nothing else, under the words
                                            "signed in as" -- which is the question being
                                            answered, where "account" is only the shape of
                                            the answer. */}
                                        <KvRow label="signed in as">
                                            {on.account && on.account.email
                                                ? on.account.email + (on.account.organization ? ' — ' + on.account.organization : '')
                                                : <span className="muted">not recorded — this one was signed in before the account was kept, and the credential itself does not carry it</span>}
                                        </KvRow>
                                        <KvRow label="added">{day(on.added) || 'unknown'}</KvRow>
                                        <KvRow label="came from">{on.from || <span className="muted">not recorded</span>}</KvRow>
                                        <KvRow label="last refreshed">{day(on.refreshed) || <span className="muted">never</span>}</KvRow>
                                        <KvRow label="lent to now">{on.holder ? <Mono>{on.holder}</Mono> : <span className="muted">nothing</span>}</KvRow>
                                        <KvRow label="last lent to">
                                            {on.lastGivenTo
                                                ? <span><Mono>{on.lastGivenTo}</Mono>{on.lastGiven ? ', ' + day(on.lastGiven) : ''}</span>
                                                : <span className="muted">never lent</span>}
                                        </KvRow>
                                    </Kv>
                                    {on.note ? <Note>{on.note}</Note> : null}
                                </Panel>

                                {/* WHAT THE LAST MACHINE THAT TRIED IT SAID. This
                                    is the only evidence anywhere that a sign-in
                                    still works, and without it a dead identity
                                    looks exactly like a live one. */}
                                <Panel>
                                    <CardTitle>Last time a machine used it</CardTitle>
                                    {on.lastCheck ? (
                                        <div>
                                            <Kv>
                                                <KvRow label="worked">{on.lastCheck.ready ? 'yes' : 'no'}</KvRow>
                                                <KvRow label="on"><Mono>{on.lastCheck.on || '?'}</Mono></KvRow>
                                                <KvRow label="at">{day(on.lastCheck.at) || 'unknown'}</KvRow>
                                            </Kv>
                                            {on.lastCheck.why
                                                ? <Note kind={on.lastCheck.ready ? 'muted' : 'bad'}>{on.lastCheck.why}</Note>
                                                : null}
                                        </div>
                                    ) : (
                                        //NEVER TRIED IS NOT BROKEN, and the two
                                        //must not read the same.
                                        <Empty>no machine has used it yet, so nothing here knows whether it works</Empty>
                                    )}
                                </Panel>
                            </div>
                        )}

                        <Note>
                            {'No token is shown on this pane, and none is returned by the actions that fill it. '
                                + (state.where ? 'They are kept in ' + state.where + '. ' : '')
                                + 'read ' + reads + ' time(s), every 15s'}
                        </Note>
                    </Col>
                </Cols>
            </Pane>
        );
      };
    }

    return GuestsFor;
};
