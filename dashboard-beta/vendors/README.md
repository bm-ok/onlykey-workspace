vendors
=======

Third-party code, checked in rather than installed.

This half of the app has a build step and takes react, socket.io and webpack
from npm, so the old window's blanket "no dependency" rule does not transfer
whole. What does transfer is the reason behind it: what runs is what is here.

A library lands in this folder rather than in `package.json` when it is small,
finished, and something the app renders somebody else's bytes with — where the
exact version is part of the security argument rather than a detail. `marked`
is that: the markdown it parses came off a machine running a script somebody
wrote, and the frame it renders into is built around what this specific version
does and does not escape.

Everything here is bundled by webpack like any other module. Nothing is fetched
at run time.


marked/ — the same copy the old window vendors
----------------------------------------------

Parses markdown to HTML. It does NOT sanitise, and has never claimed to —
markdown carries raw HTML through by design. See `Markdown` in
src/app/theme/bits.js for the frame that makes that safe: sandbox="" and a CSP
of default-src 'none'.
