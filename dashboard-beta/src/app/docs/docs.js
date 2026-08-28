var React = require('react');
var { useState, useEffect } = React;

//---------------------------------------------------------------------------
//THE DOCS PANE: pages on the left, one page on the right, read or edited.
//
//THE SHAPE IS ../repositories/pr/pr-cut.js's: peer columns, the narrow one a
//list of cards, the wide one the picked thing whole. The picked page is
//remembered by name, so the inbox and the next visit land on it.
//
//READ IS THE DEFAULT AND EDIT IS A MODE, because most visits are to read. In
//Edit the page is the editor's, and Save carries the stamp docRead gave so a
//page the command line rewrote meanwhile is refused rather than overwritten.
//---------------------------------------------------------------------------

module.exports = function docs(theme, okc, remember, markdown) {
    var { Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Badges, Button, Empty, Note, Notice, Skeleton, Editor, Finder, ask } = theme;
    var Frame = markdown.Frame;

    function ago(when) {
        if (!when) return '';
        var s = Math.max(0, Math.round((Date.now() - new Date(when).getTime()) / 1000));
        if (s < 60) return 'just now';
        if (s < 3600) return Math.round(s / 60) + ' minutes ago';
        if (s < 86400) return Math.round(s / 3600) + ' hours ago';
        return Math.round(s / 86400) + ' days ago';
    }

    function folderOf(name) {
        var at = String(name).lastIndexOf('/');
        return at < 0 ? '' : name.slice(0, at);
    }

    function Reading({ name, list }) {
        var one = okc.use('docRead', { name: name }, 0);
        var [look, setLook] = useState('Read');
        var [draft, setDraft] = useState(null);
        var [said, setSaid] = useState(null);

        //A NEW PICK IS READ, NOT EDITED, and carries no draft from the last one.
        useEffect(function () { setLook('Read'); setDraft(null); setSaid(null); }, [name]);

        if (one.error) return <Panel><Note kind="bad">{one.error}</Note></Panel>;
        if (!one.state) return <Panel><Skeleton rows={6} /></Panel>;
        var page = one.state;
        var writing = draft == null ? page.text : draft;
        var changed = draft != null && draft !== page.text;

        function tell(p) {
            return p.then(function (r) { setSaid({ text: (r && r.note) || 'Done.' }); return r; },
                function (e) { setSaid({ bad: true, text: e.message }); throw e; });
        }

        function save() {
            return tell(okc.call('docWrite', { name: page.name, text: writing, was: page.modified }))
                .then(function () { setDraft(null); setLook('Read'); one.again(); list.again(); }, function () {});
        }

        function remove() {
            ask({
                title: 'Delete "' + page.name + '"?',
                plain: ['The file goes from the docs folder. git still has it until that is committed, so this is undoable there and nowhere else.'],
                confirm: 'Delete it',
                danger: true,
                onYes: function () {
                    return tell(okc.call('docRemove', { name: page.name })).then(function () {
                        remember.write('docs', 'picked', null);
                        list.again();
                    });
                }
            });
        }

        return (
            <Panel>
                <CardTitle>
                    <span className="mono muted">{page.name}</span>
                    <Grow />
                    {changed ? <Badge kind="warn">unsaved</Badge> : null}
                    <span className="muted">{'changed ' + ago(page.modified)}</span>
                </CardTitle>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <div className="row" style={{ marginTop: '6px' }}>
                    {look === 'Read'
                        ? <Button onClick={function () { setLook('Edit'); }}>Edit</Button>
                        : <Button onClick={function () {
                            if (!changed) { setDraft(null); setLook('Read'); return; }
                            ask({
                                title: 'Drop what you typed?',
                                plain: ['The page goes back to what is saved.'],
                                confirm: 'Drop it', danger: true,
                                onYes: function () { setDraft(null); setLook('Read'); }
                            });
                        }}>Read</Button>}
                    {look === 'Edit'
                        ? <Button kind="ok" disabled={!changed} onClick={save}
                            title="Writes the file. Refused if the command line changed it since you opened it.">Save</Button>
                        : null}
                    <Grow />
                    <Button kind="bad" onClick={remove}>Delete</Button>
                </div>

                {look === 'Edit'
                    ? <div style={{ marginTop: '8px' }}>
                        <Editor text={writing} mode="markdown" min={24} max={900} editable onChange={setDraft} />
                    </div>
                    : <div style={{ marginTop: '8px' }}>
                        <Frame text={page.text} height="70vh" />
                    </div>}
            </Panel>
        );
    }

    //A SUITE IS A TOP-LEVEL FOLDER, the way ../tests' suites are folders of
    //drills. Pages at the root belong to the suite called "docs".
    function suiteOf(name) {
        var at = String(name).indexOf('/');
        return at < 0 ? 'docs' : name.slice(0, at);
    }
    function inSuite(name) {
        var at = String(name).indexOf('/');
        return at < 0 ? name : name.slice(at + 1);
    }

    return function Docs() {
        //SEARCH IS THE SERVER'S: titles and bodies, with the lines that match.
        //With a word in the box the pages column is every page that says it,
        //across suites, most said first, and the suites column counts them.
        var [q, setQ] = useState('');
        var list = okc.use('docs', q.trim() ? { q: q.trim() } : {}, 4000);
        var searching = !!(list.state && list.state.q);
        var [suite, setSuite] = remember.use('docs', 'suite', 'docs');
        var [picked, setPicked] = remember.use('docs', 'picked', null);
        var [said, setSaid] = useState(null);

        var pages = (list.state && list.state.docs) || [];
        var suites = [];
        pages.forEach(function (p) { var sname = suiteOf(p.name); if (suites.indexOf(sname) < 0) suites.push(sname); });
        suites.sort(function (a, b) { return a === 'docs' ? -1 : b === 'docs' ? 1 : a.localeCompare(b); });
        //THE SUITE'S README FIRST, then the rest as listed. A suite's front
        //page is the one to read first, whatever letter it starts with.
        var here = pages.filter(function (p) { return searching || suiteOf(p.name) === suite; })
            .sort(function (a, b) {
                var ra = /^README\.md$/i.test(inSuite(a.name)) ? 0 : 1;
                var rb = /^README\.md$/i.test(inSuite(b.name)) ? 0 : 1;
                if (searching) return (b.matches || 0) - (a.matches || 0);
                return ra - rb || inSuite(a.name).localeCompare(inSuite(b.name));
            });
        var known = pages.some(function (p) { return p.name === picked; });

        function makeNew() {
            ask({
                title: 'A new page',
                plain: ['A name inside the docs folder. The first folder is its suite; folders are made as needed, so "guide/setup" becomes guide/setup.md in the guide suite.'],
                fields: [{ name: 'name', label: 'Name', needed: true, placeholder: suite === 'docs' ? 'setup' : suite + '/setup' }],
                confirm: 'Make it',
                onYes: function (f) {
                    var name = String(f.name || '').trim();
                    if (!name) throw new Error('Say what it is called.');
                    var title = name.replace(/\.md$/i, '').split('/').pop();
                    return okc.call('docWrite', { name: name, text: '# ' + title + String.fromCharCode(10, 10) }).then(function (r) {
                        setSuite(suiteOf(r.name));
                        setPicked(r.name);
                        list.again();
                    }, function (e) { setSaid({ bad: true, text: e.message }); throw e; });
                }
            });
        }

        return (
            <Pane>
                <Note>
                    Pages are markdown files in the repository's docs folder — edited here, or by anything with a text
                    editor, and kept by git. A suite is a folder. What is written here is about this app; the work is on the other tabs.
                </Note>
                {said ? <Notice kind={said.bad ? 'bad' : 'ok'} onClose={function () { setSaid(null); }}>{said.text}</Notice> : null}

                <Finder value={q} onChange={setQ} placeholder="find a word in titles and pages" />

                <Cols>
                    <Col narrow>
                        <TitleRow>
                            Suites<Grow />
                            <span className="muted">{list.state ? suites.length : ''}</span>
                        </TitleRow>
                        {list.error ? <Note kind="bad">{list.error}</Note> : null}
                        {!list.state
                            ? <Skeleton rows={3} />
                            : !suites.length
                                ? <Empty>{searching ? 'Nothing says "' + list.state.q + '".' : 'No suites yet.'}</Empty>
                                : <Stack>
                                    {suites.map(function (sname) {
                                        var count = pages.filter(function (p) { return suiteOf(p.name) === sname; }).length;
                                        return (
                                            <Card key={sname} pick on={!searching && sname === suite} onClick={function () { setSuite(sname); }}>
                                                <CardTitle><span className="mono">{sname}</span></CardTitle>
                                                <CardSub><span>{count + (searching ? ' page(s) say it' : ' page(s)')}</span></CardSub>
                                            </Card>
                                        );
                                    })}
                                </Stack>}
                    </Col>
                    <Col narrow>
                        <TitleRow>
                            {searching ? 'Pages that say it' : 'Pages'}<Grow />
                            <span className="muted">{list.state ? here.length : ''}</span>
                        </TitleRow>
                        <div className="row" style={{ marginBottom: '8px' }}>
                            <Button kind="ok" onClick={makeNew}>New page</Button>
                        </div>
                        {!list.state
                            ? <Skeleton rows={4} />
                            : !here.length
                                ? <Empty>{searching ? 'Nothing says "' + list.state.q + '".' : 'No pages in this suite. New page makes the first.'}</Empty>
                                : <Stack>
                                    {here.map(function (p) {
                                        return (
                                            <Card key={p.name} pick on={p.name === picked}
                                                onClick={function () { setSuite(suiteOf(p.name)); setPicked(p.name); }}>
                                                <CardTitle><span>{p.title}</span></CardTitle>
                                                <CardSub><span className="mono">{searching ? p.name : inSuite(p.name)}</span></CardSub>
                                                <Badges>
                                                    {searching ? <Badge kind="ok">{p.matches + ' hit(s)'}</Badge> : null}
                                                    <span className="muted">{ago(p.modified)}</span>
                                                    <span className="muted">{p.bytes + ' bytes'}</span>
                                                </Badges>
                                                {/* WHERE IT SAYS IT, so the page need not be
                                                    opened to know whether it is the one. */}
                                                {searching && p.hits && p.hits.length
                                                    ? p.hits.map(function (h) {
                                                        return <CardSub key={h.line}><span className="muted">{h.line + ': '}</span><span>{h.text}</span></CardSub>;
                                                    })
                                                    : null}
                                            </Card>
                                        );
                                    })}
                                </Stack>}
                    </Col>
                    <Col wide>
                        <TitleRow>Page</TitleRow>
                        {picked && known
                            ? <Reading name={picked} list={list} />
                            : <Panel><Empty>{picked ? '"' + picked + '" is not here any more.' : 'Pick a page, or make one.'}</Empty></Panel>}
                    </Col>
                </Cols>
            </Pane>
        );
    };
};
