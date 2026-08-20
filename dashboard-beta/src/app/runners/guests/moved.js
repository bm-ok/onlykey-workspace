var React = require('react');

//---------------------------------------------------------------------------
//where the sign-ins went.
//
//A SIGNPOST AND NOT A REDIRECT. This could send somebody straight to Keys the
//moment they land here, and that would be worse: they would arrive somewhere
//they did not ask for, with no account of why, and learn nothing. Told where it
//went, they know for next time.
//
//IT ASKS NOTHING. The panes this replaces read `guests` every fifteen seconds
//and `vmList` every thirty. A signpost that polls is a signpost with a running
//cost, and the app being ported from names this exact mistake in its own version
//of this card — the panel left behind went on asking for a credential it no
//longer owned.
//
//SO IT IS PURE. No `okc.use`, no state, no effect. It renders the same thing
//every time and can sit on a tab nobody opens for a month at no cost at all.
//---------------------------------------------------------------------------

module.exports = function moved(theme, shell) {
    var { Pane, Panel, Badge, Note, CardTitle, Button } = theme;

    return function Moved() {
        return (
            <Pane>
                <Panel>
                    <CardTitle>
                        Claude sign-ins <Badge kind="ok">moved</Badge>
                    </CardTitle>

                    <Note>
                        They are under <b>Keys</b> now, split three ways by what they are
                        for — Claude Worker, Claude Judge and Claude supervisor.
                    </Note>

                    {/* WHY, AND NOT ONLY WHERE. A move with no reason on it is one
                        somebody undoes six weeks later having reasoned their way
                        back to the arrangement it replaced. */}
                    <Note>
                        A sign-in is a credential before it is anything to do with a
                        machine: it is kept whether or not a machine exists, it outlives
                        every machine it is lent to, and what you ask of it — whose
                        account, when the secret was last refreshed, whether it still
                        signs in — is what you ask of the GitHub token beside it.
                        A machine is where one goes; it is not what one is.
                    </Note>

                    {/* Through the shell rather than by setting what the shell reads,
                        so there is one path into a pane and it is the one a person
                        uses. The same argument the old window makes for clicking its
                        own tab elements rather than assigning the variables behind
                        them. */}
                    <Button kind="ok" onClick={function () { shell.go('Keys', 'Claude Worker'); }}>
                        Open Keys
                    </Button>
                </Panel>

                <Note>
                    Lending one to a machine and taking it back is still done from the
                    sign-in, not from the machine — the machine is what it is lent to.
                </Note>
            </Pane>
        );
    };
};
