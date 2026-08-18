Each of these costs one waking — the meter says ~$0.83–0.98 a turn — so pick rather than run them all. Ordered by what they'd teach per pound.

1. The harvest rule — no machine, tests the thing I just built
```
you have a new instruction about findings a judge made that nobody asked for. go back through J37, J38 and J39, read what they handed back, and put anything worth keeping on the todo list naming the judgement it came from. dont queue any work off them.
```

Good answer: two or three todos citing J37/J38/J39, including the server.js:96-102 one. Bad answer: it adds nothing, or it queues a task anyway — the brake is a paragraph in the skill, not code, so that's the thing worth watching.

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

5. Housekeeping, cheap
```
#13 is judged, commented and yours to close. anything else outstanding you want off your plate before i pick the next thing?
````
I'd send 1 first — it's the only one testing code written since it last woke, and it's the loop you described wanting. Then 2 if 1 looks right, since that's the one that spends a machine.

