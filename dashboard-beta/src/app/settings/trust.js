var React = require('react');
var { useState } = React;

//---------------------------------------------------------------------------
//WHOSE WORDS FROM GITHUB MAY BE READ AS A REQUEST.
//
//THE PANE FOR ../github/trust.js, which is where the reasoning lives and should
//be read first. This file is the two things a person sets and nothing else: the
//word that means "I mean this", and the list of people whose saying it counts.
//
//BOTH BLANK IS OFF AND THAT IS HOW IT SHIPS. So this pane's first job is to say
//what state it is in, in a sentence, before it shows a single box — "off" here
//is not an absence of configuration, it is a working state with a guarantee
//attached, and somebody who never touches this tab has that guarantee.
//
//---- why a lookup, and not a text box ------------------------------------
//
//`bmatusiakk` IS AVAILABLE AND LOOKS RIGHT IN A LIST. A trusted name is typed
//once and read for years, and the failure is not that somebody types nonsense —
//nonsense is caught by the next thing that reads the list, which trusts nobody
//and says nothing. It is that they type a name that EXISTS and belongs to
//somebody else.
//
//Nothing in software can tell those apart. A person looking at a face can. So
//the name goes to GitHub before it goes in the list, and what comes back is
//shown as a picture and a name rather than as a tick — the check is done by the
//person, and this pane's job is to put the evidence in front of them.
//---------------------------------------------------------------------------

module.exports = function makeTrust(theme, okc) {
    var { Pane, Panel, Note, Badge, Empty, Mono, Muted, Form, Field, Button, Link, Skeleton, Toggle, ask } = theme;

    //A LOGIN, AS GITHUB DEFINES ONE. Checked here as well as in ../github/
    //server.js — not because the door is untrusted, but because a person who
    //has pasted a URL should be told so by the box they pasted it into rather
    //than by a round trip.
    var LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

    //---- one account, as evidence rather than as a result ------------------
    //
    //THE PICTURE IS THE POINT. Everything else on this card is a string that a
    //lookalike name would also produce; the face is the one part somebody
    //recognises or does not.
    function Account({ who, children }) {
        return (
            <div className="card">
                <div className="card-title">
                    {who.avatar
                        ? <img src={who.avatar} alt="" width="28" height="28"
                            style={{ borderRadius: '50%', marginRight: '8px' }} />
                        : null}
                    <span className="grow">
                        <strong>{who.login}</strong>
                        {who.name ? <Muted>{' — ' + who.name}</Muted> : null}
                    </span>
                    {children}
                </div>
                <div className="card-sub">
                    {/* THE ID, SHOWN RATHER THAN ONLY KEPT. It is what makes the
                        entry survive a rename, and a number nobody ever sees is
                        a number nobody can check against the profile. */}
                    <Mono>{'#' + who.id}</Mono>
                    {who.url ? <span>{' '}<Link href={who.url}>open the profile</Link></span> : null}
                </div>
            </div>
        );
    }

    //AN ENTRY IS A LOGIN OR `{login, id}` -- see ../github/trust.js for why both.
    //Read through these two rather than touched directly, so the older shape
    //cannot render as `[object Object]` in one place and work in another.
    function nameOf(one) { return (one && typeof one === 'object') ? String(one.login || '') : String(one || ''); }
    function idOf(one) { return (one && typeof one === 'object' && one.id != null) ? one.id : null; }

    function Trust() {
        var { state, error } = okc.use('settings', {}, 5000);
        //WHAT WENT OUT UNREAD, read here because this is where the switch that
        //allows it lives. A hook, with the others, above every early return.
        var spoken = okc.use('spokenFor', { days: 7 }, 20000);

        var [marker, setMarker] = useState(null);   //null = not being edited
        var [typed, setTyped] = useState('');
        var [found, setFound] = useState(null);
        var [looking, setLooking] = useState(false);
        var [said, setSaid] = useState(null);

        function tell(p) {
            return p.then(
                function (r) { setSaid({ text: (r && r.note) || 'Saved.' }); return r; },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; }
            );
        }

        function save(name, value) {
            setSaid(null);
            return tell(okc.call('settingSet', { name: name, value: value }));
        }

        if (!state && error) return <Pane><Note kind="bad">{error}</Note></Pane>;
        if (!state) return <Pane><Panel><Skeleton rows={4} /></Panel></Pane>;

        var s = state.settings || {};
        var word = typeof s.githubMarker == 'string' ? s.githubMarker : '';
        var people = Array.isArray(s.githubTrusted) ? s.githubTrusted : [];
        var on = !!word && people.length > 0;

        //---- the marker ---------------------------------------------------

        //EDITED LOCALLY, SAVED DELIBERATELY. The read lands every five seconds
        //and would otherwise take the box back off somebody mid-word.
        var editing = marker === null ? word : marker;
        var changed = editing.trim() !== word;

        function saveMarker() {
            var next = editing.trim();
            if (!next) {
                return ask({
                    title: 'Turn this off?',
                    plain: [
                        'With no marker set, nothing arriving from GitHub can be a request.',
                        'Every issue, pull request and comment goes on being read — and every one of them is a quotation, whoever wrote it, including yours.'
                    ],
                    confirm: 'Clear the marker',
                    onYes: function () { save('githubMarker', '').then(function () { setMarker(null); }); }
                });
            }
            save('githubMarker', next).then(function () { setMarker(null); });
        }

        //---- the people ---------------------------------------------------

        function look() {
            var name = typed.trim();
            setSaid(null);
            setFound(null);
            if (!LOGIN.test(name)) {
                setSaid({ bad: true, text: 'That is not a GitHub login. They are letters, numbers and single dashes — not a URL and not an email address.' });
                return;
            }
            setLooking(true);
            okc.call('githubWho', { login: name }).then(
                function (who) { setLooking(false); setFound(who); },
                function (e) { setLooking(false); setSaid({ bad: true, text: e.message }); }
            );
        }

        //NAMED IN THE QUESTION, and the question says what trusting DOES rather
        //than that it is trusting. "Do you trust X" is answered yes by everybody
        //about everybody they know; "X's marked words become requests this host
        //acts on" is the thing being decided.
        function trustThem(who) {
            ask({
                title: 'Let ' + who.login + '’s marked words count as a request?',
                plain: [
                    (who.name ? who.name + ' (' + who.login + ')' : who.login) + ', account #' + who.id + '.',
                    'From then on, anything they write in an issue, a pull request or a comment that carries the "'
                        + (word || '…') + '" marker is read here as somebody asking for something, rather than as a quotation.',
                    'It is still quoted, and it still goes through every step anything else goes through. What changes is that it can start something.'
                ],
                cost: 'A GitHub login can be changed, and the old one can then be registered by somebody else. This keeps the account number as well as the name, so a rename is visible here rather than silent — but check the picture is who you think it is before agreeing.',
                confirm: 'Trust ' + who.login,
                danger: true,
                //A MODEL MAY NOT GRANT ITSELF AN INPUT. Naming somebody trusted
                //is opening a channel from the internet into what this host acts
                //on; a supervisor able to press this could add an account it
                //controls and then commission its own work through an issue.
                //../core/drive refuses a protected button, and ./server.js
                //refuses the setting down the pipe — this is the half a person
                //can see.
                onYes: function () {
                    //THE NUMBER, NOT ONLY THE NAME. It was just looked up; there
                    //is no reason to store the weaker half of what came back.
                    save('githubTrusted', people.concat([{ login: who.login, id: who.id }])).then(function () {
                        setFound(null);
                        setTyped('');
                    });
                }
            });
        }

        function dropThem(one) {
            var name = nameOf(one);
            ask({
                title: 'Stop reading ' + name + '’s words as requests?',
                plain: [
                    'Their issues and comments go on being read. They become quotations again — reported, never acted on.',
                    'Nothing already commissioned is undone by this.'
                ],
                confirm: 'Remove ' + name,
                onYes: function () {
                    //BY IDENTITY, not by name: two entries could carry the same
                    //login if one was typed and one looked up, and removing "the
                    //one named X" would take both -- including the one that was
                    //not being removed.
                    save('githubTrusted', people.filter(function (x) { return x !== one; }));
                }
            });
        }

        //MATCHED ON THE NUMBER WHEN THERE IS ONE, so a renamed account reads as
        //already trusted rather than as somebody new.
        var already = found
            ? people.filter(function (x) {
                return (idOf(x) != null && String(idOf(x)) === String(found.id))
                    || nameOf(x).toLowerCase() === String(found.login).toLowerCase();
            })[0] || null
            : null;

        return (
            <Pane>
                {error ? <Note kind="bad">{error}</Note> : null}

                <Panel>
                    <div className="card-title">
                        <span className="grow">Words arriving from GitHub</span>
                        {on ? <Badge kind="ok">on</Badge> : <Badge>off</Badge>}
                    </div>

                    {/* THE STATE, AS A SENTENCE, BEFORE THE CONTROLS. Off is a
                        guarantee and not a gap, and it is worth reading that way
                        by somebody who came here to check rather than to change
                        anything. */}
                    <Note kind={on ? undefined : 'ok'}>
                        {on
                            ? 'Anything written by one of the people below that carries the "' + word + '" marker '
                                + 'is read here as somebody asking for something. Everything else from GitHub is a '
                                + 'quotation: read, reported, never acted on.'
                            : 'Nothing arriving from GitHub can be a request. Issues, pull requests and comments are '
                                + 'still read, and every one of them is a quotation — read, reported, never acted on. '
                                + 'That is what this host does until both boxes below are filled in.'}
                    </Note>

                    <Note>
                        An issue body is text anybody on the internet can write, and it arrives on the same answer
                        as everything this host knows for certain. Nothing here tries to spot a bad one — the
                        version people write examples about says "ignore previous instructions", and the version
                        that would work reads like a helpful bug report. What this does instead is say who wrote
                        it, every time, in the text itself.
                    </Note>
                </Panel>

                <Panel>
                    <div className="card-title"><span className="grow">The marker</span></div>
                    <Form>
                        <Field
                            f={{
                                label: 'A word you put in a comment when you mean it — blank turns this off',
                                placeholder: 'nothing set'
                            }}
                            value={editing}
                            onChange={function (x) { setMarker(x); }} />
                    </Form>
                    <div className="head-controls">
                        {/* PURPLE, AND FOR THE SAME REASON THE OTHER ONE IS.
                            The word looks like the harmless half — it trusts
                            nobody on its own — and it is not, because it is
                            applied to text that ALREADY EXISTS. Set it to a word
                            a trusted person writes habitually and their old
                            comments become requests, retroactively, with nobody
                            having written anything new. ./server.js refuses the
                            setting down the pipe; this is the half a person can
                            see. */}
                        <Button kind="ok" disabled={!changed} onClick={saveMarker}>
                            {editing.trim() ? 'Save' : 'Clear it'}
                        </Button>
                        {changed
                            ? <Button onClick={function () { setMarker(null); }}>Cancel</Button>
                            : null}
                    </div>

                    <Note>
                        {editing.trim()
                            ? 'Written as "' + editing.trim() + ': do the thing" in the body of an issue or a comment, '
                                + 'or put on the issue as a label. It has to be a whole word — "'
                                + editing.trim() + '" inside a longer one or a URL is not somebody asking for anything.'
                            : 'It goes in a comment as "the-word: do the thing", or on the issue as a label.'}
                    </Note>
                    <Note>
                        {/* SAID PLAINLY, BECAUSE THE OPPOSITE IS THE NATURAL
                            GUESS. A word you choose and keep to yourself LOOKS
                            like a secret, and somebody treating it as one would
                            reasonably conclude that a stranger typing it could
                            not matter. */}
                        This is not a password. It is visible in every comment that carries one, so anybody can
                        copy it — which is why it is never the whole test. Being trusted and having said the word
                        are two separate questions and both have to answer yes.
                    </Note>
                </Panel>

                <Panel>
                    <div className="card-title">
                        <span className="grow">Watching GitHub</span>
                        {s.watchGitHub ? <Badge kind="ok">on</Badge> : <Badge>off</Badge>}
                    </div>
                    {/* THE SETTING HAD A RATIONALE AND NO CONSUMER for as long as
                        it existed. It has one now, and this is where it is said
                        out loud: on means this host asks GitHub every five
                        minutes, whether or not anybody is looking, and a tag left
                        on an issue wakes the supervisor. Off means GitHub is read
                        only while a Repositories pane is open. */}
                    <Toggle on={!!s.watchGitHub} onChange={function (v) { save('watchGitHub', v); }}>
                        Ask GitHub every five minutes on its own, and wake the supervisor when a trusted person tags an issue
                    </Toggle>
                    <Note>
                        Off, GitHub is only read while a Repositories pane is open. On, this host sweeps the places
                        it reads every five minutes, and an issue tagged with the marker by somebody on the list
                        above wakes the supervisor with the whole conversation. Nothing is written to GitHub by
                        watching it.
                    </Note>
                </Panel>

                <Panel>
                    <div className="card-title">
                        <span className="grow">Speaking in your name — auto respond</span>
                        {s.githubReplyDirect || s.githubCloseDirect || s.githubReviewDirect
                            ? <Badge kind="warn">some go out unread</Badge>
                            : <Badge kind="ok">everything is read first</Badge>}
                    </div>
                    <Note>
                        A reply, a close and a review each go on somebody else's repository under this host's
                        token, so they read as you having said it. Off, each is written as a draft and waits for
                        you to read the whole thing and release it. On, it goes out the moment it is written —
                        which is the auto-respond people look for. The tag is still required either way, and so
                        is the address: this host only ever answers a thread where somebody trusted addressed
                        the account it posts as and wrote "{(s.githubMarker || 'okc') + ': …'}" — never a
                        stranger's issue, and never itself.
                    </Note>
                    {/* WHAT REPLACED THE INBOX ITEM. Switching the draft step
                        off empties the inbox by design, and then nothing says
                        what went out unread. It is said here, where the switch
                        is, because this is the card somebody is standing on
                        when they decide. */}
                    {spoken.state && spoken.state.count
                        ? <Note kind="warn">
                            {spoken.state.count + ' went out unread in the last ' + spoken.state.days + ' day(s): '
                                + (spoken.state.said || []).slice(0, 4).map(function (x) {
                                    return x.kind + ' on ' + x.on + '#' + x.number;
                                }).join(' · ')
                                + ((spoken.state.said || []).length > 4 ? ' …' : '')}
                        </Note>
                        : null}
                    {/* PURPLE, ALL THREE. Each is the switch between a model
                        writing something and a stranger reading it in your
                        name; ../settings/server.js refuses them down the pipe
                        with their own sentence, and this is the half a person
                        can see. */}
                    <div className="stack">
                        {/* THE THREE ARE SEPARATE BECAUSE WHAT THEY RISK IS.
                            Words, a state change on somebody's tracker, and a
                            thing a maintainer may merge on are not one decision
                            and were never offered as one switch. */}
                        <Toggle on={!!s.githubReplyDirect} onChange={function (v) { save('githubReplyDirect', v); }}>
                            Post replies to issues without me reading them first — a reply is words
                        </Toggle>
                        <Toggle on={!!s.githubCloseDirect} onChange={function (v) { save('githubCloseDirect', v); }}>
                            Close issues without me reading the close first — a close changes the state of somebody's tracker
                        </Toggle>
                        <Toggle on={!!s.githubReviewDirect} onChange={function (v) { save('githubReviewDirect', v); }}>
                            Post a judge's review without me reading it first — a review is something a maintainer may merge on
                        </Toggle>
                    </div>
                </Panel>

                <Panel>
                    <div className="card-title">
                        <span className="grow">Whose word counts</span>
                        {people.length ? <Badge>{String(people.length)}</Badge> : null}
                    </div>

                    {people.length
                        ? <div className="stack">
                            {people.map(function (one) {
                                var name = nameOf(one);
                                var id = idOf(one);
                                return (
                                    <div className="card" key={name}>
                                        <div className="card-title">
                                            <span className="grow"><Mono>{name}</Mono></span>
                                            {/* NAMED BUT NOT LOOKED UP, said on the
                                                row rather than left to be inferred
                                                from a missing number. It is a weaker
                                                entry -- it matches on the name, so it
                                                follows the name if the name changes
                                                hands -- and the person who typed it
                                                is the one who can fix it. */}
                                            {id == null
                                                ? <Badge kind="warn" title="Added by name alone, so it matches whoever holds that name">by name only</Badge>
                                                : <Mono>{'#' + id}</Mono>}
                                            {/* PURPLE, THOUGH REMOVING IS THE
                                                SAFE DIRECTION. Nothing grants
                                                itself anything by pressing this
                                                — the worst it does is make this
                                                host stop listening to somebody,
                                                which is the state it ships in.
                                                On its own merits it would not be
                                                marked.

                                                IT IS THE SAME KEY. Adding and
                                                removing are both a write to
                                                `githubTrusted`, and ./server.js
                                                cannot tell them apart from
                                                there, so a driven press is
                                                refused either way. Left plain,
                                                this would look pressable, be
                                                pressed, and come back with a
                                                sentence about opening a channel
                                                — a refusal that does not
                                                describe what was attempted is
                                                worse than being told no. */}
                                            <Button onClick={function () { dropThem(one); }}>Remove</Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        : <Empty>Nobody. Until somebody is named here, nothing from GitHub can be a request — the marker on its own does nothing.</Empty>}

                    <Form>
                        <Field
                            f={{ label: 'Add somebody — their GitHub login', placeholder: 'a-login' }}
                            value={typed}
                            onChange={function (x) { setTyped(x); setFound(null); }} />
                    </Form>
                    {/* UNDER THE FIELD, NOT PUSHED TO THE OTHER END OF THE ROW.
                        `head-row` sends its controls to the right margin, which
                        for a heading is the point and for a box and its own
                        button leaves them a screen apart. */}
                    <div className="head-controls">
                        <Button disabled={!typed.trim() || looking} onClick={look}>
                            {looking ? 'Asking GitHub…' : 'Look them up'}
                        </Button>
                    </div>

                    {/* THE LOOKUP IS BETWEEN TYPING AND TRUSTING, and it is not
                        a validation step that could be skipped when the name
                        looks fine. There is no way to press the trusting button
                        without having been shown a face. */}
                    {found
                        ? <div className="stack">
                            <Account who={found}>
                                {found.kind === 'User' && !already
                                    ? <Button kind="danger" onClick={function () { trustThem(found); }}>
                                        Trust this account
                                    </Button>
                                    : null}
                            </Account>
                            <Note kind={found.kind === 'User' ? undefined : 'warn'}>{found.note}</Note>
                            {already
                                ? <Note kind="ok">
                                    {idOf(already) == null
                                        ? 'Already on the list, by name alone. Remove it and add it again to keep the account number too.'
                                        : 'Already on the list.'}
                                </Note>
                                : null}
                        </div>
                        : null}

                    {said ? <Note kind={said.bad ? 'bad' : 'ok'}>{said.text}</Note> : null}
                </Panel>
            </Pane>
        );
    }

    return Trust;
};
