var React = require('react');
var makeQueue = require('./queue');

//the Queue tab: what is running, what is waiting, and which machines are free.
//
//FIRST OF THE TABS BECAUSE IT IS THE HARDEST TO GET RIGHT, not the easiest. It
//is a live board on a short refresh, and the old window is full of discipline
//about redrawing that exists for one reason: rewriting text that is IDENTICAL
//destroys the selection somebody is in the middle of making. Over there every
//paint compares a signature and returns early. Here that is React's job.
//
//So select the ordering sentence at the bottom and leave it selected while the
//read count ticks. If it survives, a large part of the old ui/ is deleted
//rather than ported.

plugin.consumes = ['shell', 'theme', 'okc'];
plugin.provides = [];
async function plugin(imports, register) {
    var { shell, theme, okc } = imports;


    shell.tab({ name: 'Queue', order: 30, Component: makeQueue(theme, okc) });

    await register(null, {});
}
module.exports = plugin;
