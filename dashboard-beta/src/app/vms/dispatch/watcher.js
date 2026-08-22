var quoting = require('../shell/quoting');
var heredoc = quoting.heredoc;

//---------------------------------------------------------------------------
//A WAY TO STAND BEHIND A MODEL AND WATCH IT WORK, in a directory on a machine.
//
//Shell that writes TWO FILES and makes one of them executable: the watcher
//itself, which is node and lives in ./guest/watch-guest.js, and a launcher that
//pipes a log into it.
//
//TWO FILES RATHER THAN ONE because the pipe is shell and the parsing is node,
//and putting node inside a quoted shell string is how the contents of that file
//get corrupted.
//
//USED IN TWO PLACES AND THEREFORE WRITTEN IN ONE. A worker's run gets it in the
//run's own directory; the supervisor gets it in its own, for the turn it is
//taking. The two logs are produced by different machinery and read identically,
//because both are claude's stream-json.
//---------------------------------------------------------------------------

module.exports = function watcher(deps) {
    var d = deps || {};
    var payloads = d.payloads;

    //`tail -F` RATHER THAN `-f`, AND THAT IS THE DIFFERENCE BETWEEN WATCHING ONE
    //LOG AND WATCHING A MACHINE.
    //
    //-F follows by NAME: when the supervisor relinks current.log to its next
    //turn, a terminal already open picks it up and carries on. With -f it would
    //sit on a file nothing writes to again — open, silent, and looking exactly
    //like a model that has stopped working.
    //
    //`-n +1` starts from the beginning, so somebody who opens this halfway
    //through sees what has already happened rather than only what comes next.
    function watcherFor(dir, log) {
        return [
            'mkdir -p ' + dir,
            heredoc(dir + '/watch.js', payloads.watch(), 'OKC_WATCH_EOF'),
            heredoc(dir + '/okc-watch', [
                '#!/bin/sh',
                '# okc-watch -- follow what the model is doing, as a person can read it.',
                '# Ctrl-C stops the watching and does not touch what is being watched.',
                'set -eu',
                'exec tail -n +1 -F "' + log + '" | node "' + dir + '/watch.js"',
                ''
            ].join('\n'), 'OKC_WATCH_SH_EOF'),
            'chmod +x ' + dir + '/okc-watch'
        ].join('\n');
    }

    return { watcherFor: watcherFor };
};
