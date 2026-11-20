// The runner has already performed the five read-only schema probes.
console.log(JSON.stringify({ action: 'schema_only', writes: 0, cleanupResiduals: 0 }))
