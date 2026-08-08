import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyFile,
  displayFileName,
  downloadFileName,
  fileExtension,
  fileKindLabel,
  fileTypeName,
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

// The whole point of passing the MIME type: 1,847 of the 1,849 `.xlsx` paths in
// production are really PDFs or images. Trusting the extension both mislabels
// them and refuses to preview them.
const XLSX_PATH = 'original-test-results/test-results/02121ccf-2695-48a9-bd73-9dde9ab38a30.xlsx'

test('a PDF stored with an .xlsx extension is treated as a PDF', () => {
  assert.equal(classifyFile(XLSX_PATH, 'application/pdf'), 'pdf')
  assert.equal(fileKindLabel(XLSX_PATH, 'application/pdf'), 'PDF')
})

test('a JPEG stored with an .xlsx extension is treated as an image', () => {
  assert.equal(classifyFile(XLSX_PATH, 'image/jpeg'), 'image')
  assert.equal(fileKindLabel(XLSX_PATH, 'image/jpeg'), 'JPEG image')
})

test('a genuine spreadsheet is still unsupported, and reads as one', () => {
  const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  assert.equal(classifyFile(XLSX_PATH, xlsx), 'unsupported')
  assert.equal(fileKindLabel(XLSX_PATH, xlsx), 'Spreadsheet')
  assert.equal(fileTypeName(XLSX_PATH, xlsx), 'Excel')
})

test('MIME type beats a correct extension too, so both agree', () => {
  assert.equal(classifyFile('a/b.pdf', 'application/pdf'), 'pdf')
  assert.equal(fileKindLabel('a/b.png', 'image/png'), 'PNG image')
})

test('HEIC is recognised from its MIME type, not just its extension', () => {
  assert.equal(classifyFile(XLSX_PATH, 'image/heic'), 'unsupported')
  assert.equal(isUnrenderableImage(XLSX_PATH, 'image/heic'), true)
  assert.equal(fileKindLabel(XLSX_PATH, 'image/heic'), 'HEIC image')
})

test('TIFF and DNG are unsupported but not claimed to work in Safari', () => {
  assert.equal(classifyFile('a/b.tiff', 'image/tiff'), 'unsupported')
  assert.equal(isUnrenderableImage('a/b.tiff', 'image/tiff'), false)
  assert.equal(fileKindLabel('a/b.dng', 'image/x-adobe-dng'), 'DNG image')
})

test('a charset parameter does not defeat the lookup', () => {
  assert.equal(fileKindLabel('a/b.txt', 'text/plain; charset=utf-8'), 'Text file')
  assert.equal(classifyFile('a/b.txt', 'TEXT/PLAIN'), 'unsupported')
})

test('an uninformative MIME type defers to the extension', () => {
  // 6 production rows are `application/octet-stream`; treating that as a known
  // type would refuse to preview a perfectly good PDF.
  assert.equal(classifyFile('a/b.pdf', 'application/octet-stream'), 'pdf')
  assert.equal(fileKindLabel('a/b.pdf', 'application/octet-stream'), 'PDF')
  assert.equal(classifyFile('a/b.pdf', ''), 'pdf')
  assert.equal(classifyFile('a/b.pdf', null), 'pdf')
})

test('an unmapped MIME type is labelled without exposing the raw string', () => {
  assert.equal(fileKindLabel('a/b.odt', 'application/vnd.oasis.opendocument.text'), 'File')
  assert.equal(fileTypeName('a/b.odt', 'application/vnd.oasis.opendocument.text'), 'These')
  assert.equal(fileKindLabel('a/b.bmp', 'image/bmp'), 'BMP image')
})

test('displayFileName prefers the stored display name, else the basename', () => {
  assert.equal(displayFileName('bucket/x/y.pdf', 'Labs 08/05'), 'Labs 08/05')
  assert.equal(displayFileName('bucket/x/y.pdf', null), 'y.pdf')
  assert.equal(displayFileName(null, null), 'Untitled file')
})

test('downloadFileName saves a mislabelled file under its real extension', () => {
  // Display name has had the bogus `.xlsx` stripped; the download needs a real one.
  assert.equal(
    downloadFileName('02121ccf-2695-48a9-bd73-9dde9ab38a30', XLSX_PATH, 'application/pdf'),
    '02121ccf-2695-48a9-bd73-9dde9ab38a30.pdf'
  )
  assert.equal(downloadFileName('scan', XLSX_PATH, 'image/jpeg'), 'scan.jpg')
})

test('downloadFileName replaces a contradicted extension rather than stacking one', () => {
  assert.equal(downloadFileName('Labs.xlsx', XLSX_PATH, 'application/pdf'), 'Labs.pdf')
  assert.equal(downloadFileName('Labs.pdf', 'x/y.pdf', 'application/pdf'), 'Labs.pdf')
  assert.equal(downloadFileName('Photo.jpeg', 'x/y.jpeg', 'image/jpeg'), 'Photo.jpeg')
})

test('downloadFileName leaves a name that is not hiding an extension alone', () => {
  assert.equal(downloadFileName('Results v1.2', 'x/y.pdf', 'application/pdf'), 'Results v1.2.pdf')
  assert.equal(downloadFileName('Labs 08/05', 'x/y.pdf', 'application/pdf'), 'Labs 08/05.pdf')
})

test('downloadFileName falls back to the stored extension without a MIME type', () => {
  assert.equal(downloadFileName('report', 'x/y.pdf', null), 'report.pdf')
  assert.equal(downloadFileName('report', 'x/y', null), 'report')
})

test('displayFileName drops a generated name’s extension once the type is known', () => {
  assert.equal(displayFileName(XLSX_PATH, null, 'image/jpeg'), '02121ccf-2695-48a9-bd73-9dde9ab38a30')
  // A name the patient chose is theirs, extension and all.
  assert.equal(displayFileName(XLSX_PATH, 'Blood Panel.xlsx', 'image/jpeg'), 'Blood Panel.xlsx')
  // Without a MIME type there is nothing better to show, so nothing changes.
  assert.equal(displayFileName('bucket/x/y.xlsx', null), 'y.xlsx')
  assert.equal(displayFileName('bucket/x/y.xlsx', null, 'application/octet-stream'), 'y.xlsx')
})
