var React = require('react');
var { useState, useEffect } = React;

//---------------------------------------------------------------------------
//the Guards pane: everything that can be guarded, and what a person decided.
//
//THE LIST IS NOT THIS PANE'S. It belongs to the plugin, because the theme and
//the driver read it on every button they draw and every press they refuse --
//see ./window.js, which owns it and provides it as a service. This file only
//shows it and offers the switch, and is handed the service to read through.
//
//THAT SPLIT IS THE POINT. A pane is a way of looking at something; when the
//pane also OWNS the thing, the two cannot be told apart and the answer moves
//when the pane is not mounted.
//---------------------------------------------------------------------------

module.exports = function guards(theme, okc, service) {
    var {
        Pane, Panel, Cols, Col, Stack, TitleRow, Grow, Card, CardTitle, CardSub,
        Badge, Button, Empty, Note, Mono, Skeleton, Finder, Chips, Chip, ask
    } = theme;
    var key = service.key;
    var guarded = service.guarded;
    var reload = service.reload;

    //---- the pane ----------------------------------------------------------

    function Guards() {
        var [g, setG] = useState(null);
        var [err, setErr] = useState(null);
        var [seen, setSeen] = useState(null);
        var [find, setFind] = useState('');
        var [only, setOnly] = useState(null);

        async function refresh() {
            try {
                var got = await reload();
                setG(got);
                setErr(null);
                //WHAT IS ACTUALLY ON THE SCREEN, asked of the same reader the
                //command line uses. A list of guards with nothing to attach
                //them to is a list somebody has to already know the answers
                //for; this makes the pane a catalogue of what CAN be guarded,
                //which is the question "where do I need one" is really asking.
                //Recording what is here is `windowControls`' own job now — see
                //../drive/server.js. Every look by anything fills the list, so
                //this pane no longer describes only the screen it is standing on.
                setSeen(await okc.call('windowControls', {}));
            } catch (e) { setErr(e.message); }
        }
        useEffect(function () { refresh(); }, []);

        if (err && !g) return <Pane><Note kind="bad">{err}</Note></Pane>;
        if (!g) return <Pane><Skeleton rows={3} /></Pane>;

        //Everything the person changed, plus everything visible right now.
        var here = (seen && seen.on) || null;
        var rows = [];
        var add = function (label, kind, where, proposed) {
            var k = key(label);
            if (rows.some(function (r) { return r.k == k; })) return;
            rows.push({ k: k, label: label, kind: kind, where: where, proposed: proposed, on: guarded(label, proposed) });
        };

        (seen ? seen.buttons || [] : []).forEach(function (b) {
            //Neither of these is an act. Choosing a row in a list changes what
            //the pane is about; pressing a tab changes what is on the screen.
            //Guarding either would stop somebody looking at something, which is
            //not what a guard is for.
            if (b.picks || b.nav) return;
            add(b.label, 'button', here, b.protected);
        });
        (seen ? seen.fields || [] : []).forEach(function (f) { add(f.label, 'field', here, f.protected); });
                //`proposed` COMES BACK WITH IT, or a guard the app proposes would read
        //as open on every pane except the one it lives on — which is exactly the
        //row somebody is looking for.
        (g.seen || []).forEach(function (x) { add(x.label, x.kind || 'button', x.where, !!x.proposed); });
        (g.on || []).forEach(function (x) { add(x.label, 'somewhere', x.where, false); });
        (g.off || []).forEach(function (x) { add(x.label, 'somewhere', x.where, true); });

        var shown = rows.filter(function (r) {
            if (find && r.label.toLowerCase().indexOf(find.toLowerCase()) < 0) return false;
            if (only == 'on') return r.on;
            if (only == 'off') return !r.on;
            return true;
        });

        function toggle(r) {
            var want = !r.on;
            ask({
                title: (want ? 'Guard' : 'Stop guarding') + ' "' + r.label + '"?',
                plain: want
                    ? ['Nothing outside this window will be able to press it. It turns purple, so the mark and the rule stay the same thing.',
                        'The command line can still see it and is told why it was refused.']
                    : ['Anything driving this window will be able to press it, including a model, once testing mode is on.',
                        r.proposed ? 'This one is guarded by the app itself. Turning it off is overruling that, and it stays off until you turn it back on.' : null],
                cost: want ? null : 'A press nobody agreed to is exactly what this was stopping.',
                confirm: want ? 'Guard it' : 'Turn the guard off',
                danger: !want,
                onYes: async function () {
                    await okc.call('guardSet', { where: r.where || '*', label: r.label, on: want });
                    await refresh();
                }
            });
        }

        var counts = { on: rows.filter(function (r) { return r.on; }).length, off: rows.filter(function (r) { return !r.on; }).length };

        return (
            <Pane>
                {err ? <Note kind="bad">{err}</Note> : null}
                <Cols>
                    <Col narrow>
                        <TitleRow>Guards<Grow /><span className="muted">{counts.on}</span></TitleRow>
                        <Finder value={find} onChange={setFind} placeholder="find a button or field" />
                        <Chips>
                            <Chip on={only == 'on'} count={counts.on} onClick={function () { setOnly(only == 'on' ? null : 'on'); }}>guarded</Chip>
                            <Chip on={only == 'off'} count={counts.off} onClick={function () { setOnly(only == 'off' ? null : 'off'); }}>open</Chip>
                        </Chips>
                        <Stack>
                            {shown.length ? shown.map(function (r) {
                                return (
                                    <Card key={r.k}>
                                        <CardTitle>
                                            <Mono>{r.label}</Mono>
                                            {r.on ? <Badge kind="run">guarded</Badge> : <Badge kind="muted">open</Badge>}
                                        </CardTitle>
                                        <CardSub>
                                            {r.kind + (r.where ? ' on ' + r.where : '')}
                                            {r.proposed && !r.on ? ' — the app guards this one; you turned it off' : ''}
                                            {!r.proposed && r.on ? ' — you added this one' : ''}
                                        </CardSub>
                                        <div className="row" style={{ marginTop: '6px' }}>
                                            <Button onClick={function () { toggle(r); }}>
                                                {r.on ? 'Turn the guard off' : 'Guard it'}
                                            </Button>
                                        </div>
                                    </Card>
                                );
                            }) : <Empty>nothing matches</Empty>}
                        </Stack>
                    </Col>

                    <Col wide>
                        <Panel>
                            <CardTitle>What a guard is</CardTitle>
                            <Note>
                                Purple means a person. A guarded <strong>button</strong> can be seen from
                                the command line and not pressed; a guarded <strong>field</strong> is
                                neither read nor written from outside. Testing mode says the window may be
                                driven — it does not say every press in it may be a model&apos;s, and that
                                is the difference a guard makes.
                            </Note>
                            <Note>
                                The app proposes guards on the presses it thinks are yours. Only what you
                                change is stored, so a guard added to the app later takes effect rather
                                than being silently left open by an old saved list.
                            </Note>
                            <Note kind="warn">
                                Guards are read from anywhere and set here. A guard the command line could
                                move would be one call away from nothing, and every refusal behind it would
                                become a refusal you have to trust was not unlocked first.
                            </Note>
                            <Note>{'kept in ' + g.file}</Note>
                            {/* WHAT THIS PANE CANNOT SEE, said rather than left
                                to be discovered: the list of controls is what is
                                on screen NOW, read from the window the same way
                                the driver reads it. A button on a pane nobody
                                has opened is not here yet. Guards already set
                                are always listed, wherever they were set. */}
                            <Note>
                                The list on the left is what is on screen now, plus every guard you have
                                already set. Open a pane to see what it offers.
                            </Note>
                        </Panel>
                    </Col>
                </Cols>
            </Pane>
        );
    }

    return Guards;
};
