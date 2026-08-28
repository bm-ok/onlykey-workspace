# Proving a change

Never conclude from reading the source. Run it, in this order.

    npm run check                         does it compile — both halves, in memory, five seconds
    node --test test/<the file you touched>
    node tools/okc.js windowControls --json   is the app UP: failed null, broke null
    node tools/okc.js show --tab X --pane Y
    node tools/okc.js capture --name n --width 1400   the picture AND the markup
    npm test                              the whole suite — the final gate, two minutes
    npm run walk                          every tab and pane, against the running app

## Look at the picture

`capture` writes a PNG and the rendered DOM. They are different evidence:
a class that matches no rule is invisible in the picture and obvious in
the markup; a value drawn from the wrong field is the other way round. A
stylesheet break — a rule swallowed into a neighbour — passes every test
and shows only in the picture. If the answer says `pages: n`, a stale
browser tab is answering; close it.

## Drive it, do not just show it

`windowClick --text "Send it"` and `windowFill --label ... --value ...`
press and type in the real window while testing mode is on. A change to a
button is proven by pressing it.

## Prove it the way it will be used

The command line is the same surface as the window. A change to an action
is proven by running the action, with the arguments a person would give,
and reading the answer — not by a smoke test that prints something.

## Sabotage each new guard once

Remove the refusal, run the test, see it go red, put it back. A guard whose
test does not go red when the guard is gone is guarding nothing.

## Then commit

At a checkpoint, without being asked. The message says what was wrong,
what it cost, and what changed — the why lives in the message, because six
weeks on it is the only record.
