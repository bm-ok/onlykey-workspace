Each of these costs one waking — the meter says ~$0.83–0.98 a turn — so pick rather than run them all. Ordered by what they'd teach per pound.

1. The harvest rule — no machine, tests the thing I just built
```
you have a new instruction about findings a judge made that nobody asked for. go back through J37, J38 and J39, read what they handed back, and put anything worth keeping on the todo list naming the judgement it came from. dont queue any work off them.
```

Good answer: two or three todos citing J37/J38/J39, including the server.js:96-102 one. Bad answer: it adds nothing, or it queues a task anyway — the brake is a paragraph in the skill, not code, so that's the thing worth watching.

actual response:
```
Nothing has moved since the last waking: no tasks or judgements queued or running, all three default branches match origin, and GitHub is reachable again after the 07:30–07:40 outage — PR #13 is still open at the same head 8e0e268, so nothing to re-judge. I closed T3 off the list, since J39 settled it: local-repo-c (csvstat, 77-line CLI, zero dependencies, 44 passing tests) has nothing local-repo-a or -b would use, so integrating it isn't worth doing. That leaves one thing, and it's yours: PR #13, which I've already reported NO on — and T2, worth asking the author which caller actually passes a string id before anyone rewrites that coercion.
```

what it meant: a fair negative, and mostly the rule's fault rather than its own.

- delivered — the bookmark moved to n63 at 15:17:22, so it read the message
- the skill refreshed cleanly — no okc-skill-stale, so it had the rule
- it called `judging`, saw J37/J38/J39, and never opened `judgementFindings`

The rule said "every time you read what a judgement handed back" — that is the
moment one LANDS. Those three landed days ago and are `done` with verdicts
recorded, which makes them invisible to a loop built around what changed since
last waking. Correct by the rule as written; the asides were lost by being old
rather than by being unimportant.

Not a wasted turn: it closed T3 off J39's answer, with the reasoning, which is
the todo-as-memory loop working.

changed since (509aceb): the skill now names the backlog — "if you have never
done this for a judgement you can see, do it once, oldest first, and say which
ones you went back over", and "a request to go back over specific ones is this,
even where you have looked before".

worth re-running verbatim. if it still does not harvest with that clause in
front of it, the problem is 24,000 characters of skill rather than the wording —
which is the more useful thing to know before spending a machine on 2.

response 2
```
I under-answered you at 15:18 — I reported the board instead of doing what you asked, so I've now read all three findings in full and put the unasked-for parts on the list, each naming its judgement, with nothing queued off them. T4 (J37): if #13 lands as written the store's three id methods disagree — update goes through get so it changes too, remove still compares raw, so remove('3') silently 404s, and no test covers any of it. T5 (J38's own "worth writing down for whoever reads this next"): the strict === is protected solely by local-repo-a/src/server.js:96-102 — local-repo-b's Number() at public/app.js:78 is thrown away by URL interpolation a line later — so anyone dropping that guard breaks every id lookup from the UI at once. T6 (J39, explicitly "not filed"): csvstat's toRecords omits the problems key on empty input, harmless today because bin/csvstat.js:67 writes problems || [], but a trap for any second caller. One thing I deliberately did not file: J39 also noticed the stale README example in local-repo-c — that is already fixed and sitting in open PR #3, so it needs merging rather than listing.
```

2. Which chain it picks — costs a machine boot
```
check this claim: in local-repo-a, the only thing stopping a non-integer id reaching Store is the check in src/server.js around lines 96-102. if that check went, everything downstream would silently look up nothing.
```
Nicely circular — that claim is J38's aside, so it closes the loop. The test is whether it reaches for check-a-claim-and-say-what-else over check-a-claim with both offered, and whether the Also noticed section comes back with something real or padded.

3. Your strictness question, asked of the thing that would know
```
whats stopped you lately? name anything you tried that was refused, or wanted to do and couldnt find a way to. i want to know if the api is too narrow or just incomplete.
```
It has real material — the gate refusal, the judging --ref local-repo-a#13 refusal at 07:45, the two-names problem.

4. The memory hole, measured rather than argued
```
without looking anything up: what standing instructions do you think ive given you? things i said once that still apply.
```
Whatever it lists is what survived; whatever it misses is behind the bookmark. That's the pinned-messages question answered with evidence instead of my reasoning.

5. Housekeeping, cheap — SPENT: #13 was closed by hand on 18 Aug, so ask it
   what is outstanding instead of naming that one.
```
anything outstanding you want off your plate before i pick the next thing? i closed #13.
```
I'd send 1 first — it's the only one testing code written since it last woke, and it's the loop you described wanting. Then 2 if 1 looks right, since that's the one that spends a machine.

