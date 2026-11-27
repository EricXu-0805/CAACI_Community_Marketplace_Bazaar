/*
 * A recording stand-in for the supabase-js query builder, for node tests that
 * run a composable without a database. Every call is recorded with its table
 * and its chained steps. Answers are queued per table or function name, so two
 * requests made together cannot take each other's answer.
 */
export function postgrestDouble() {
  const double = { answers: {}, calls: [] }
  const answer = name => Promise.resolve(double.answers[name]?.shift() ?? { data: null, error: null })
  double.supabase = {
    from(table) {
      const call = { table, steps: [] }
      double.calls.push(call)
      const chain = new Proxy({}, {
        get: (_, name) => name === 'then'
          ? (resolve, reject) => answer(table).then(resolve, reject)
          : (...args) => { call.steps.push([name, ...args]); return chain },
      })
      return chain
    },
    rpc(name, args) {
      double.calls.push({ rpc: name, args })
      return answer(name)
    },
  }
  double.reset = (answers = {}) => {
    double.answers = answers
    double.calls = []
  }
  return double
}

/** A module source as an importable URL. */
export const moduleUrl = js => `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
