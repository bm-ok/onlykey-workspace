'use strict'

// How git is given the token, without the token ever being an argument.
//
// Git asks a credential helper for a username and a password on stdout, and it
// is the ONLY way to authenticate a push that does not put the secret somewhere
// another process can read it:
//
//   in the URL          https://TOKEN@github.com/...   -- lands in .git/config,
//                       in reflogs, and in every error message git prints
//   in -c http.extraheader   the token is in argv, which any process running as
//                       this user can read out of the process list
//   here                the token is in this process's environment, inherited
//                       from the one that spawned it, and gone when it exits
//
// It prints nothing for any operation other than `get`. Git also calls helpers
// with `store` and `erase`, and a helper that answered those would be writing
// the credential to disk -- which is the thing this exists to avoid.
//
// No dependency, nothing read from disk, and no argument parsing beyond the one
// word git passes.

const op = process.argv[2]
if (op !== 'get') process.exit(0)

// Git sends the request on stdin as `key=value` lines. It is read and discarded:
// this helper serves exactly one host, the one the caller set up, and answering
// a different one would be answering a question nobody asked.
let waiting = ''
process.stdin.on('data', d => { waiting += d })
process.stdin.on('end', () => {
  const user = process.env.OKC_GIT_USER || 'x-access-token'
  const token = process.env.OKC_GIT_TOKEN || ''
  if (!token) process.exit(0)
  process.stdout.write(`username=${user}\npassword=${token}\n`)
})
