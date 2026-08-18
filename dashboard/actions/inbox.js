'use strict'

// EVERYTHING WAITING ON A PERSON, AS ONE LIST.
//
// See the head of core/inbox.js for what belongs in it, why it is computed
// rather than stored, and how putting one away differs from turning it off.

const s = require('./shared')
const { inbox, log, whoAsked } = s

module.exports = {
  inbox: {
    about: 'Everything waiting on you: what it is, why it needs you, and where to go for it',
    takes: ['mine', 'hidden'],
    run: ({ mine = false, hidden = false }) => {
      const all = inbox.all()
      const away = all.filter(i => i.hidden)
      const live = all.filter(i => !i.hidden)

      // PUT-AWAY ONES ARE ASKED FOR, never mixed in. A list that quietly
      // included them would make "put away" mean nothing; a list with no way to
      // see them would make it mean "deleted", and neither is what it says.
      const rows = (hidden === true || hidden === 'true')
        ? away
        : (mine === true || mine === 'true') ? live.filter(i => i.mine) : live

      return {
        items: rows,
        count: rows.length,
        // YOURS ALONE, counted separately. An approval and a change waiting on
        // somebody else's merge are both "waiting", and only one of them stops
        // if you go on holiday.
        mine: live.filter(i => i.mine).length,
        live: live.length,
        away: away.length,
        byView: inbox.byView(live),
        note: rows.length
          ? null
          : (hidden === true || hidden === 'true')
              ? 'Nothing has been put away.'
              : `Nothing is waiting on you.${away.length ? ` ${away.length} put away — ask with hidden to see them.` : ''}`
      }
    }
  },

  inboxHide: {
    about: 'Put an item away: it stays true, it stops being counted, and it comes back if the thing it is about changes',
    takes: ['key', 'why'],
    run: ({ key, why = null, _overTheWire, _driven }) => {
      const all = inbox.all()
      const one = all.find(i => i.key === String(key))
      // NAMED FROM THE LIST, not accepted as any string. A key that matches
      // nothing would sit in the file for ever, silencing something that never
      // arrives, and nothing would ever say so.
      if (!one) throw new Error(`Nothing waiting has the key "${key}". Ask for the inbox to see what there is — a key is on every item.`)

      const done = inbox.hide(one.key, { by: whoAsked({ _overTheWire, _driven }), why })
      log.on('inbox').info(`put away: ${one.kind} — ${one.what}`)
      return {
        ...done,
        was: one,
        note: `"${one.what}" is put away. It is still true and still there under hidden; if the thing it is about changes, it comes back.`
      }
    }
  },

  inboxShow: {
    about: 'Take an item back out of what was put away',
    takes: ['key'],
    run: ({ key }) => {
      const done = inbox.show(key)
      if (!done.was) return { ...done, note: `"${key}" was not put away, so nothing changed.` }
      log.on('inbox').info(`back on the list: ${key}`)
      return { ...done, note: 'It is on the list again.' }
    }
  }
}
