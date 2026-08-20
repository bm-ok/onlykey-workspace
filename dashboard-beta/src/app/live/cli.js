//---------------------------------------------------------------------------
//the live log and the record, at a command line.
//
//THE SAME SHAPE THE PANE DRAWS: a time, a level, the tags, the line. Read down a
//terminal it is one stream you narrow by eye, which is what the tags are for
//over on the Stream pane too.
//
//`logWatch` IS NOT HERE, AND SAYING WHY IS THE POINT. It is the one action that
//answers for ever instead of once — `stream` and `subscribe` instead of `run` —
//and neither half of this app can carry it yet: ../core/actions only knows how to
//`run` something, and the relay in ../core/okc is one request for one reply.
//
//IT IS WORSE THAN MISSING, BECAUSE IT IS LISTED. The catalogue includes whatever
//the dashboard has, so `okc.js` shows logWatch; calling it goes down the pipe,
//the streamed frames carry no `result`, the fall-through reads that as "not
//answered" and the table says `No action called "logWatch"`. Every word of that
//is false and it is the last thing anybody would doubt.
//
//So the printer below is for the thing that DOES work, and ./window.js's note
//says where the durable half is. Making watching work is a change to the action
//table and to both pipes, not a printer.
//---------------------------------------------------------------------------

var WIDTH = { out: 'out', good: 'good', warn: 'warn', bad: 'bad', info: 'info' };

function when(at) {
    //The clock, not the date. Anything in this log happened while the app has
    //been up, and a date on every line is nine characters saying "today".
    return String(at || '').slice(11, 19) || '--:--:--';
}

function lines(rows, empty) {
    if (!rows || !rows.length) return empty;
    return rows.map(function (e) {
        var level = (WIDTH[e.level] || e.level || '').padEnd(4);
        var tags = (e.tags || []).join(',');
        return when(e.at) + '  ' + level + '  ' + tags.padEnd(14) + '  ' + e.text;
    }).join('\n');
}

module.exports = {
    print: {
        logSince: function (said) {
            var out = lines(said.entries, 'the log is empty — nothing has been said since this app started');
            var tags = (said.tags || []).map(function (t) { return t.tag + ' ' + t.n; }).join('  ');
            return tags ? out + '\n\n  ' + tags : out;
        },

        //THE RECORD READS THE SAME WAY ON PURPOSE, because the difference between
        //the two is WHAT IS IN THEM rather than how they look, and making them
        //look different would suggest otherwise. The note underneath is the
        //bookmark, which is the thing you type next.
        events: function (said) {
            var out = lines(said.events, said.note || 'Nothing kept yet.');
            return said.bookmark
                ? out + '\n\n  since ' + said.bookmark + '   (' + said.where + ')'
                : out;
        }
    }
};
