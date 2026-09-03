# Purple, and the wire

One colour in the theme answers a different question from all the others.
Every other colour says *how is it doing*; purple says *is this mine*.

## The marks

Every call into the action table carries where it came from:

| mark | who |
|---|---|
| (none) | a person at the window |
| `_overTheWire` | not the window — the local named pipe, or a machine's own door |
| `_fromMachine` | **a machine**, and it carries which one |
| `_driven` | the window being steered by a drill (`windowClick`, `windowFill`) |
| `_fromTest` | a unit test, allowed where a person is |

`_overTheWire` alone is **not** "a model asked". It is stamped by two very
different callers — `core/ipc` puts it on the local pipe, and
`supervisor/guestapi` puts it on a supervisor's request — and only the second
also stamps `_fromMachine`. A rule that means *a caller who cannot see the code*
reads `_fromMachine`; a rule that means *not the window* reads `_overTheWire`.

Neither can be forged. Both doors drop every key beginning with `_` off what
arrives before setting their own, so a machine cannot sign its call as a person
or as another machine.

A refusal reads the marks and says why. The rule is written once, in the
action, and the button that would press it is purple.

**There is no complete list any more, and there used to be.** Settings → Kit had
a Guarded shelf that claimed to be one. The shelf is gone — the purple exhibits
live on the Buttons shelf now — and with it went the claim. About nineteen
controls are purple across ten panes; a purple thing that nobody has written
down is no longer a sentence made false, because the sentence is not there.

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

## The command line is a person

`node tools/okc.js` talks to the running app over a **local named pipe**. No
machine can reach it: a supervisor comes in through `POST /supervisor/do` over
HTTPS, with its own token, and a worker or a judge through the guest API. The
pipe is somebody sitting at this computer, inside the workspace, able to read
every file the app can.

**This page said the opposite, and the app agreed with it.** The old text ran:
*the model working at the command line gets exactly what a machine gets, and a
rule that holds for one holds for the other.* That was true when the pipe WAS
how a supervisor drove the app. It stopped being true the day the supervisor
moved into its own VM with its own door, and nothing came back to either the
code or this page.

What was left refused the person along with the model. `taskCreate` told whoever
typed it *"you cannot see the code, so a task written without a judgement is work
commissioned from a rumour"* — a sentence written about a supervisor, delivered
to somebody with the repository open in front of them.

So the rules that mean **a caller who cannot see the code** ask `_fromMachine`
now. The supervisor meets exactly the refusals it met before; the window and the
command line are the same person, which is what they are.

**A rule that means "not a person" still reads `_overTheWire`**, and those are
different rules: approving a job, releasing a draft reply, switching the drills
on. Those are about a press being somebody's to make, and a drill or a script is
not that either.
