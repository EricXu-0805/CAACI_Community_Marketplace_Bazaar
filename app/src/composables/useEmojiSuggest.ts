/**
 * Keyboard emoji suggestion (P3 键盘联想) — typing "开心" or "thanks"
 * surfaces matching emoji as quick-insert chips above the chat input.
 *
 * Pure keyword lookup against a small curated zh+en map; suggestions
 * APPEND the emoji to the input (never replace typed text — zero risk
 * of mangling a half-typed message). Matching scans the tail of the
 * input: the last latin word, or the last 1–3 CJK chars.
 */

const KEYWORD_MAP: Record<string, string[]> = {
  // zh
  '开心': ['😄', '😊', '🥳'],
  '高兴': ['😄', '😊'],
  '哈哈': ['😂', '🤣'],
  '笑': ['😂', '🤣', '😆'],
  '爱': ['❤️', '😍', '🥰'],
  '喜欢': ['😍', '❤️', '👍'],
  '谢谢': ['🙏', '😊', '👍'],
  '感谢': ['🙏', '😊'],
  '哭': ['😭', '😢'],
  '难过': ['😢', '😭', '💔'],
  '伤心': ['💔', '😢'],
  '牛': ['👍', '💪', '🔥'],
  '厉害': ['👍', '💪', '🔥'],
  '加油': ['💪', '🔥', '✊'],
  '恭喜': ['🎉', '👏', '🎊'],
  '好的': ['👌', '✅'],
  '可以': ['👌', '✅'],
  '没问题': ['👌', '✅', '👍'],
  '什么': ['❓', '🤔'],
  '为啥': ['❓', '🤔'],
  '疑问': ['❓', '🤔'],
  '晚安': ['😴', '🌙'],
  '困': ['😴', '😪'],
  '吃': ['🍜', '🍔', '🍕'],
  '饿': ['🍜', '🍔'],
  '咖啡': ['☕'],
  '钱': ['💰', '💵'],
  '便宜': ['💰', '👍'],
  '书': ['📚', '📖'],
  '学习': ['📚', '✏️'],
  '考试': ['📚', '💪', '🙏'],
  '惊': ['😱', '😮'],
  '酷': ['😎', '🆒'],
  '火': ['🔥'],
  '心': ['❤️', '💕'],
  // en
  'haha': ['😂', '🤣'],
  'lol': ['😂', '🤣'],
  'love': ['❤️', '😍', '🥰'],
  'thanks': ['🙏', '😊', '👍'],
  'thank': ['🙏', '😊'],
  'cry': ['😭', '😢'],
  'sad': ['😢', '💔'],
  'wow': ['😮', '🤩'],
  'cool': ['😎', '🆒'],
  'fire': ['🔥'],
  'ok': ['👌', '✅'],
  'okay': ['👌', '✅'],
  'good': ['👍', '😊'],
  'nice': ['👍', '✨'],
  'great': ['👍', '🎉'],
  'congrats': ['🎉', '👏'],
  'please': ['🙏'],
  'sleep': ['😴'],
  'hungry': ['🍜', '🍔'],
  'coffee': ['☕'],
  'money': ['💰', '💵'],
  'cheap': ['💰', '👍'],
  'deal': ['🤝', '👍'],
  'question': ['❓', '🤔'],
  'why': ['❓', '🤔'],
  'heart': ['❤️', '💕'],
  'happy': ['😄', '😊'],
}

const MAX_SUGGESTIONS = 6

/** Longest zh keyword length — bounds the CJK tail scan. */
const MAX_ZH_LEN = Math.max(...Object.keys(KEYWORD_MAP).filter(k => /[一-鿿]/.test(k)).map(k => k.length))

export function suggestEmoji(input: string): string[] {
  const text = input.trimEnd()
  if (!text) return []

  const out: string[] = []
  const push = (list: string[]) => {
    for (const e of list) if (!out.includes(e)) out.push(e)
  }

  const latinTail = /([a-zA-Z]+)$/.exec(text)
  if (latinTail) {
    const word = latinTail[1].toLowerCase()
    if (word.length >= 2 && KEYWORD_MAP[word]) push(KEYWORD_MAP[word])
  } else {
    // CJK: try the longest tail substring first so 没问题 beats 问题/题
    for (let len = Math.min(MAX_ZH_LEN, text.length); len >= 1 && out.length === 0; len--) {
      const tail = text.slice(-len)
      if (KEYWORD_MAP[tail]) push(KEYWORD_MAP[tail])
    }
  }
  return out.slice(0, MAX_SUGGESTIONS)
}
