# Purple, and the wire

One colour in the theme answers a different question from all the others.
Every other colour says *how is it doing*; purple says *is this mine*.

## The marks

Every call into the action table carries where it came from:

| mark | who |
|---|---|
| (none) | a person at the window |
| `_overTheWire` | the command line, or anything on the socket — including the model at the command line |
| `_driven` | the window being steered by a drill (`windowClick`, `windowFill`) |
| `_fromTest` | a unit test, allowed where a person is |

A refusal reads the marks and says why. The rule is written once, in the
action, and the button that would press it is purple — the two are the
same list, and the Guarded shelf on Settings → Kit is the complete one.

## What is purple

- **Presses that decide something about somebody's repository**: send a
  reply, close an issue, post a review, land a cut, allow a stranger's pull
  request to be judged, hand an issue to the supervisor, import a bundle,
  delete a page.
- **Approvals**: a job, a prompt, a contract, a skill.
- **Settings that change what goes out in your name or what may run
  here**: the drills, the trusted list, the marker, the three direct
  switches.
- **Keys**: keeping a GitHub token, forgetting a sign-in.

Everything else is one surface: the window, the command line and the next
person use the same actions with the same rules.

## What never crosses the wire

Every answer that leaves the host over the socket — to the window, to
`okc.js`, into a capture — is scrubbed by field name first: `token`,
`password`, `secret`, `passphrase`, `privateKey`, `credential`, and anything
ending in `Token`, `Password` or `Secret` reads `[held]`. The value stays on
the host for the thing that reads it in process. Names that *describe* a
secret — `holdsCredential`, `fingerprint`, `tokenName` — stay, because they
are how you tell that one is held. `test/rules/no-secret-leaves.test.js`
holds the rule; it was written the day `vmList` was found carrying every
machine's bootstrap token out.

## Where the refusal lives

Purple is decided in the code, by `protect` on the control, and nowhere else.

There used to be a Settings → Guards pane that let a person guard any button
or field by the words on it. It predates the agents running in their own
machines: when a model might be driving the window, a refusal painted on a
button was the boundary. It is not any more — each agent reaches this app
through an API, so a refusal belongs there, named by the action. That is what
`allowed.js` is, and it is the page before this one.

## Why the command line is the pipe

`node tools/okc.js` talks to the running app over the same socket a machine
would. That is deliberate: the model working at the command line gets
exactly what a machine gets, and a rule that holds for one holds for the
other. When a page here says "refused from the command line", it means
refused to everything that is not a person.
