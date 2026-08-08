import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyFile,
  displayFileName,
  fileExtension,
  fileKindLabel,
  isUnrenderableImage,
} from './files.ts'

const CASES: [string | null | undefined, ReturnType<typeof classifyFile>, string][] = [
  ['original-test-results/abc/report.pdf', 'pdf', 'pdf'],
  ['original-test-results/abc/REPORT.PDF', 'pdf', 'uppercase extension'],
  ['a/b.jpeg', 'image', 'jpeg'],
  ['a/b.jpg', 'image', 'jpg'],
  ['a/b.png', 'image', 'png'],
  ['a/b.webp', 'image', 'webp'],
  ['a/b.gif', 'image', 'gif'],
  ['a/b.heic', 'unsupported', 'heic — Chrome and Firefox cannot decode it'],
  ['a/b.HEIF', 'unsupported', 'heif, uppercase'],
  ['a/b.docx', 'unsupported', 'docx'],
  ['a/b.xlsx', 'unsupported', 'xlsx'],
  ['a/b.tiff', 'unsupported', 'tiff'],
  ['original-test-results/abc/scan', 'unsupported', 'no extension at all'],
  ['a.b/c', 'unsupported', 'dot in a directory, not the file'],
  ['.hidden', 'unsupported', 'leading dot is not an extension'],
  ['', 'unsupported', 'empty'],
  [null, 'unsupported', 'null'],
  [undefined, 'unsupported', 'undefined'],
]

for (const [input, expected, why] of CASES) {
  test(`classifyFile(${JSON.stringify(input)}) === ${expected} — ${why}`, () => {
    assert.equal(classifyFile(input), expected)
  })
}

test('fileExtension ignores a query string', () => {
  assert.equal(fileExtension('a/b.pdf?token=abc.def'), 'pdf')
})

test('isUnrenderableImage separates HEIC from other unsupported types', () => {
  assert.equal(isUnrenderableImage('a/b.heic'), true)
  assert.equal(isUnrenderableImage('a/b.heif'), true)
  assert.equal(isUnrenderableImage('a/b.docx'), false)
  assert.equal(isUnrenderableImage('a/b.pdf'), false)
})

test('fileKindLabel', () => {
  assert.equal(fileKindLabel('a/b.pdf'), 'PDF')
  assert.equal(fileKindLabel('a/b.jpeg'), 'JPEG image')
  assert.equal(fileKindLabel('a/b.heic'), 'HEIC file')
  assert.equal(fileKindLabel('a/b.xlsx'), 'XLSX file')
  assert.equal(fileKindLabel('a/b'), 'File')
})

// A real production path: the stored name uses a whole MIME type in place of an
// extension. It must classify as unsupported and must not render as
// "VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT file".
const MIME_AS_EXTENSION =
  'original-test-results/test-results/3b45db98-ef0b-41aa-9c04-ed906cdaef09.vnd.openxmlformats-officedocument.wordprocessingml.document'

test('a MIME type used as an extension is unsupported and labelled plainly', () => {
  assert.equal(classifyFile(MIME_AS_EXTENSION), 'unsupported')
  assert.equal(fileKindLabel(MIME_AS_EXTENSION), 'File')
  assert.equal(isUnrenderableImage(MIME_AS_EXTENSION), false)
})

test('displayFileName prefers the stored display name, else the basename', () => {
  assert.equal(displayFileName('bucket/x/y.pdf', 'Labs 08/05'), 'Labs 08/05')
  assert.equal(displayFileName('bucket/x/y.pdf', null), 'y.pdf')
  assert.equal(displayFileName(null, null), 'Untitled file')
})
