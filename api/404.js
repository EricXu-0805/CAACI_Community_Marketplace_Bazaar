export const config = { runtime: 'edge' }

const BODY = JSON.stringify({ error: 'not_found' })

export default function handler() {
  return new Response(BODY, {
    status: 404,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
