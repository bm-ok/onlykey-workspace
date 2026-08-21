# vendor

Third-party code, checked in rather than installed.

A dependency resolved by a package manager is a file that exists on whoever ran
`npm install` last, at whatever version the registry served that day — and the
same app on another machine, or a year from now, is then not the same app. What
is here is what runs.

It sits **inside the plugin that uses it** rather than in one folder at the root.
Reading a tar belongs to exactly one concern; putting it somewhere shared would
make it look like something the app needs, when what the app needs is "tell me
what is inside this thing a machine handed back". Delete this plugin and its
9.5KB goes with it.

## nanotar/ — nanotar 0.3.0

    nanotar.js   the CommonJS build, from https://unpkg.com/nanotar@0.3.0/dist/index.cjs
    LICENSE      the MIT licence that came with it

Reads a tar. It is here for one thing: the `~/.claude` archive a worker hands
back when a run ends, so this host can say what that worker actually did — how
many turns, which tools, which files it touched — instead of only how big the
file is.

**Only tar, because gzip was already free.** Node ships `zlib`, so
`zlib.gunzipSync` needs nothing vendored; tar is the half node has no opinion
about. That is also why an archive stays compressed on disk: 16KB against 92KB
unpacked, for one call.

**Chosen for what it does NOT bring.** `tar-stream` is the obvious package and
pulls in `b4a`, `bare-fs`, `streamx` and `fast-fifo`; `it-tar` pulls in seven.
This has none.

Without `nanotar.js` there is no way to see inside an archive at all — the
session panel can say a file arrived and nothing about it. `LICENSE` is what
lets it be checked in.
