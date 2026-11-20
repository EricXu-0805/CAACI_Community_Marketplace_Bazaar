import { makePosts } from './helpers.mjs'
export default makePosts(5).map(post => ({ ...post, user_id: 'official-account', is_official: true }))
