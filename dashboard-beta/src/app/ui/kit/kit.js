var React = require('react');

module.exports = function kit(theme) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Row,
        Card, CardTitle, CardSub, Badge, Badges, Chips, Chip,
        Button, Plus, Cog, Finder, Form, Field, Skeleton, Notice, Banner, Link, Spec,
        Empty, Note, Mono, Muted, Kv, KvRow, Part, PartWhy, Group, Head, Markdown, ask
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

    function Kit() {
        return (
            <Pane>
                <Note>
                    Every piece the theme provides. A pane is written from this and never names a
                    class of its own — see THEME.md for what belongs here and what belongs to a pane.
                </Note>

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

                        {/* THE TWO MARKS THAT MEAN A PERSON, and they are the
                            only purple in the app. Everything else here is about
                            reading a state off the screen; these two are about
                            who is allowed to act. */}
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
                            <Form>
                                <Field f={{ name: 'tok', label: 'A guarded field', protect: true, placeholder: 'typed here and nowhere else', hint: 'neither read nor written from outside — a value written is a value known, so writing is a way of learning that does not look like reading' }} value="" onChange={function () { }} />
                            </Form>
                            <Note>
                                It still appears in <Mono>windowControls</Mono> with its label and whether
                                anything is in it. &ldquo;Is the token set&rdquo; has to be answerable, and
                                it is not the secret.
                            </Note>
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

                        <Shelf title="Nothing here" about="and nothing here that should not be — two different sentences">
                            <Empty>No line names a branch that is not already a default.</Empty>
                            <Empty bad>No repository here has a default branch, which should not be possible.</Empty>
                        </Shelf>

                        <Shelf title="Markdown, where it can do nothing" about="an iframe with a CSP, because this text came off a machine running somebody's script">
                            {/* THE LAST TWO LINES ARE A LIVE ASSERTION, not
                                decoration. They are raw HTML inside the
                                markdown — which `marked` passes straight
                                through, by design — and each says what it will
                                say if the policy holds. If either is ever
                                replaced by the word BROKEN, then
                                `default-src 'none'` has stopped covering
                                script-src and this frame is running somebody
                                else's code inside a page that has node behind
                                it. A comment claiming it is safe cannot fail;
                                this can. */}
                            <Markdown height="360px" text={[
                                '## What a pull request would say',
                                '',
                                'Composed from **real facts**, not placeholders.',
                                '',
                                '- cut from `master` at `a1b7432e`',
                                '- links to the others show `?` until the cut exists',
                                '',
                                '> markdown carries raw HTML through by design, which is why this is in',
                                '> a frame that may not run scripts and may not fetch anything.',
                                '',
                                '<p id="a">a script here does not run</p>',
                                '<scr' + 'ipt>document.getElementById("a").textContent = "BROKEN: the script ran"</scr' + 'ipt>',
                                '<p id="b">nor does an onerror</p>',
                                '<img src="x" width="1" onerror="document.getElementById(&quot;b&quot;).textContent = &quot;BROKEN: the onerror ran&quot;">'
                            ].join('\n')} />
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
                    </Col>
                </Cols>
            </Pane>
        );
    }

    return Kit;
};
