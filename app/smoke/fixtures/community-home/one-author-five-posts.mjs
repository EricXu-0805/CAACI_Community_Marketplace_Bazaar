import { makePosts } from './helpers.mjs'
export default makePosts(5, ['campus-life']).map(post => ({ ...post, user_id: 'same-author' }))
