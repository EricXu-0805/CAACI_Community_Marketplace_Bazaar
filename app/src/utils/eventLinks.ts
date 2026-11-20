type Language = 'zh' | 'en'

function linkHost(value: string): string | null {
  if (typeof value !== 'string' || /[\s\\]/.test(value)) return null
  const match = /^https:\/\/([a-z0-9.-]+)(?:[/?#]|$)/i.exec(value)
  if (!match || !match[1].split('.').every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return null
  return match[1].toLowerCase()
}

export function isAllowedEventLink(value: string, extraHosts: readonly string[] = []): boolean {
  const host = linkHost(value)
  // ENGINEERING §9.11 excludes direct Illinois Forms links.
  if (!host || host === 'forms.illinois.edu' || host.endsWith('.forms.illinois.edu')) return false
  return host === 'caaciorg.com' || host === 'illinois.edu' || host.endsWith('.illinois.edu')
    || extraHosts.some(allowed => allowed.toLowerCase() === host)
}

export function localizeEventLink(value: string, lang: Language): string {
  if (lang !== 'zh' || linkHost(value) !== 'caaciorg.com') return value
  const match = /^https:\/\/caaciorg\.com(\/[^?#]*)(\?[^#]*)?(#.*)?$/i.exec(value)
  if (!match) return value
  const [, path, query = '', hash = ''] = match
  if (path === '/events/') return `https://caaciorg.com/zh/events/${query}${hash}`
  if (/^\/events\/[a-z0-9-]+\/register\/$/.test(path)) {
    const params = query.slice(1).split('&').filter(item => item && !/^lang(?:=|$)/.test(item))
    params.push('lang=zh')
    return `https://caaciorg.com${path}?${params.join('&')}${hash}`
  }
  return value
}

/**
 * Opens a link that is on the allowlist, and reports whether it was. The mini
 * program cannot open a web page, so it copies the address and then shows
 * `copied`, the caller's words for "link copied, open it in your browser".
 */
export function openExternalLink(url: string, extraHosts: readonly string[], lang: Language, copied: string): boolean {
  if (!isAllowedEventLink(url, extraHosts)) return false
  const target = localizeEventLink(url, lang)
  // #ifdef H5
  if (typeof window !== 'undefined') {
    const opened = window.open(target, '_blank', 'noopener,noreferrer')
    if (opened) opened.opener = null
    return true
  }
  // #endif
  // #ifdef MP-WEIXIN
  uni.setClipboardData({ data: target, success: () => uni.showToast({ title: copied, icon: 'none' }) })
  return true
  // #endif
  return false
}
