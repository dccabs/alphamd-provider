/**
 * What was in an order.
 *
 * There is no line-item table: `orders.additional_information` is a freeform
 * text column staff type the medications and sigs into, one per line. Measured
 * on production (15,498 non-empty rows):
 *
 *  - 84% are multi-line, and a medication's sig often continues onto the next
 *    line, so lines cannot be treated as independent medications.
 *  - 57% use `Name - sig`; the rest are bare names (`TRT`, `HCG`) or a pharmacy's
 *    own all-caps pick list with no separator at all.
 *  - **80% have `Shipped, Email sent on <date>` appended by the shipping
 *    automation.** That is not order contents and is stripped — the status badge
 *    already says shipped. One-off human notes that merely *mention* shipping
 *    ("System added tracking number to wrong order") are real and are kept, so
 *    the pattern matches the automation's exact shape and nothing looser.
 *
 * Parsing stays deliberately shallow: it splits a leading name off a line but
 * never regroups lines into medication objects. Guessing which sig belongs to
 * which drug from this text would risk showing a provider a dose attributed to
 * the wrong medication.
 */

export type OrderLine = {
  /** Leading medication name, when the line has an explicit separator. */
  name: string | null
  /** The rest of the line, or the whole line when no name was split off. */
  detail: string
}

/**
 * `Shipped, Email sent on 6/18/2025` exactly — optionally trailing punctuation.
 * Trailing commentary in parentheses is left alone: one such row explains that
 * the patient received the wrong drug, which a provider needs to see.
 */
const SHIPPING_AUTOMATION_NOTE = /^shipped,\s*email sent on\s*\d{1,2}\/\d{1,2}\/\d{2,4}\s*\.?$/i

/** Hyphen, en dash and em dash all appear as the name separator in production. */
const NAME_SEPARATOR = /\s+[-–—]\s+/

/**
 * Longer than any real drug name in the column, but short enough that a
 * pharmacy pick list or a prose note keeps its full text instead of being
 * bolded as if it were a name.
 */
const MAX_NAME_LENGTH = 60

export function orderContentLines(additionalInformation: string | null): OrderLine[] {
  if (!additionalInformation) return []

  return additionalInformation
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !SHIPPING_AUTOMATION_NOTE.test(line))
    .map((line) => {
      const separator = line.match(NAME_SEPARATOR)
      if (!separator || separator.index === undefined) return { name: null, detail: line }

      const name = line.slice(0, separator.index).trim()
      const detail = line.slice(separator.index + separator[0].length).trim()
      if (!name || !detail || name.length > MAX_NAME_LENGTH) return { name: null, detail: line }

      return { name, detail }
    })
}
