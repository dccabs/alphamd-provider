import assert from 'node:assert/strict'
import test from 'node:test'

import { greetingName } from './patientName.ts'

/** Every case is a real row shape from `user_list`. */
const CASES: [
  { preferredName?: string | null; firstName?: string | null; lastName?: string | null },
  string | null,
  string,
][] = [
  [{ firstName: 'Marcus', lastName: 'Johnson' }, 'Marcus', 'the ordinary case'],
  [
    { preferredName: 'Rhom Saint-louis', firstName: 'Rhom', lastName: 'Saint-louis' },
    'Rhom',
    'a preferred name that is the full name — the common way this box is filled in',
  ],
  [
    { preferredName: 'Tim Spangler', firstName: 'Timothy', lastName: 'Spangler' },
    'Tim',
    'the preferred name still wins over the legal first name',
  ],
  [
    { preferredName: 'AJ Lovewins', firstName: 'Charles "AJ"', lastName: 'Barber' },
    'AJ',
    'a chosen name that matches neither name on file',
  ],
  [
    { preferredName: 'Karima Wilkins Smartt', firstName: 'Karima', lastName: 'Wilkins Smartt' },
    'Karima',
    'a two-word surname is removed whole',
  ],
  [
    { preferredName: 'Mary Jane Smith', firstName: 'Mary Jane', lastName: 'Smith' },
    'Mary Jane',
    'a two-word given name survives',
  ],
  [
    { preferredName: 'Francesco  Taormina', firstName: 'Francesco', lastName: 'Taormina' },
    'Francesco',
    'a double space does not defeat matching the surname',
  ],
  [{ preferredName: 'Jaime ', firstName: 'Jaime', lastName: 'Vasquez' }, 'Jaime', 'trailing space'],
  [
    { preferredName: 'michael soto', firstName: 'Isidro', lastName: 'Soto' },
    'michael',
    'the surname matches whatever case it was typed in',
  ],
  [
    { preferredName: 'John Smith', firstName: 'John Smith', lastName: null },
    'John',
    'no surname on file to match, so only the first word is safe',
  ],
  [{ preferredName: '  ', firstName: 'Sam', lastName: 'Vance' }, 'Sam', 'a blank preferred name'],
  [{ preferredName: null, firstName: null, lastName: 'Vance' }, null, 'nothing to go on'],
  [{}, null, 'no name at all rather than an empty greeting'],
]

for (const [patient, expected, description] of CASES) {
  test(`greetingName: ${description}`, () => {
    assert.equal(greetingName(patient), expected)
  })
}

test('a name that is only the surname is left alone rather than emptied', () => {
  // Nothing good to return, but a greeting is better than a blank.
  assert.equal(greetingName({ preferredName: 'Vance', lastName: 'Vance' }), 'Vance')
})
