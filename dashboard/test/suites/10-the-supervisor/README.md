# The supervisor

The machine that decides what work there is, rather than one doing it.

Everything before this suite is a **runner**: a machine the queue gives tasks to,
which clones repositories, builds things and hands work back. A supervisor is the
other side of that. It runs Claude Code, it holds no repositories, and what it
does is ask this dashboard to cut a branch, write a task, give it out and judge
what came back.

**It is out of the pool for good.** A machine built as a supervisor carries the
`supervisor` tag, and the queue skips it — not as a preference, and not as a
setting somebody can flip. Giving a supervisor a task would roll it back to its
base snapshot mid-thought and run a worker over the top of the thing that was
handing out the work.

**Most of this suite is not written yet, and says so.** The checks here today are
about the boundary — the tag cannot be typed on or off, a task cannot ask for
one, the queue never offers one — and those need no machine at all. What is
drafted is the thing that does not exist: an API a supervisor talks to this host
over.

**Why an API rather than the command line.** The obvious way to let a supervisor
drive this dashboard is to hand it `okc.js`, and that was the original plan. It
is the wrong one: the CLI is the whole action surface, including the actions that
delete machines, approve jobs and hand out credentials — so a supervisor with a
shell is a supervisor with everything, and a prompt injected into it is too. A
supervisor gets a strict, named set of things it may ask for, over the wire, in
its own right, and everything else does not exist for it.

**It sits here in the order** because a supervisor needs the things before it —
machines that can be built, a credential to sign in with, repositories to work
on — and it produces the tasks that suite 08 proves can be run. It cools down in
the suite after this one, like everything else.
