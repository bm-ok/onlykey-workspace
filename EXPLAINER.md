OnlyKey ecosystem self-improvement — the why
============================================

This document is about WHY I want this, not how to build it. The how comes
later and changes often; the why is the part that has to stay fixed, because
it's what every later decision gets measured against.


What changed, and why it matters
--------------------------------

For over six years the OnlyKey ecosystem had no way to prove a firmware change
was correct without plugging in real hardware and trying it by hand. The
emulator and the testing kit are the first major additions in all that time,
and together they change the whole game: for the first time there is a way to
run the real firmware, drive it, and get a verdict — pass or fail — with no
device on the desk.

That is the unlock this entire idea rests on. "Improve the ecosystem" used to
be a wish with no gate behind it. Now there's a gate. Everything below is about
turning that gate into a habit.


How I do it today
-----------------

Right now the loop already exists — I just run it by hand.

I keep a VirtualBox VM with the emulator built and running: the NeoPixel, the
six buttons, the HID log, and the real OnlyKey App talking to the emulated
device as if it were plugged in. I SSH into that VM from my editor and run a
Claude session inside it. I point it at the test kit, it grinds through a
section — the protocol suite takes the better part of twenty minutes and comes
back green — and when something is off it finds the actual defect, writes up a
FINDING, fixes the firmware, adds a test that pins the fix, and commits.

It works. I've caught real bugs this way — key material leaking into a slot's
unused tail, an RSA overflow that doesn't kill the device the way it should.
The emulator plus the kit plus a Claude session in a sandbox genuinely finds
and fixes things.

But it's all me, one run at a time, and it lands straight on master across
several repos with nothing standing between the change and the branch. There's
no list of what's worth doing next, no isolation between one job and the next,
no moment where I get to look before it's already committed. The capability is
proven. The discipline around it isn't there yet.


What I want it to feel like
---------------------------

I don't want to babysit each run, and I don't want a firehose that just goes off
and rewrites everything either. I want to stay the one who decides, and hand off
the labor.

So: I ask for a list of tasks — the things worth doing next, the bugs, the gaps,
the drift, whatever the ecosystem can see about itself. I read it. I pick one.
"Fix the next bug." That's the whole interaction on my side.

From there it should spin up on its own: take that one task, bring up a fresh VM
for it, and hand that VM its own Claude session scoped to that single job. The
work happens in there, isolated, while I watch it run live — the way you'd watch
a session play out rather than reading a log afterward. When it's done it comes
back with a branch and something for me to review, not a change already sitting
on master.

And picking a task isn't only ever "fix this known bug." The same machinery is
an experiment bench. Because every attempt runs in its own throwaway sandbox
with the full suite behind it as a real verdict, I can ask it to explore — try a
few different ways to fix the same issue and keep whichever one the tests
actually bless, or prototype a new feature and find out whether it holds up. A
fix I'm unsure about and a direction I'm merely curious about go down the exact
same safe path: try it, get a verdict, keep it or throw the whole VM away.
Isolation plus the gate is what turns experimenting from something risky into
something cheap.

That includes judging someone else's work, not only my own. When a pull request
comes in and reaches the point where I'd otherwise have to sit and manually test
it, I can instead run my own attempt at the same thing in a sandbox and set the
two side by side — same suite, same verdict for both. The gap between what the PR
does and what my try does is where the real review lives: whether it missed a
case, whether it went about it worse or better than I would have, whether there's
room to improve it before it lands. Review stops being "does this look right" and
becomes "here is a second answer to hold it against."


Why this shape, and not another
-------------------------------

Why a list I pick from, instead of full autonomy: because the machine proposing
and me disposing keeps me in charge of direction. I want it to surface the work,
not choose which work matters.
What we get from this: a backlog the ecosystem keeps about itself, so I always
know what's worth doing next without hunting for it — and the priorities stay
mine, not something a model quietly decided for me.

Why one task at a time: because a single scoped job is something I can actually
review and trust. A run that touches ten things at once is a run I have to take
on faith, and faith is exactly what I'm trying to stop relying on.
What we get from this: every change is small enough to read end to end, and
every branch traces back to exactly one intention — so a bad one is obvious at a
glance and cheap to throw away, instead of tangled up with nine good ones.

Why a VM per task: because the sandbox is the only place the full device is
real — the USB side, the App, the whole surface — and because a job that goes
wrong in there can't hurt anything outside it.
What we get from this: a clean, disposable environment for every run where the
device behaves like real hardware, and a blast radius of zero — nothing a job
does can leak onto my machine or bleed into the next task.

Why its own Claude session inside the VM: because the thing that dispatches the
work shouldn't also be the thing doing it. One side hands out the task and
watches; the other side lives in the sandbox with its own context and full
attention on that one job.
What we get from this: the worker spends its whole context on a single problem
while the dispatcher stays free to coordinate and watch — so neither starves the
other, and more than one job can be in flight without their work tangling.

Why watch it: because oversight is the point. I want to see it think and be able
to stop it, not discover after the fact what it decided.
What we get from this: trust earned in real time — I catch a wrong turn while
it's still a turn, before it becomes a commit, instead of auditing the damage
once it's already done.

Why a branch and a review instead of a push to master: because that's the habit
worth building. Today everything I do lands on master directly. The whole reason
to systematize this is so that nothing reaches master without me having looked —
the human gate is the feature, not an inconvenience.
What we get from this: master stays clean by construction, and every merge is a
decision I made on purpose — the ecosystem gets to improve itself without ever
surprising me with a change I didn't approve.

Why every firmware change is minimal, direct, and strict — and why that's not
left to the worker's good judgment: because this is a security device. On a key
that guards someone's credentials, a fix that also reformats, refactors the
function beside it, or leaves a doubtful comment isn't a tidier fix — it's a
larger, riskier change wearing a small one's clothes, and it buries the part a
reviewer actually has to check. The instinct to improve the code it's touching
is the wrong instinct here, and it's a strong one, so the discipline can't ride
on whether a given run happens to feel careful. It's built into how the worker
starts every firmware job — not something I paste in, manage, or police.
What we get from this: what lands on the branch arrives already conservative and
already reviewable — one intention, no churn, comments that state constraints
instead of raising questions, a test that actually ran — so the review catches
intent rather than noise, and the security-critical code only ever moves when it
has to.


These are five things, not one
------------------------------

It's worth being honest that this vision is really five separable pieces, and
they don't carry the same weight or the same cost: the review gate (work on a
branch, nothing straight to master), the baked-in firmware discipline (minimal
and strict, not left to a run's judgment), the self-maintained backlog (it
proposes, I pick), the isolation (a job that goes wrong can't reach past its
sandbox), and the orchestration that spins up workers and lets me watch them
live. The exciting one is the last one. But the compounding payoff this whole
document is chasing rests on only the first two — and those are the cheapest to
get. Every fix carrying a test, and nothing regressing silently, begins the
moment the gate and the discipline exist. It does not wait on the dispatcher,
the live-watching, or a fleet of VMs.

What we get from this: the safety I actually care about can start accruing
before the expensive, most-likely-to-change part is built at all — so the value
never sits hostage to the infrastructure, and the heavy machinery only ever has
to justify itself as a throughput multiplier, not as the thing that makes any of
it work.


The one assumption it all rests on
----------------------------------

Every verdict in this system is measured against the emulator — "the suite is
green," "nothing regressed," "this fix is correct" all mean *correct against the
emulator*. And the emulator is software; it can drift from real silicon. That's
the one thing the whole edifice sits on, and it has a quiet, nasty failure mode:
the harness keeps certifying fixes that are right against the model while the
model slowly diverges from the hardware — and I'd never notice, because the
entire point was to stop plugging in the device.

So the emulator has to be kept honest on purpose. A periodic reconciliation
against real hardware — even manual, even occasional — is a standing ritual, not
a thing that happens when I remember. Without it, "the tests are green" is a
statement about the emulator, not about the OnlyKey, and the gap between those
two is exactly where the danger lives.

What we get from this: naming the assumption out loud gives the trust a floor I
can actually check, instead of a confidence that quietly decays. The loop stays
honest only as long as the oracle it leans on is itself checked against the thing
it stands in for.


A workflow problem, fixed with software
---------------------------------------

Be precise about what kind of thing this is. The problem is a workflow problem —
how fixes get made, tested, reviewed and merged across the ecosystem. But the
solution is not a workflow. It's software. This is a project that CONTROLS the
workflow with software, not a process I write down and try to follow by hand.

That distinction is the spine of everything above. Every guarantee in this plan
comes from software enforcing it — the dashboard mediating every task, the gate
refusing a bad merge, the rules loaded into every worker, the counter that won't
let the oracle go unchecked — not from me remembering to be disciplined. A
documented process decays the first busy week; software that holds the line does
not. So it gets built, tested and versioned like the real project it is — held to
the same standards it holds the firmware to. (These four documents aren't the
workflow; they're the design of the software that runs it.)

Part of building it right is that it has to be operable two ways, not one.

The first way is me driving the whole loop by hand: I pick the task, I watch, I
review, I merge. The second way is an AI driving it — proposing the work,
distributing it to workers, collecting results — with me above it. And that
second way only counts as safe if I keep the same oversight I'd have driving it
myself. So when an AI is the driver, there has to be a monitor dashboard sitting
between it and the workers: a window onto what it's handing to each worker and
what's coming back, where I can watch and step in. Oversight is the feature this
whole document keeps returning to; the dashboard is how that feature survives
handing the wheel to an AI instead of holding it myself.

What we get from this: the loop never forces a choice between "I do everything by
hand" and "I trust a black box." I drive it directly when I want control, hand it
to an AI when I want throughput, and either way the human stays the authority —
because in the AI case the dashboard keeps the AI's task distribution visible
rather than hidden.


Why it's worth building at all
------------------------------

The payoff isn't the fixes. It's that a six-year-old codebase finally gets a
regression harness that grows every time it's used. Every fix from here on
carries a test. Each pass makes the next one safer and cheaper to trust. Do that
long enough and the win isn't any single bug closed — it's that nothing can
regress silently anymore, and I get to be the reviewer of the ecosystem instead
of its only pair of hands.

That's the thing worth building toward. Everything about the how should serve
this, and anything in the how that fights it is wrong.
