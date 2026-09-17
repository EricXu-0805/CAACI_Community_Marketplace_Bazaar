// Suggestions only: never normalize or replace the submitted address here.
// Restrict this to common .com providers and two specific typing mistakes;
// custom domains, educational addresses and valid .co domains are left alone.
const COM_PROVIDERS = new Set(['gmail', 'hotmail', 'outlook', 'yahoo', 'icloud', 'live'])

export function suggestEmailDomain(value: string): string | null {
  const address = value.trim()
  if (address.length > 254) return null
  const match = /^([^\s@]+)@([a-z]+)\.(con|cmo)$/i.exec(address)
  if (!match || !COM_PROVIDERS.has(match[2].toLowerCase())) return null
  return `${match[1]}@${match[2].toLowerCase()}.com`
}
