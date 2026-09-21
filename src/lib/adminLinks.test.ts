import assert from 'node:assert/strict'
import test from 'node:test'

import { adminUrl, meetJoinUrl } from './adminLinks.ts'

test('adminUrl defaults to www.alphamd.net and tolerates slashes', () => {
  assert.equal(adminUrl('/admin/actions', undefined), 'https://www.alphamd.net/admin/actions')
  assert.equal(adminUrl('admin/actions', 'https://staging.example/'), 'https://staging.example/admin/actions')
})

test('meetJoinUrl pins the provider email through meet-redirect', () => {
  const url = new URL(meetJoinUrl('https://calendly.com/events/abc/google_meet', 'doc@alphamd.org'))
  assert.equal(url.pathname, '/api/meet-redirect')
  assert.equal(url.searchParams.get('calendly_url'), 'https://calendly.com/events/abc/google_meet')
  assert.equal(url.searchParams.get('email'), 'doc@alphamd.org')
})

test('meetJoinUrl falls back to the raw link with no email', () => {
  assert.equal(meetJoinUrl('https://meet.google.com/abc', null), 'https://meet.google.com/abc')
})
