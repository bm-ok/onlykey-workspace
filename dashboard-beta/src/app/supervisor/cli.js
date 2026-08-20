//---------------------------------------------------------------------------
//the list of things to do, at a command line.
//
//THE SAME ANSWER, READ RATHER THAN PARSED. `todos` returns the rows the pane
//draws; this is what they look like to somebody who typed the question. Nothing
//is computed here and nothing is asked for — a printer that called an action
//would be a second way to fetch the same thing, and the two would drift.
//
//THE REF FIRST, BECAUSE THE REF IS WHAT YOU TYPE NEXT. Every other command about
//a todo takes it, so a listing that made you hunt for it would be a listing you
//read twice.
//
//`--json` STILL GIVES THE BRACES, and this changes nothing about what a script
//sees. That is the deal that lets this be readable: the shape is the contract,
//and this is a view of it.
//---------------------------------------------------------------------------

var MARK = { open: ' ', doing: '>', done: 'x' };

module.exports = {
    print: {
        todos: function (said) {
            var rows = said.todos || [];
            if (!rows.length) return said.note || 'Nothing on the list.';

            var lines = rows.map(function (t) {
                var head = ' ' + (MARK[t.state] || '?') + '  ' + t.ref.padEnd(5) + t.what;
                //THE WHY IS INDENTED UNDER IT AND NOT TRUNCATED. It is the
                //paragraph that stops the line being misread in a week, and a
                //list that hides it is a list of lines somebody has to go and
                //ask about one at a time.
                if (!t.why) return head;
                return head + '\n' + t.why.split('\n').map(function (l) { return '        ' + l; }).join('\n');
            });

            //WHO WROTE IT IS NOT IN THE LIST, and that is deliberate: it is the
            //first question about a list two things write to, and it is one
            //`--json` away. Putting it on every line would push the what off the
            //side of a terminal for the ordinary case where they are all yours.
            var tally = [
                said.open ? said.open + ' open' : null,
                said.doing ? said.doing + ' doing' : null,
                said.done ? said.done + ' done' : null
            ].filter(Boolean).join(', ');

            return lines.join('\n') + '\n\n  ' + tally;
        }
    }
};
