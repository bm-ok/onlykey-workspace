'use strict'

// THE LIST OF THINGS TO DO, as actions.
//
// Written for two callers who are not the same and must not be given the same
// door. See the head of core/todo.js for what this list is and, more usefully,
// what it is NOT: it is neither the task board nor the triage notebook.
//
// A SUPERVISOR MAY WRITE TO IT. That is the point of it existing — a decision
// taken at 3am that cannot be acted on until somebody is awake has nowhere to go
// otherwise, and a note in the conversation is lost the moment the conversation
// is long. So it may add, change and finish.
//
// A SUPERVISOR MAY NOT DELETE. "Done" and "gone" are different claims: done is
// kept and shown, gone leaves no trace that anything was ever there. A list the
// worker can empty is a list nobody can use to check up on the worker, and the
// whole reason a person looks at this tab is to see what it thinks it is doing.
// Deleting is a person's, in the window, like every other irreversible thing
// here.

const s = require('./shared')
const { log, todo, whoAsked } = s

// One shape for every answer that returns the list, so the window and a model
// are reading the same thing.
const board = () => {
  const all = todo.all()
  return {
    todos: all,
    open: all.filter(t => t.state === 'open').length,
    doing: all.filter(t => t.state === 'doing').length,
    done: all.filter(t => t.state === 'done').length
  }
}

module.exports = {
  todos: {
    about: 'The list of things to do: what is open, what is being done, and what is finished',
    run: () => {
      const now = board()
      return {
        ...now,
        states: todo.STATES,
        note: now.todos.length
          ? null
          : 'Nothing on the list. todoAdd puts something on it — a line saying what is to be done, and why if the line is not enough on its own.'
      }
    }
  },

  todoAdd: {
    about: 'Put something on the list: what is to be done, and why',
    takes: ['what', 'why', 'state'],
    run: ({ what, why = null, state = 'open', _overTheWire, _driven }) => {
      const by = whoAsked({ _overTheWire, _driven })
      const one = todo.add({ what, why, state, by })
      log.on('todo').good(`${one.ref} "${one.what}" — added by ${by}`)
      return { ...one, ...board(), note: `${one.ref} is on the list.` }
    }
  },

  todoSet: {
    about: 'Change something on the list: its wording, its reason, or what state it is in',
    takes: ['id', 'what', 'why', 'state'],
    run: ({ id, what, why, state, _overTheWire, _driven }) => {
      const was = todo.get(id)
      if (!was) throw new Error(`There is no todo "${id}". Ask for the list to see what there is.`)

      const by = whoAsked({ _overTheWire, _driven })
      const one = todo.edit(id, { what, why, state, by })

      // SAID ONLY WHEN IT MOVED. Rewording something is not an event worth a
      // line in the record; finishing it is, and so is picking it up.
      if (was.state !== one.state) log.on('todo').good(`${one.ref} "${one.what}" — ${was.state} to ${one.state}, by ${by}`)
      return { ...one, ...board(), was: was.state, note: `${one.ref} is ${one.state}.` }
    }
  },

  todoRemove: {
    about: 'Take something off the list for good. A person, in the window — a supervisor marks things done instead',
    takes: ['id'],
    run: ({ id, _overTheWire, _driven }) => {
      // THE REFUSAL THAT MAKES THE LIST WORTH READING.
      //
      // Everything else here is open to both ends deliberately. This one is not,
      // because a list that the thing doing the work can empty says nothing
      // about what the work was — and "it is no longer on the list" would stop
      // meaning "it was dealt with".
      if (_overTheWire || _driven) {
        throw new Error('Taking something off the list for good is done in the window, by a person. Mark it done instead — done is kept and shown; removed leaves no trace that it was ever there.')
      }
      const one = todo.remove(id)
      log.on('todo').warn(`${one.ref} "${one.what}" removed`)
      return { ...one, ...board(), note: `${one.ref} is gone. It was ${one.state}.` }
    }
  }
}
