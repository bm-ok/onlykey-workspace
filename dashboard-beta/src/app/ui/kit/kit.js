var React = require('react');
var { useRef, useEffect } = React;

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
        Button, Linky, Plus, Cog, Finder, Form, Field, Skeleton, Notice, Banner, Link, Spec,
        Empty, Note, Mono, Muted, Kv, KvRow, Part, PartWhy, Group, Head, Markdown, Code, Term, ask
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
                    and the sentences the app says. `The gate` sits directly above
                    `Guarded` because they are one idea in two halves — the gate
                    is what opens before an act that cannot be taken back, purple
                    is what says the act is a person's — and reading them apart
                    made each look like a detail of something else.

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
                        {/* THE THREE MARKS THAT MEAN A PERSON, and they are the
                            only purple in the app. Everything else here is about
                            reading a state off the screen; these are about who is
                            allowed to act. */}
                        <Shelf title="Guarded" about="purple is the one colour that means: this is yours, not a model's">
                            <Row>
                                <Button protect>Merge it</Button>
                                <Button protect kind="danger">Send it</Button>
                                <Button protect disabled title="nothing to send">Send it</Button>
                            </Row>
                            <Note>
                                A guarded button is refused from the command line even with testing mode
                                on — testing mode says the window may be driven, not that every press in
                                it may be a model&apos;s.
                            </Note>

                            {/* THE SAME GUARD ON A PHRASE, for a sentence that
                                ends in a repair. The trouble banner is a list of
                                sentences and a button planted at the end of one
                                reads as chrome the sentence is wrapped around —
                                so the weight changes and nothing else does. */}
                            <Row>
                                <Linky protect>Take it back</Linky>
                                <Linky>Read them</Linky>
                            </Row>
                            <Note>
                                Guarded on the left, ordinary on the right. Both are buttons underneath,
                                so both answer to <Mono>windowControls</Mono> and to the keyboard; the
                                purple one is refused the same way the purple buttons above are. Use it
                                where the act belongs to a sentence rather than to a row of controls.
                            </Note>
                            <Form>
                                <Field f={{ name: 'tok', label: 'A guarded field', protect: true, placeholder: 'typed here and nowhere else', hint: 'neither read nor written from outside — a value written is a value known, so writing is a way of learning that does not look like reading' }} value="" onChange={function () { }} />
                            </Form>
                            <Note>
                                It still appears in <Mono>windowControls</Mono> with its label and whether
                                anything is in it. &ldquo;Is the token set&rdquo; has to be answerable, and
                                it is not the secret.
                            </Note>
                        </Shelf>
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
                                <Field f={{ name: 'd', type: 'checkbox', label: 'A tick', hint: 'its label goes beside it, not over it' }} value={false} onChange={function () { }} />
                            </Form>
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
