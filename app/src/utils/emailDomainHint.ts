// Suggestions only: never normalize or replace the submitted address here.
// Use explicit suggestions only, never broad edit-distance domain guesses.
// The observed hotmai.com delivery delay gets an optional Hotmail suggestion;
// it remains legal to submit the original address without accepting the hint.
const COM_PROVIDERS = new Set(['gmail', 'hotmail', 'outlook', 'yahoo', 'icloud', 'live'])

export function suggestEmailDomain(value: string): string | null {
  const address = value.trim()
  if (address.length > 254) return null
  const observedTypo = /^([^\s@]+)@hotmai\.com$/i.exec(address)
  if (observedTypo) return `${observedTypo[1]}@hotmail.com`
  const match = /^([^\s@]+)@([a-z]+)\.(con|cmo)$/i.exec(address)
  if (!match || !COM_PROVIDERS.has(match[2].toLowerCase())) return null
  return `${match[1]}@${match[2].toLowerCase()}.com`
}
