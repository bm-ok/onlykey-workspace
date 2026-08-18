'use strict'

// WHAT HAS BEEN SPENT, PER SIGN-IN. See core/meter.js for what is kept and why
// it is kept per key rather than as one number.

const s = require('./shared')
const { meter, guests } = s

module.exports = {
  meter: {
    about: 'What every sign-in has spent: runs, turns, tokens and cost, per key and in total',
    takes: ['key', 'kind', 'limit'],
    run: ({ key = null, kind = null, limit = 100 }) => {
      const everything = meter.read()

      // NARROWED FOR THE ROWS, NEVER FOR THE TOTALS. Filtering both would give a
      // screen where the number at the top changes when you click a column,
      // which is the one thing a total must not do — it is the answer to "how
      // much altogether", and there is only one of those.
      const wanted = everything.filter(r =>
        (!key || String(r.key || '') === String(key)) &&
        (!kind || String(r.kind) === String(kind)))

      const rows = wanted
        .slice()
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, Math.max(1, Math.min(1000, Number(limit) || 100)))

      // EVERY SIGN-IN THIS HOST HOLDS, not only the ones that have spent
      // something. A key with no runs against it is a real and useful answer —
      // it is the difference between "it has not been used" and "it is not
      // here", and those look identical in a list built from the spending
      // alone.
      const spent = meter.byKey(everything)
      const known = guests.all().map(g => g.name)
      const perKey = [
        ...spent,
        ...known
          .filter(name => !spent.some(x => x.key === name))
          .map(name => ({ key: name, ...meter.tallyOf([]) }))
      ]

      return {
        rows,
        showing: rows.length,
        of: wanted.length,
        keys: perKey,
        // The total is of EVERYTHING, and says so.
        total: { ...meter.total(everything), kept: everything.length, most: meter.MOST_ROWS },
        note: everything.length
          ? (everything.length >= meter.MOST_ROWS
              ? `The oldest rows are dropped past ${meter.MOST_ROWS}, so the total is of what is kept rather than of all time.`
              : null)
          : 'Nothing has been metered yet. A supervisor waking and a worker run each record one row when they finish.'
      }
    }
  }
}
