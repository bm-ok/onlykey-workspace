//---------------------------------------------------------------------------
//the shipped bundle, at a command line.
//
//WHAT MOVED IS THE WHOLE ANSWER. A tar rewritten from the live set is a binary
//blob that became another binary blob; git can say it changed and nothing
//else. The person about to commit it wants the sentence that goes in the
//message -- which entries, from what size to what -- and that is what this
//prints, one line per entry, in the order they sit in the file.
//
//`--json` STILL GIVES THE BRACES. Every line here comes off the answer.
//---------------------------------------------------------------------------

function size(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

module.exports = {
    print: {
        bootstrapShip: function (said) {
            var m = (said && said.moved) || { added: [], changed: [], removed: [], moved: 0 };
            var out = [];

            if (!said.wrote) {
                out.push('nothing moved -- ' + said.to + ' already holds what is here (' + said.files + ' entries).');
                return out.join('\n');
            }

            out.push('wrote ' + said.to + ' -- ' + size(said.size) + ' bytes, ' + m.moved + ' of ' + said.files + ' entries moved:');
            m.added.forEach(function (e) { out.push('  + ' + e.name + '  (' + size(e.now) + ' characters, new)'); });
            m.changed.forEach(function (e) {
                out.push('  ~ ' + e.name + '  (' + size(e.was) + ' characters to ' + size(e.now) + ')');
            });
            m.removed.forEach(function (e) { out.push('  - ' + e.name + '  (was ' + size(e.was) + ' characters)'); });
            out.push('');
            out.push('Read them before committing. Nothing about approvals is in the file.');
            return out.join('\n');
        }
    }
};
