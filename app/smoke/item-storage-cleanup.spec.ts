import { test, expect } from '@playwright/test'
import { ownedItemImagePath, ownedItemImagePaths } from '../src/utils/itemStorage'

const UID = 'f8200d24-a5d1-474e-8597-6560ab5e801b'
const BASE = 'https://example.supabase.co'

test('extracts only owned item image paths from public and rendered URLs', () => {
  expect(ownedItemImagePath(
    `${BASE}/storage/v1/object/public/item-images/items/${UID}/photo%201.jpg`,
    UID,
    BASE,
  )).toBe(`items/${UID}/photo 1.jpg`)

  expect(ownedItemImagePath(
    `${BASE}/storage/v1/render/image/public/item-images/items/${UID}/photo.jpg?width=480`,
    UID,
    BASE,
  )).toBe(`items/${UID}/photo.jpg`)
})

test('rejects another owner, another bucket and traversal-like paths', () => {
  expect(ownedItemImagePath(
    `${BASE}/storage/v1/object/public/item-images/items/another-user/photo.jpg`,
    UID,
    BASE,
  )).toBeNull()
  expect(ownedItemImagePath(
    `${BASE}/storage/v1/object/public/avatars/items/${UID}/photo.jpg`,
    UID,
    BASE,
  )).toBeNull()
  expect(ownedItemImagePath(
    `${BASE}/storage/v1/object/public/item-images/items/${UID}/%2E%2E/other/photo.jpg`,
    UID,
    BASE,
  )).toBeNull()
  expect(ownedItemImagePath('javascript:alert(1)', UID, BASE)).toBeNull()
  expect(ownedItemImagePath(
    `https://evil.example/storage/v1/object/public/item-images/items/${UID}/photo.jpg`,
    UID,
    BASE,
  )).toBeNull()
  expect(ownedItemImagePath(
    `${BASE}/storage/v1/object/public/item-images/items/${UID}/photo.jpg`,
    UID,
    '',
  )).toBeNull()
})

test('deduplicates paths and ignores malformed values', () => {
  const url = `${BASE}/storage/v1/object/public/item-images/items/${UID}/photo.jpg`
  expect(ownedItemImagePaths([url, url, '', null, undefined], UID, BASE))
    .toEqual([`items/${UID}/photo.jpg`])
})
