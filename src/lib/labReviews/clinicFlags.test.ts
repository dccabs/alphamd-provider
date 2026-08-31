import assert from 'node:assert/strict'
import test from 'node:test'

import { clinicFlag } from './clinicFlags.ts'

test('an Analyte with no Clinic flag stays quiet', () => {
  assert.equal(clinicFlag('Free Testosterone', '304.47 pg/mL'), null)
  assert.equal(clinicFlag('Total Testosterone', '1203 ng/dL'), null)
  assert.equal(clinicFlag('SHBG', '12.5 nmol/L'), null)
  assert.equal(clinicFlag('LH', '2.4 mIU/mL'), null)
})

test('hematocrit at 51 is approaching; past 51 is red', () => {
  assert.equal(clinicFlag('Hematocrit', '49.9%'), null)
  assert.equal(clinicFlag('Hematocrit', '50%'), 'yellow')
  assert.equal(clinicFlag('Hematocrit', '51%'), 'yellow')
  assert.equal(clinicFlag('Hematocrit', '51.1%'), 'red')
  assert.equal(clinicFlag('Hematocrit', '57.7%'), 'red')
})

test('a bare hematocrit number is still a percent', () => {
  assert.equal(clinicFlag('Hematocrit', '51'), 'yellow')
  assert.equal(clinicFlag('Hematocrit', '52'), 'red')
})

test('estradiol at 50 is red; 40 is approaching', () => {
  assert.equal(clinicFlag('Estradiol', '39.9 pg/mL'), null)
  assert.equal(clinicFlag('Estradiol', '40 pg/mL'), 'yellow')
  assert.equal(clinicFlag('Estradiol', '49.9 pg/mL'), 'yellow')
  assert.equal(clinicFlag('Estradiol', '50 pg/mL'), 'red')
  assert.equal(clinicFlag('Estradiol', '68.3 pg/mL'), 'red')
})

test('greater-than means just above that number', () => {
  assert.equal(clinicFlag('Hematocrit', '>51%'), 'red')
  assert.equal(clinicFlag('Hemoglobin', '>17.5 g/dL'), 'red')
  assert.equal(clinicFlag('Estradiol', '>40 pg/mL'), 'yellow')
  assert.equal(clinicFlag('Estradiol', '>50 pg/mL'), 'red')
})

test('less-than cannot prove a high Clinic flag', () => {
  assert.equal(clinicFlag('Estradiol', '<30 pg/mL'), null)
  assert.equal(clinicFlag('Estradiol', '<5.0 pg/mL'), null)
})

test('a mismatched unit is not colored', () => {
  assert.equal(clinicFlag('Estradiol', '68.3 Hpg/mL'), null)
  assert.equal(clinicFlag('Estradiol', '68.3'), null)
  assert.equal(clinicFlag('PSA', '25 % (calc)'), null)
  assert.equal(clinicFlag('PSA', '4.56 nmol/L'), null)
})

test('unit spelling on the report is not case-sensitive', () => {
  assert.equal(clinicFlag('Estradiol', '50 pg/ml'), 'red')
  assert.equal(clinicFlag('Hemoglobin', '18 g/dl'), 'red')
  assert.equal(clinicFlag('Hemoglobin', '18 gm/dL'), 'red')
  assert.equal(clinicFlag('PSA', '4.1 ng/ml'), 'red')
})

test('hemoglobin tracks the hematocrit companion lines', () => {
  assert.equal(clinicFlag('Hemoglobin', '16.4 g/dL'), null)
  assert.equal(clinicFlag('Hemoglobin', '16.5 g/dL'), 'yellow')
  assert.equal(clinicFlag('Hemoglobin', '17.5 g/dL'), 'yellow')
  assert.equal(clinicFlag('Hemoglobin', '17.6 g/dL'), 'red')
})

test('PSA at 4 is red; 2.5 is approaching', () => {
  assert.equal(clinicFlag('PSA', '2.4 ng/mL'), null)
  assert.equal(clinicFlag('PSA', '2.5 ng/mL'), 'yellow')
  assert.equal(clinicFlag('PSA', '3.9 ng/mL'), 'yellow')
  assert.equal(clinicFlag('PSA', '4.0 ng/mL'), 'red')
})

test('prolactin at 30 is red; 20 is approaching', () => {
  assert.equal(clinicFlag('Prolactin', '19.7 ng/mL'), null)
  assert.equal(clinicFlag('Prolactin', '20 ng/mL'), 'yellow')
  assert.equal(clinicFlag('Prolactin', '29.9 ng/mL'), 'yellow')
  assert.equal(clinicFlag('Prolactin', '30 ng/mL'), 'red')
  assert.equal(clinicFlag('Prolactin', '43.8 ng/mL'), 'red')
})
