import assert from 'node:assert/strict'
import test from 'node:test'

import { plainText, publicSiteUrl, reviewView } from './view.ts'

const block = (text: string) => ({
  _type: 'block',
  style: 'normal',
  children: [{ _type: 'span', text }],
})

test('plain text matches the site: blocks and table cells joined with spaces', () => {
  assert.equal(
    plainText([
      block('One.'),
      { _type: 'table', rows: [{ cells: [{ content: [block('A')] }, { content: [block('B')] }] }] },
      { _type: 'image' },
    ]),
    'One. A B '
  )
})

test('a resource shows its title, body, and the meta description the page renders', () => {
  const long = 'x'.repeat(200)
  const view = reviewView({
    _id: 'r1',
    _rev: 'rev1',
    _type: 'resources',
    title: 'HCG dosing',
    slug: 'hcg-dosing',
    author: 'AlphaMD',
    content: [block(long)],
  })
  assert.equal(view?.title, 'HCG dosing')
  assert.equal(view?.metaDescription, `${'x'.repeat(150)}...`)
  assert.equal(view?.publicPath, '/resources/hcg-dosing')
  assert.equal(view?.rev, 'rev1')
  assert.equal(view?.byline, 'AlphaMD')
  assert.equal(view?.sections.length, 1)
})

test('an Ask Us Anything answer is titled by its question', () => {
  const view = reviewView({
    _id: 'a1',
    _rev: 'rev1',
    _type: 'askUsAnything',
    question: 'Is Hct 55% fine?',
    slug: 'is-hct-55-fine',
    answer: [block('No.')],
  })
  assert.equal(view?.title, 'Is Hct 55% fine?')
  assert.equal(view?.metaDescription, 'Is Hct 55% fine?')
  assert.equal(view?.publicPath, '/ask-us-anything/is-hct-55-fine')
  assert.deepEqual(view?.sections.map((s) => s.heading), ['Answer'])
})

test('a treatment page shows every clinical section, with the blurb as its description', () => {
  const view = reviewView({
    _id: 't1',
    _rev: 'rev1',
    _type: 'featuredTreatments',
    heroTitle: 'Testosterone Replacement Therapy, TRT',
    heroSubtitle: 'Online TRT',
    slug: { current: 'testosterone-replacement-therapy-trt' },
    blurb: 'TRT supports energy.',
    productDescription: [block('About TRT.')],
    benefits: ['Energy', 'Strength'],
    dosage: [block('Dosages vary.')],
    sideEffects: [block('Hematocrit can rise.')],
  })
  assert.equal(view?.title, 'Testosterone Replacement Therapy, TRT')
  assert.equal(view?.metaDescription, 'TRT supports energy.')
  assert.equal(view?.publicPath, '/featured-treatments/testosterone-replacement-therapy-trt')
  assert.deepEqual(
    view?.sections.map((s) => s.heading),
    [null, 'Benefits', 'Dosage', 'Side effects']
  )
  assert.deepEqual(view?.sections[1].items, ['Energy', 'Strength'])
})

test('a treatment page without a blurb falls back to its description, cut at 200', () => {
  const view = reviewView({
    _id: 't2',
    _rev: 'rev1',
    _type: 'featuredTreatments',
    heroTitle: 'Sermorelin',
    slug: { current: 'sermorelin' },
    productDescription: [block('y'.repeat(250))],
  })
  assert.equal(view?.metaDescription, `${'y'.repeat(200)}...`)
})

test('site-relative links open on the public site; absolute ones are left alone', () => {
  assert.equal(publicSiteUrl('/resources/x', 'https://www.alphamd.net/'), 'https://www.alphamd.net/resources/x')
  assert.equal(publicSiteUrl('https://www.fda.gov/x', 'https://www.alphamd.net'), 'https://www.fda.gov/x')
})

test('an unknown type has no review view', () => {
  assert.equal(reviewView({ _id: 'x', _rev: 'r', _type: 'helpArticle' }), null)
})
