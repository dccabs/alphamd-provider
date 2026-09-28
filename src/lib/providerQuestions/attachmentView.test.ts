import assert from 'node:assert/strict'
import test from 'node:test'

import { toQuestionAttachment } from './attachmentView.ts'

const base = {
  id: 'att-1',
  file_name: 'rash.jpg',
  content_type: 'image/jpeg',
  size_bytes: 2048,
  storage_path: null,
  zendesk_ticket_id: null,
  url: null,
  created_by: 'cs-1',
  created_at: '2026-09-28T13:00:00Z',
}

test('an upload is marked with who uploaded it and opens through signing, not a stored link', () => {
  const view = toQuestionAttachment(
    { ...base, source: 'upload', storage_path: 'pq-1/abc-rash.jpg' },
    'Marisol Diaz'
  )
  assert.equal(view.mark, 'Uploaded by Marisol Diaz')
  assert.equal(view.source, 'upload')
  assert.equal(view.href, null)
})

test('an upload with no known uploader still says it came from staff', () => {
  const view = toQuestionAttachment(
    { ...base, source: 'upload', storage_path: 'pq-1/abc-rash.jpg' },
    null
  )
  assert.equal(view.mark, 'Uploaded by AlphaMD staff')
})

test('a Zendesk attachment is marked with its ticket and links straight to Zendesk', () => {
  const url = 'https://alphamd.zendesk.com/attachments/token/a/?name=rash.jpg'
  const view = toQuestionAttachment(
    { ...base, source: 'zendesk', zendesk_ticket_id: '35927', url },
    'Marisol Diaz'
  )
  assert.equal(view.mark, 'From Zendesk #35927')
  assert.equal(view.href, url)
})

test('an unknown source reads as an upload, so it is never linked blind', () => {
  const view = toQuestionAttachment(
    { ...base, source: 'mystery', url: 'https://example.test/x' },
    null
  )
  assert.equal(view.source, 'upload')
  assert.equal(view.href, null)
})
