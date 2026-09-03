# This workspace

**This file is the workspace's own notes, and it is almost certainly incomplete.**
You are reading a starter. Nobody has filled it in for this project yet, or has
filled in only part of it.

## What this file is for

Every machine that opens this workspace gets this file at `~/workspace/CLAUDE.md`,
before any work begins. It is here so that you do not have to rediscover, from
the source, the things somebody already knows — how to get the workspace into a
state where the code will actually run, how to run the tests, how to run the
thing itself, and whatever is peculiar to this project and would otherwise cost
you an hour.

It is shared. It is the same file on every machine, it survives the machine being
rolled back, and the next worker or judge to open this workspace reads whatever
it says now.

## Filling it in is part of the work

If you learn something here that this file should have told you, **write it
down**. That is not a favour to the next machine; it is the difference between
this file being trusted and being skimmed.

Worth recording, roughly in the order somebody needs it:

- **Finalising the workspace.** What has to happen before anything will run.
  A virtualenv, a package install, a submodule, a generated file, an
  environment variable, a service that has to be up. Say the commands.
- **How to build.** The command, and what it produces.
- **How to test.** The command, where the tests live, roughly how long they take,
  and which ones are known to fail for reasons that have nothing to do with you —
  that last one saves more time than the rest of this file put together.
- **How to run it.** Including anything unusual: a device that has to be plugged
  in, an emulator, a port, a fixture, a service.
- **How to debug it.** Where the logs go, how to turn more of them on, what the
  usual first failure actually means.
- **What is surprising.** The thing that is not how it looks. Every project has
  one and it is never in the README.

Be specific and be honest. A command that is pasted and works is worth a page of
description. If something does not work and you could not find out why, say that
plainly rather than leaving a gap somebody else reads as "this must be fine".

## What does not belong here

- **Secrets.** No tokens, no keys, no passwords. This file is shared between
  machines and is read by everything that opens the workspace.
- **What you are working on right now.** This is about the workspace, not about
  the task. Your branch and your report say what you did.
- **Anything you have not checked.** A confident wrong instruction here costs
  more than an empty heading, because the next reader will believe it.

---

*Everything above this line is a starter, and replacing it with something true
about this project is the point. Delete these instructions once the file says
something worth reading.*

## Finalising the workspace

*Not yet written.*

## Building

*Not yet written.*

## Testing

*Not yet written.*

## Running it

*Not yet written.*

## Debugging

*Not yet written.*

## Anything special

*Not yet written.*
