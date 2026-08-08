import assert from 'node:assert/strict'
import test from 'node:test'

import { parseInline, parseSummary, summaryToPlainText } from './summaryMarkdown.ts'

test('headings carry their level', () => {
  const blocks = parseSummary('# Title\n\n## Section')
  assert.deepEqual(blocks, [
    { type: 'heading', level: 1, content: [{ text: 'Title', bold: false }] },
    { type: 'heading', level: 2, content: [{ text: 'Section', bold: false }] },
  ])
})

test('bold splits into runs', () => {
  assert.deepEqual(parseInline('a **b** c'), [
    { text: 'a ', bold: false },
    { text: 'b', bold: true },
    { text: ' c', bold: false },
  ])
})

test('two bold runs in one line', () => {
  assert.deepEqual(parseInline('**a** and **b**'), [
    { text: 'a', bold: true },
    { text: ' and ', bold: false },
    { text: 'b', bold: true },
  ])
})

test('unmatched ** stays literal rather than eating the rest of the line', () => {
  assert.deepEqual(parseInline('dose is **200 mg'), [
    { text: 'dose is **200 mg', bold: false },
  ])
})

test('bullet list', () => {
  const blocks = parseSummary('- one\n- two')
  assert.deepEqual(blocks, [
    {
      type: 'list',
      ordered: false,
      items: [[{ text: 'one', bold: false }], [{ text: 'two', bold: false }]],
    },
  ])
})

test('asterisk bullets are bullets, not italics', () => {
  const blocks = parseSummary('* one\n* two')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'list')
})

test('numbered list is marked ordered', () => {
  const blocks = parseSummary('1. first\n2. second')
  assert.deepEqual(blocks, [
    {
      type: 'list',
      ordered: true,
      items: [[{ text: 'first', bold: false }], [{ text: 'second', bold: false }]],
    },
  ])
})

test('a bullet list following an ordered list starts a new block', () => {
  const blocks = parseSummary('1. first\n- bullet')
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'list')
  assert.equal(blocks[1].type, 'list')
  assert.equal((blocks[0] as { ordered: boolean }).ordered, true)
  assert.equal((blocks[1] as { ordered: boolean }).ordered, false)
})

test('wrapped paragraph lines join into one paragraph', () => {
  const blocks = parseSummary('line one\nline two\n\nsecond para')
  assert.deepEqual(blocks, [
    { type: 'paragraph', content: [{ text: 'line one line two', bold: false }] },
    { type: 'paragraph', content: [{ text: 'second para', bold: false }] },
  ])
})

test('a list terminates the paragraph before it', () => {
  const blocks = parseSummary('intro text\n- a')
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'paragraph')
  assert.equal(blocks[1].type, 'list')
})

test('an unknown construct degrades to paragraph text, never disappears', () => {
  const blocks = parseSummary('| a | b |\n| - | - |')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].type, 'paragraph')
  assert.match(summaryToPlainText('| a | b |'), /a \| b/)
})

test('empty input', () => {
  assert.deepEqual(parseSummary(''), [])
  assert.deepEqual(parseSummary(null), [])
  assert.deepEqual(parseSummary(undefined), [])
  assert.deepEqual(parseSummary('   \n  '), [])
})

test('a realistic production summary parses into all four block kinds', () => {
  const sample = [
    '# Clinical Lab Review Summary – William Hall',
    '',
    '## Current Treatment Context',
    'Patient is **pre-treatment** for TRT — no medications currently on record.',
    'Second line of the same paragraph.',
    '',
    '- Total testosterone **284 ng/dL**',
    '- Hematocrit 49.8%',
    '',
    '1. Confirm trough draw',
    '2. Recheck in 8 weeks',
  ].join('\n')

  const blocks = parseSummary(sample)
  assert.deepEqual(
    blocks.map((b) => b.type),
    ['heading', 'heading', 'paragraph', 'list', 'list']
  )
  assert.equal((blocks[3] as { ordered: boolean }).ordered, false)
  assert.equal((blocks[4] as { ordered: boolean }).ordered, true)
  assert.match(summaryToPlainText(sample), /pre-treatment for TRT/)
  assert.doesNotMatch(summaryToPlainText(sample), /\*\*|^#/)
})
