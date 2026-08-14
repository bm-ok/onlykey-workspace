'use strict'

// The one table, as an object that gets filled rather than one that is built.
//
// EVERY ACTION IS STILL ONE SURFACE. Splitting the table into files does not
// split what it is: `okc.js` with no arguments still lists all of it, the window
// still calls the same names, and an action that does not appear here does not
// exist. What changed is only where the source sits.
//
// Actions call each other -- borrowing a machine, putting it back, reading the
// branch board before deleting a branch -- and they always could, because they
// were all one object literal. Across files that would be a cycle: machines.js
// needs runs.js and runs.js needs machines.js, and whichever loads second sees
// half of the other.
//
// So this is the object, empty, and every group file requires it and reads names
// off it INSIDE a `run`. At load time it is empty and nothing looks; by the time
// anything runs, server.js has filled it. That is the whole trick, and it is why
// not one line inside a `run` had to change: `actions.vmList.run(...)` means
// exactly what it meant when they shared a literal.
module.exports = {}
