var React = require('react');
var { useRef, useEffect, useState } = React;

//WRITTEN OUT OF CHARACTER CODES RATHER THAN ESCAPES IN THE SOURCE. What the
//terminal exhibit is FOR is showing that xterm reads control sequences, so the
//sequences have to survive being read, edited and pasted by whoever comes next —
//and an escape in a string literal is the first thing a well-meaning editor or a
//shell heredoc mangles into something that renders as garbage. Named constants
//cannot be mangled quietly: if one of these is wrong, it is wrong out loud.
var ESC = String.fromCharCode(27);
var CRLF = String.fromCharCode(13, 10);
var CR = String.fromCharCode(13);

module.exports = function kit(theme) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Row,
        Card, CardTitle, CardSub, Badge, Badges, Chips, Chip,
        Button, Toggle, Views, Linky, Plus, Cog, Dot, Swatch, Finder, Sorter, Form, Field, Skeleton, Notice, Banner, Link, Spec,
        Empty, Note, Mono, Muted, Kv, KvRow, Part, PartWhy, Group, Head, Markdown, Code, Diff, Term, ask
    } = theme;

    //NAMED Shelf RATHER THAN Group, and the rename is the point. The theme now
    //provides a `Group` of its own -- a section inside a pane -- and two things
    //with one name in one file is precisely the confusion this catalogue exists
    //to prevent. The local one is a shelf in a shop: it holds the exhibits.
    function Shelf({ title, about, children }) {
        return (
            <Panel>
                <CardTitle>{title}</CardTitle>
                {about ? <CardSub>{about}</CardSub> : null}
                <div style={{ marginTop: '10px' }}>{children}</div>
            </Panel>
        );
    }

    //A TERMINAL IS WRITTEN INTO RATHER THAN RENDERED FROM A PROP, which is the
    //whole shape of the component and the reason this exhibit needs a ref at all.
    //Output arrives in chunks and is APPENDED; a `text` prop would re-render on
    //every chunk, and re-rendering a terminal throws away the scrollback somebody
    //is reading.
    function TermExample() {
        var term = useRef(null);

        useEffect(function () {
            var t = term.current;
            if (!t) return;

            //WHAT A <pre> WOULD MAKE OF THIS is the point of the exhibit. Every
            //line below carries control sequences: colour, and below it a
            //carriage return that overwrites a line in place. In a <pre> those
            //are garbage characters in the middle of the output somebody is
            //trying to read; here they are what they mean.
            t.write([
                ESC + '[90m$' + ESC + '[0m git push origin fix/the-thing',
                ESC + '[32m ok' + ESC + '[0m    refs/heads/fix/the-thing',
                ESC + '[33m warn' + ESC + '[0m  1 file had trailing whitespace',
                ESC + '[31m fail' + ESC + '[0m  the remote rejected it',
                ''
            ].join(CRLF));

            //A PROGRESS LINE, WRITTEN OVER ITSELF. This is the one a <pre>
            //cannot show at all: it would print four states underneath each
            //other, which is not what the machine said.
            var steps = ['  installing  25%', '  installing  50%', '  installing  75%', '  installing 100%'];
            var i = 0;
            var tick = setInterval(function () {
                if (!term.current) return;
                term.current.write(CR + steps[i]);
                i++;
                if (i >= steps.length) {
                    clearInterval(tick);
                    term.current.write(CRLF + ESC + '[32m  done' + ESC + '[0m' + CRLF);
                }
            }, 700);

            return function () { clearInterval(tick); };
        }, []);

        return <Term ref={term} height="170px" />;
    }

    //A SWITCH KEEPS ITS OWN STATE, which an exhibit has to as well or the thing
    //being catalogued cannot be tried. Everything else on this pane is a picture;
    //these four are the real control.
    function Switches() {
        var [follow, setFollow] = useState(true);
        var [quiet, setQuiet] = useState(false);
        var [lend, setLend] = useState(false);

        return (
            <>
                <Row>
                    <Toggle on={follow} onChange={setFollow}>Follow the log</Toggle>
                    <Toggle on={quiet} onChange={setQuiet}>Quiet hours</Toggle>
                </Row>
                <Note>
                    A switch is a STATE somebody sets, not an act somebody performs &mdash; which is why
                    it is not a button. A button says &ldquo;do this now&rdquo; and what comes of it is a
                    thing that happened; a switch says &ldquo;be like this from now on&rdquo;, and you can
                    read how it is set without pressing anything.
                </Note>
                <Row>
                    <Toggle on={lend} onChange={setLend} protect>Lend this machine out</Toggle>
                </Row>
                <Note>
                    Purple means here what it means everywhere: a person&apos;s. It is an
                    <Mono>input</Mono> underneath, so <Mono>windowControls</Mono> reports its label, its
                    kind and which way it is set &mdash; a switch the driver can READ rather than one it
                    flips blind. A protected one withholds its value by the same rule that withholds a
                    token.
                </Note>
                <Row>
                    <Toggle on disabled title="the queue is using it">Lend this machine out</Toggle>
                </Row>
                <Note>
                    Disabled says why in the title, the same as a button. The knob moves AND the track
                    changes colour, because colour alone is the whole message to somebody who cannot see
                    the difference between grey and green, and two pixels of travel is not a difference
                    anybody notices at a glance.
                </Note>
            </>
        );
    }

    //TWO VIEWS OF ONE SUBJECT, and the exhibit has to keep its own pick or the
    //thing being catalogued cannot be tried.
    function ViewsExample() {
        var [look, setLook] = useState('Commits');
        return (
            <>
                <Views names={['Files', 'Commits']} on={look} onPick={setLook} />
                <Note>{look == 'Files'
                    ? 'The same change, read as files.'
                    : 'The same change, read as commits.'}</Note>
            </>
        );
    }

    function Kit() {
        return (
            <Pane>
                <Note>
                    Every piece the theme provides. A pane is written from this and never names a
                    class of its own — see THEME.md for what belongs here and what belongs to a pane.
                </Note>

                {/* THREE COLUMNS, AND WHAT IS IN EACH IS AN ARGUMENT RATHER
                    THAN AN ORDER OF ARRIVAL.

                    The narrow one is a master column, which is a SHAPE — the
                    left-hand side of half the panes in this app — so it stands
                    alone rather than being a piece.

                    The middle is the small vocabulary: marks, controls, fields,
                    and the sentences the app says. `The gate` and the purple
                    marks are one idea in two halves — the gate is what opens
                    before an act that cannot be taken back, purple is what says
                    the act is a person's — so the purple controls sit with the
                    ordinary ones of their own kind, and `Colors` says what the
                    colour means once for all of them.

                    The wide one is arrangements and surfaces: how a pane is laid
                    out, and the three things that show somebody else's bytes.

                    AND THEY ARE LEVELLED ON PURPOSE. This was ten shelves against
                    four, so the middle column ended a third of the way down and
                    the rest of the catalogue was a single column with a wide
                    empty space beside it. A catalogue nobody scrolls to the
                    bottom of is a catalogue whose last few entries do not exist.
                    Moving something here means checking the two still end near
                    each other. */}
                <Cols>
                    <Col narrow>
                        <TitleRow>A master column<Grow /><Plus title="what the + looks like" /></TitleRow>
                        <Finder value="" onChange={function () { }} placeholder="find a thing" />
                        {/* WHICH OF IT, AND IN WHAT ORDER — two questions, two
                            shapes. Several chips can be on at once; exactly one
                            entry of the sorter is. */}
                        <Sorter value="newest" onChange={function () { }}
                            options={[['newest', 'newest first'], ['oldest', 'oldest first'], ['kind', 'by kind']]} />
                        <Chips>
                            <Chip count={4} on>picked</Chip>
                            <Chip count={11}>another</Chip>
                            <Chip count={0}>none</Chip>
                        </Chips>
                        <Stack>
                            <Card pick><CardTitle><Mono>pickable</Mono></CardTitle><CardSub>hover changes the border</CardSub></Card>
                            <Card pick on><CardTitle><Mono>chosen</Mono></CardTitle><CardSub>accent border, lighter ground</CardSub></Card>
                            <Card warn><CardTitle><Mono>the surprising case</Mono></CardTitle><CardSub>a bar down the left</CardSub></Card>
                            <Card><CardTitle>plain<Grow /><Cog title="appears on hover" /></CardTitle></Card>
                        </Stack>
                    </Col>

                    <Col>
                        <Shelf title="Colors" about="every colour the theme has a name for, shown as itself">
                            <Row>
                                <Swatch token="bg" is="the page" />
                                <Swatch token="panel" is="a panel on it" />
                                <Swatch token="panel-2" is="a panel inside one" />
                                <Swatch token="line" is="every border" />
                            </Row>
                            <Row>
                                <Swatch token="text" is="what is written" />
                                <Swatch token="muted" is="said quieter" />
                                <Swatch token="accent" is="a link, a chosen row" />
                            </Row>

                            {/* THE THREE THAT ANSWER &ldquo;HOW IS IT DOING&rdquo;. */}
                            <Row>
                                <Swatch token="ok" is="it worked" />
                                <Swatch token="warn" is="worth reading" />
                                <Swatch token="fail" is="it did not" />
                            </Row>
                            <Note>
                                Green, amber and red are the only three that answer <em>how is it
                                doing</em>. Everything else on this shelf is furniture, and purple
                                answers a different question entirely.
                            </Note>

                            {/* AND THE THREE THAT ARE ONE HEX. */}
                            <Row>
                                <Swatch token="running" is="something is happening now" />
                                <Swatch token="human" is="a person&apos;s press" />
                                <Swatch token="guarded" is="attached to the old app" />
                            </Row>
                            <Note>
                                The same purple, under three names on purpose &mdash; so that changing
                                one of the three meanings cannot silently change the other two. It does
                                not say <em>how is it doing</em>; it says <em>is this yours</em>. The
                                test for a fourth one is never &ldquo;is it important&rdquo;, because
                                everything on a dashboard is important to somebody.
                            </Note>
                        </Shelf>
                        <Shelf title="The dot" about="a state as a mark, small enough to sit in front of a row">
                            <Row>
                                <Dot tone="ok" title="working normally" />
                                <Dot tone="guarded" title="attached to the dashboard being ported from" />
                                <Dot tone="fail" title="this window cannot reach its own server" />
                            </Row>
                            <Note>
                                Three sizes of news and no words. It is the smallest thing here that
                                says anything, which is why it can go where a badge cannot.
                            </Note>

                            {/* IN FRONT OF A ROW, WHICH IS WHAT IT IS FOR AS
                                MUCH AS THE CORNER. A badge needs a word and a
                                place to put it; a dot needs neither, so a list
                                can carry one per row without the rows growing.

                                IT DID NOT USED TO SIZE HERE. `.dot` is a span
                                with a width, and width does nothing to an
                                inline one -- in the corner it sizes only
                                because the topbar is a flex row. In front of a
                                line of text it collapsed to nothing. */}
                            <Row>
                                <Mono><Dot tone="ok" title="up" /> ok-runner1</Mono>
                            </Row>
                            <Row>
                                <Mono><Dot tone="guarded" title="a person is in it" /> ok-diy1</Mono>
                            </Row>
                            <Row>
                                <Mono><Dot tone="fail" title="cannot be reached" /> ok-super1</Mono>
                            </Row>
                            <Note>
                                One per row, read down the left. A badge says which state in a word and
                                costs a word&apos;s width; this says it in eight pixels, so a long list
                                can carry it without every row growing to fit.
                            </Note>

                            {/* AND THE CORNER, WHICH IS THE ONE USE THAT IS NOT
                                ABOUT A ROW. */}
                            <Note>
                                In the corner of every screen it is about the whole app rather than a
                                row. Green is this app answering everything itself, which is what the
                                port is FOR. Red is this window unable to reach its own server, the only
                                one that means something is wrong here.
                            </Note>
                            <Note>
                                Purple there is the odd one: it is on while this app is still attached
                                to the dashboard being ported from, and that app is the one thing
                                nothing in this repository may write to. So it is not a status &mdash;
                                nothing is wrong, and MORE works in this state than in the green one.
                                It is the same warning a purple button carries, said about the whole
                                screen at once. It goes away for good when that stops being true.
                            </Note>
                        </Shelf>
                        <Shelf title="Badges" about="a state, in one word">
                            <Badges>
                                <Badge kind="ok">ok</Badge>
                                <Badge kind="bad">bad</Badge>
                                <Badge kind="warn">warn</Badge>
                                <Badge kind="run">happening now</Badge>
                                <Badge kind="muted">muted</Badge>
                                <Badge>plain</Badge>
                            </Badges>
                        </Shelf>
                        <Shelf title="Buttons" about="disable what must not be pressed, and say why in the title">
                            <Row>
                                <Button kind="ok">Confirm</Button>
                                <Button>Plain</Button>
                                <Button kind="danger">Destroy</Button>
                                <Button disabled title="this is why">Not yet</Button>
                            </Row>

                            {/* AND THE ONE THAT IS A PERSON&apos;S. Purple is
                                the one colour that means this is yours: the
                                point of these is that somebody read what it is
                                about and decided, so ../../core/drive will not
                                press one. */}
                            <Row>
                                <Button protect>Merge it</Button>
                                <Button protect kind="danger">Send it</Button>
                                <Button protect disabled title="nothing to send">Send it</Button>
                            </Row>
                            <Note>
                                Refused from the command line even with testing mode on &mdash; testing
                                mode says the window may be driven, not that every press in it may be a
                                model&apos;s.
                            </Note>

                            {/* THE SAME MARK ON A PHRASE, for a sentence that
                                ends in a repair. The trouble banner is a list of
                                sentences and a button planted at the end of one
                                reads as chrome the sentence is wrapped around &mdash;
                                so the weight changes and nothing else does. */}
                            <Row>
                                <Linky protect>Take it back</Linky>
                                <Linky>Read them</Linky>
                            </Row>
                            <Note>
                                A person&apos;s on the left, ordinary on the right. Both are buttons
                                underneath, so both answer to <Mono>windowControls</Mono> and to the
                                keyboard, and the purple one is refused the same way the purple buttons
                                above are. Use it where the act belongs to a sentence rather than to a
                                row of controls.
                            </Note>
                        </Shelf>
                        <Shelf title="Two views of one subject"
                            about="inside a pane — the row above picks the subject, this picks the question">
                            <ViewsExample />
                            <Note>
                                Not a chip: exactly one is on, always, and picking one puts the last one
                                away. Not the tab row either &mdash; that picks WHICH pane, this picks
                                which question about the one you are in.
                            </Note>
                            <Note>
                                The driver presses them by the words on them, like any button. It cannot
                                reach one with <Mono>show --pane</Mono>, because they are not registered
                                with the shell &mdash; <Mono>show</Mono> moves between panes and this is
                                inside one.
                            </Note>
                        </Shelf>

                        <Shelf title="Switches" about="a state somebody sets, not an act somebody performs">
                            <Switches />
                        </Shelf>

                        <Shelf title="The gate" about="every act that cannot be taken back goes through here">
                            <Note>
                                It has to be opened by a person. Nothing in this app can press it — `show`
                                moves the window and does nothing else, which is the same reason it is the gate.
                            </Note>
                            <Row>
                                <Button kind="ok" onClick={function () {
                                    ask({
                                        title: 'A dialog, with nothing behind it',
                                        plain: [
                                            'This is what an irreversible act looks like before it is agreed to.',
                                            'The middle scrolls; the title and the buttons do not.',
                                            'Confirming it does nothing at all.'
                                        ],
                                        cost: 'nothing — this one is a demonstration',
                                        fields: [
                                            { name: 'why', label: 'Why', placeholder: 'a reason', hint: 'where a value comes from is what somebody is missing at the moment they are asked for it' },
                                            { name: 'kind', label: 'A choice', value: 'b', options: [{ value: 'a', label: 'the first' }, { value: 'b', label: 'the second' }] },
                                            { name: 'force', type: 'checkbox', label: 'A tick with consequences', hint: 'and what ticking it actually does, said here rather than found out later' },
                                            { name: 'off', label: 'There and not usable yet', disabled: true, value: '', hint: 'disabled and visible, rather than hidden and appearing one day out of nowhere' }
                                        ],
                                        confirm: 'Do the thing',
                                        onYes: function () { }
                                    });
                                }}>Open a dialog</Button>

                                <Button onClick={function () {
                                    ask({
                                        title: 'A refusal, shown in place',
                                        plain: ['Confirming this throws. The dialog stays open and says why, rather than closing and going quiet.'],
                                        confirm: 'Try it',
                                        danger: true,
                                        onYes: function () { throw new Error('Refused: this is what a refusal looks like, and half of them are the app working correctly.'); }
                                    });
                                }}>A refusal</Button>

                                <Button onClick={function () {
                                    ask({
                                        title: 'Two ways to do one thing',
                                        confirm: 'Go',
                                        tabs: [
                                            { label: 'By name', plain: ['Each tab is rebuilt, not hidden.'], fields: [{ name: 'name', label: 'Name' }], onYes: function () { } },
                                            { label: 'By address', plain: ['So the fields of the tab nobody is looking at cannot decide what gets submitted.'], fields: [{ name: 'addr', label: 'Address' }], onYes: function () { } }
                                        ]
                                    });
                                }}>Tabs</Button>
                            </Row>
                        </Shelf>
                        {/* THE MARKS THAT MEAN A PERSON, and they are the only
                            purple in the app. Everything else here is about
                            reading a state off the screen; these are about what
                            is the person's rather than the program's.

                            THERE ARE FOUR NOW AND THERE WERE THREE. The fourth
                            is the dot at the end, which is not pressable — and
                            that was the argument against it, until the rule was
                            written down properly: purple is a HAZARD MARK, and
                            what it has to do is scream when anything reaches for
                            what it is on. Three of these are one control each.
                            The fourth is the whole screen at once.

                            KEEP THIS LIST HONEST. It is the only place all of
                            them are together, and a purple thing that is not
                            catalogued here makes the sentence above false
                            without making anything fail. */}
                        <Shelf title="Nothing here" about="and nothing here that should not be — two different sentences">
                            <Empty>No line names a branch that is not already a default.</Empty>
                            <Empty bad>No repository here has a default branch, which should not be possible.</Empty>
                        </Shelf>
                        <Shelf title="Fields" about="the same in a pane as in the gate — one set of rules, so they cannot drift">
                            <Form>
                                <Field f={{ name: 'a', label: 'A box' , placeholder: 'type here', hint: 'a hint under it, because where a value comes from is what somebody is missing' }} value="" onChange={function () { }} />
                                {/* THERE AND NOT USABLE YET, which is the case
                                    this preview exists to check. It has to look
                                    unavailable — the pattern is only better than
                                    hiding the field if somebody can tell. */}
                                <Field f={{ name: 'b', label: 'There and not usable yet', disabled: true, hint: 'greyed out and still visible, so it can be found and turned on rather than appearing one day out of nowhere' }} value="" onChange={function () { }} />
                                <Field f={{ name: 'c', label: 'A choice', options: [{ value: 'x', label: 'one' }, { value: 'y', label: 'the other' }] }} value="x" onChange={function () { }} />
                                {/* WHAT THE DOOR WILL REFUSE WITHOUT, marked
                                    before the press rather than after it. Every
                                    refusal in this app is already written and
                                    most are good sentences — but a form whose
                                    faults are only legible once you have pressed
                                    it is one somebody presses three times to
                                    find all of them.

                                    IT IS `--fail` AND NOT PURPLE. Purple means
                                    "this is the person's"; spending it on a
                                    required mark would make that untrue of
                                    every other purple thing on this pane. */}
                                <Field f={{ name: 'e', label: 'One the door refuses without', needed: true, placeholder: 'a red star, not a colour change', hint: 'a real character in a real span — a pseudo-element would be invisible to windowControls, which reads labels to say what is on screen' }} value="" onChange={function () { }} />
                                <Field f={{ name: 'd', type: 'checkbox', label: 'A tick', hint: 'its label goes beside it, not over it' }} value={false} onChange={function () { }} />
                                {/* AND A PERSON&apos;S, WHICH IS THE ONE THAT
                                    WITHHOLDS ITS VALUE. The other purple marks
                                    refuse a press; this refuses a read as well,
                                    because a value written is a value known and
                                    writing is a way of learning that does not
                                    look like reading. */}
                                <Field f={{ name: 'tok', label: 'A field that is yours', protect: true, placeholder: 'typed here and nowhere else', hint: 'neither read nor written from outside — a value written is a value known, so writing is a way of learning that does not look like reading' }} value="" onChange={function () { }} />
                            </Form>
                            <Note>
                                It still appears in <Mono>windowControls</Mono> with its label and whether
                                anything is in it. &ldquo;Is the token set&rdquo; has to be answerable, and
                                it is not the secret.
                            </Note>
                        </Shelf>
                        <Shelf title="Waiting" about="a shape, not the word loading — it holds the layout still">
                            <Skeleton rows={2} sample />
                        </Shelf>
                        <Shelf title="Saying something" about="four different sentences, four different looks">
                            <Empty>nothing here — which is an answer, not a fault</Empty>
                            <Note>a quiet aside</Note>
                            <Note kind="bad">something could not be read</Note>
                            <Notice kind="ok" onClose={function () { }}>it worked</Notice>
                            <Banner kind="stale">what is on screen is out of date</Banner>
                            <Banner kind="testing">testing mode is on — a standing state</Banner>
                            <Banner kind="running">a drill is running right now — a moment</Banner>
                        </Shelf>
                    </Col>

                    <Col wide>
                        <Shelf title="Facts" about="a key and a value, which is most of the right-hand column">
                            <Kv>
                                <KvRow label="a label">a value</KvRow>
                                <KvRow label="code"><Mono>fix/escape-note-id</Mono></KvRow>
                                <KvRow label="a link"><Link href="https://github.com">somewhere else</Link></KvRow>
                                <KvRow label="nothing"><Muted>not known</Muted></KvRow>
                            </Kv>
                            <Spec summary="folded away until asked for">
                                <Kv><KvRow label="inside">the detail nobody needs by default</KvRow></Kv>
                            </Spec>
                        </Shelf>
                        <Shelf title="A list read down, not picked from" about="rows with their facts kept together on the right, and a sentence under one">
                            <Part right={<React.Fragment><Mono>fc60650</Mono><span className="muted">{'→'}</span><span className="mono muted">{'—'}</span><Badge kind="muted">only here</Badge></React.Fragment>}>
                                <Mono>brads/testing2</Mono>
                            </Part>
                            <PartWhy>
                                <span className="ok">Everything on this branch is already in master</span>
                                <span className="muted">{' — the sentence under a row says what to do about it, which the shas above cannot.'}</span>
                            </PartWhy>
                            <Part right={<Badge kind="warn">behind</Badge>}><Mono>fix/csvstat-readme</Mono></Part>
                        </Shelf>
                        <Shelf title="A section, and its heading" about="the muted parts beside the word stay in normal case — a path in capitals is a different name to the eye">
                            <Group>
                                <Head>
                                    <span>Issues</span>
                                    <span className="muted">on bm-sandbox-b/local-repo-a</span>
                                    <span className="muted">11 hours ago</span>
                                </Head>
                                <Note>What sits under a heading like that.</Note>
                            </Group>
                        </Shelf>
                        <Shelf title="Markdown, where it can do nothing" about="an iframe that renders a self-contained document and reaches nothing outside it">
                            {/* SELF-CONTAINED IS THE WHOLE CONTRACT. The frame
                                carries `default-src 'none'` with two exceptions,
                                and they are exactly what a document that brings
                                everything with it needs: `style-src
                                'unsafe-inline'` for its own <style>, and
                                `img-src data:` for a picture written into the
                                markdown rather than fetched.

                                The image below is a data: URI and renders. A
                                <script>, an inline handler, a remote <img> or a
                                webfont would each be refused -- which is the
                                point, because this text came off a machine
                                running a script somebody wrote, and `marked`
                                passes raw HTML straight through by design.

                                THIS EXHIBIT USED TO PROVE THAT BY CARRYING A
                                REAL SCRIPT AND A REMOTE IMAGE. It did prove it
                                -- the browser refused all three -- but it logged
                                three CSP violations every time anybody opened
                                this pane, and a guard that shouts on every
                                render is one people learn to scroll past. The
                                proof belongs in a test, not in the catalogue. */}
                            <Markdown height="300px" text={[
                                '## What a pull request would say',
                                '',
                                'Composed from **real facts**, not placeholders.',
                                '',
                                '- cut from `master` at `a1b7432e`',
                                '- links to the others show `?` until the cut exists',
                                '',
                                '> Everything it needs, it brings. Nothing it draws is fetched.',
                                '',
                                '![a picture written into the document](data:image/svg+xml;utf8,<svg%20xmlns="http://www.w3.org/2000/svg"%20width="140"%20height="24"><rect%20width="140"%20height="24"%20rx="4"%20fill="%232ea043"/><text%20x="70"%20y="16"%20font-family="sans-serif"%20font-size="11"%20fill="white"%20text-anchor="middle">self-contained</text></svg>)'
                            ].join('\n')} />
                        </Shelf>
                        {/* THE THREE SURFACES THAT SHOW SOMEBODY ELSE'S BYTES,
                            and each is its own plugin with its own vendor
                            folder — ../markdown, ../editor, ../xterm. They are
                            catalogued together because the question they answer
                            is one question: this text was not written by this
                            app, and a person has to be able to READ it. */}
                        <Shelf title="Code, where it is read and not written"
                            about="a pre is what somebody scrolls past and approves anyway">
                            <Code mode="javascript" text={[
                                "//what a job looks like in the dialog that asks you to approve it",
                                "module.exports = async function ({ run, say }) {",
                                "    const { stdout } = await run('git status --porcelain');",
                                "    if (stdout.trim()) throw new Error('the tree is not clean');",
                                "    say('nothing to commit, so nothing to push');",
                                "};"
                            ].join('\n')} />
                            <Note>
                                Read-only in four ways, not one: the content is not editable, the cursor is
                                hidden so it does not invite one, the active-line highlight is off for the
                                same reason, and the syntax worker never starts. Nothing here is a place to
                                write code and it should not look like one for a moment.
                            </Note>
                            <Note>
                                It sizes to its content rather than scrolling inside a page that already
                                scrolls &mdash; a hundred lines behind an inner scrollbar is a hundred
                                lines nobody reads. <Mono>tall</Mono> puts a lid on it, which is what a
                                ten-thousand-line diff needs and a job&apos;s script does not.
                            </Note>
                            <Note>
                                The same component draws the <strong>Source</strong> view of the markdown
                                above &mdash; that toggle swaps a frame for one of these in
                                <Mono>markdown</Mono> mode, with a lid on it. Two configurations of one
                                thing, catalogued here because it is a member of the kit rather than a
                                detail of that exhibit.
                            </Note>
                            <Note>
                                The default mode is <Mono>text</Mono>, deliberately. Most of what this app
                                puts up to be read is prose &mdash; a contract, a prompt, a brief &mdash;
                                and highlighting prose as JavaScript colours <Mono>delete</Mono>,
                                <Mono>do</Mono> and <Mono>in</Mono> at random. On a contract about what a
                                judge may not do, that is false emphasis on the one document somebody has
                                to read every line of.
                            </Note>
                        </Shelf>
                        {/* AND THE OTHER HALF OF THE SAME ARGUMENT. `Code`
                            answers "what does this say"; this answers "what is
                            DIFFERENT about it", and every approval in this app
                            is the second question wearing the first one's
                            clothes. */}
                        <Shelf title="A difference, where a decision hangs on it"
                            about="reading two documents and spotting the changed line yourself is how a change gets approved unread">
                            <Diff mode="markdown" height={260}
                                left={[
                                    '## What it may do',
                                    '',
                                    '- read the queue, and say what it thinks',
                                    '- ask for a judgement on a branch it has read',
                                    '- commission work, once, with a reason',
                                    '',
                                    '## What it may never do',
                                    '',
                                    '- push to a branch line',
                                    '- merge anything'
                                ].join('\n')}
                                right={[
                                    '## What it may do',
                                    '',
                                    '- read the queue, and say what it thinks',
                                    '- ask for a judgement on a branch it has read',
                                    '- commission work, with a reason it can point at',
                                    '- propose a change to this document',
                                    '',
                                    '## What it may never do',
                                    '',
                                    '- push to a branch line',
                                    '- merge anything'
                                ].join('\n')} />
                            <Note>
                                What is served is on the left and it is <strong>never</strong> editable,
                                in either job &mdash; what is being judged is the change <em>from</em> the
                                left, so a left that can be edited is a difference that can be made to say
                                anything.
                            </Note>
                            <Note>
                                It takes a definite <Mono>height</Mono> rather than sizing to its content,
                                which is the one way it differs from <Mono>Code</Mono> above. The bands and
                                connectors are drawn absolutely, so a box sized by what is in it gives them
                                nothing to sit inside and the whole thing collapses to nothing at all.
                            </Note>
                            <Note>
                                <Mono>editable</Mono> turns the right side into a place to resolve a change
                                rather than only look at one, and grows the copy arrows in the gutter. Same
                                component, because it is the same geometry &mdash; the difference is whether
                                anything may move.
                            </Note>
                        </Shelf>
                        <Shelf title="A terminal, which is not text"
                            about="what comes back from a machine is drawing instructions, not a string">
                            <TermExample />
                            <Note>
                                Every line above carries control sequences, and the progress line is
                                written over itself with a carriage return. A <Mono>&lt;pre&gt;</Mono>
                                would print four states underneath each other with the escapes showing as
                                garbage &mdash; which is not what the machine said. This app learned that
                                from the other end once already: a sign-in URL scraped out of a pty
                                arrived wrapped and doubled because nothing had stripped them.
                            </Note>
                            <Note>
                                Written into through a ref rather than rendered from a prop. Output
                                arrives in chunks and is appended, and re-rendering a terminal throws away
                                the scrollback somebody is reading.
                            </Note>
                            <Note>
                                No native module and no pty on this side &mdash; <Mono>ssh -tt</Mono>
                                allocates one on the machine at the far end, which is where the shell
                                actually is. Nothing here opens a connection: it is a surface, and the
                                relay that would carry bytes to it is not built yet.
                            </Note>
                        </Shelf>
                    </Col>
                </Cols>
            </Pane>
        );
    }

    return Kit;
};
