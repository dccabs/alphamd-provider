/**
 * Ported from alphamd `components/EmailTemplates/PricingProtocolEmail.tsx`.
 *
 * The HTML the patient sees when a recommended protocol is emailed. Kept as a
 * copy rather than an HTTP call into that app; markup changes here should be
 * mirrored there, or this file replaced by a shared package.
 */
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
  Hr,
  Row,
  Column,
} from '@react-email/components'
import * as React from 'react'

import type { StructuredPricingData } from './structuredPricing'

export type { StructuredPricingData }

interface PricingProtocolEmailProps {
  firstName?: string
  emailContent: string
  hideReplyButton?: boolean
  /** When provided, renders a structured pricing breakdown instead of parsing plain text */
  pricingData?: StructuredPricingData
}

const baseUrl = process.env.NEXT_PUBLIC_DEFAULT_URL || 'https://www.alphamd.org'
const confirmProtocolUrl = `${baseUrl}/profile/recommended-protocol`

// Helper function to parse sections from email content
const parseEmailSections = (content: string) => {
  const sections: Record<string, string[]> = {
    greeting: [],
    protocol: [],
    pricing: [],
    howItWorks: [],
    seamlessSupply: [],
    bankStatement: [],
    firstOrder: [],
    approval: [],
    other: [],
  }

  let currentSection = 'greeting'
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmedLine = line.trim()

    // Detect section markers
    if (trimmedLine.startsWith('RECOMMENDED PROTOCOL:')) {
      currentSection = 'protocol'
      continue
    } else if (trimmedLine.startsWith('PRICING BREAKDOWN:')) {
      currentSection = 'pricing'
      continue
    } else if (trimmedLine.startsWith('HOW IT WORKS:')) {
      currentSection = 'howItWorks'
      continue
    } else if (trimmedLine.startsWith('SEAMLESS SUPPLY:')) {
      currentSection = 'seamlessSupply'
      continue
    } else if (trimmedLine.startsWith('BANK STATEMENT:')) {
      currentSection = 'bankStatement'
      continue
    } else if (trimmedLine.startsWith('FIRST ORDER:')) {
      currentSection = 'firstOrder'
      continue
    } else if (trimmedLine.startsWith('APPROVAL:')) {
      currentSection = 'approval'
      continue
    } else if (trimmedLine.startsWith('PAYMENT TERMS:')) {
      // Keep payment terms in pricing section
      sections.pricing.push(line)
      continue
    }

    sections[currentSection].push(line)
  }

  return sections
}

// Helper to render How It Works table rows and footnotes
const parseHowItWorksTable = (lines: string[]) => {
  const rows: { activity: string; frequency: string; description: string }[] =
    []
  const footnotes: string[] = []

  for (const line of lines) {
    if (line.includes('|')) {
      const parts = line.split('|').map((p) => p.trim())
      if (parts.length >= 3 && parts[0] && !parts[0].startsWith('-')) {
        rows.push({
          activity: parts[0],
          frequency: parts[1],
          description: parts[2],
        })
      }
    } else if (line.trim()) {
      footnotes.push(line.trim())
    }
  }

  return { rows, footnotes }
}

export const PricingProtocolEmail: React.FC<
  Readonly<PricingProtocolEmailProps>
> = ({ emailContent, hideReplyButton = false, pricingData }) => {
  const sections = parseEmailSections(emailContent)
  const { rows: howItWorksRows, footnotes: howItWorksFootnotes } = parseHowItWorksTable(sections.howItWorks)
  const hasStructuredPricing = !!pricingData
  const sub = pricingData?.subscription ?? null
  const anc = pricingData?.ancillary ?? null
  const hasSubPricing = sub !== null && sub.totalDueToday > 0
  const hasAncPricing = anc !== null && anc.lineItems.length > 0

  return (
    <Html>
      <Head />
      <Preview>
        AlphaMD recommended protocol and pricing details for your treatment plan
      </Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header Section */}
          <Section style={header}>
            <Img
              src={`${baseUrl}/images/logo.png`}
              width="120"
              alt="AlphaMD"
              style={logo}
            />
          </Section>

          <Hr style={divider} />

          {/* Main Content Section */}
          <Section style={contentSection}>
            {/* Greeting */}
            <Text style={tagline}>Your Treatment Plan</Text>
            <Heading style={title}>Recommended Protocol & Pricing</Heading>

            {/* Greeting Text */}
            {sections.greeting.length > 0 && (
              <Section style={greetingSection}>
                {sections.greeting.map((line, index) => {
                  if (line.trim() === '') return <div key={index} style={spacer} />
                  return (
                    <Text key={index} style={bodyText}>
                      {line}
                    </Text>
                  )
                })}
              </Section>
            )}

            {/* Prominent CTA at Top */}
            {!hideReplyButton && (
              <Section style={prominentCtaSection}>
                <div style={prominentCtaBox}>
                  <Text style={prominentCtaTitle}>
                    Ready to Get Started?
                  </Text>
                  <Text style={prominentCtaText}>
                    Review your protocol below, then click the button to log into your AlphaMD account and confirm your treatment plan.
                  </Text>
                  <Button style={prominentButton} href={confirmProtocolUrl}>
                    Click Here to Confirm Your Protocol
                  </Button>
                  <Text style={prominentCtaSubtext}>
                    You&apos;ll need to log in to confirm. Forgot your password? Use the &quot;Forgot Password&quot; link on the login page to reset it.
                  </Text>
                </div>
              </Section>
            )}

            {/* Recommended Protocol Section */}
            {sections.protocol.length > 0 && (
              <Section style={protocolSection}>
                <Text style={sectionHeader}>YOUR RECOMMENDED PROTOCOL</Text>
                <div style={protocolBox}>
                  {sections.protocol.map((line, index) => {
                    if (line.trim() === '') return null
                    if (line.startsWith('•') || line.startsWith('-')) {
                      // Parse medication name and description
                      const content = line.replace(/^[•-]\s*/, '')
                      const colonIndex = content.indexOf(':')
                      
                      if (colonIndex > 0) {
                        const medicationName = content.substring(0, colonIndex).trim()
                        const description = content.substring(colonIndex + 1).trim()
                        
                        return (
                          <div key={index} style={medicationItem}>
                            <Text style={medicationName_style}>{medicationName}</Text>
                            <Text style={medicationDescription}>{description}</Text>
                          </div>
                        )
                      }
                      
                      return (
                        <Text key={index} style={bulletPoint}>
                          {line}
                        </Text>
                      )
                    }
                    return (
                      <Text key={index} style={protocolText}>
                        {line}
                      </Text>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* Subtle CTA after Protocol */}
            {!hideReplyButton && sections.protocol.length > 0 && (
              <Section style={subtleCtaSection}>
                <Text style={subtleCtaText}>
                  Ready to confirm?{' '}
                  <Link href={confirmProtocolUrl} style={subtleCtaLink}>
                    Click here to log in and approve your protocol
                  </Link>
                  . (Forgot password? Reset it on the login page.)
                </Text>
              </Section>
            )}

            {/* Pricing Breakdown Section — structured or fallback plain-text */}
            {hasStructuredPricing ? (
              <Section style={pricingSection}>
                <Text style={sectionHeader}>PRICING BREAKDOWN</Text>
                <div style={pricingBox}>
                  {/* ---- SUBSCRIPTION ---- */}
                  {hasSubPricing && sub && (
                    <>
                      {/* Product */}
                      <Row style={priceRow}>
                        <Column style={priceLabel}>Product</Column>
                        <Column style={priceValueBold}>{sub.productName}</Column>
                      </Row>

                      {/* Dosage */}
                      {sub.dosage && sub.dosage !== 'N/A' && (
                        <Row style={priceRow}>
                          <Column style={priceLabel}>Dosage</Column>
                          <Column style={priceValue}>{sub.dosage}</Column>
                        </Row>
                      )}

                      {/* Billing Period */}
                      {sub.durationLabel && sub.durationLabel !== 'N/A' && (
                        <Row style={priceRow}>
                          <Column style={priceLabel}>Billing Period</Column>
                          <Column style={priceValue}>{sub.durationLabel}</Column>
                        </Row>
                      )}

                      <Hr style={priceDivider} />

                      {/* Monthly heading */}
                      <Text style={priceGroupHeading}>Monthly</Text>

                      {/* Base Price */}
                      <Row style={priceRow}>
                        <Column style={priceLabel}>Base Price</Column>
                        <Column style={priceValue}>${sub.monthlyPrice.toFixed(2)}/mo</Column>
                      </Row>

                      {/* Add-ons */}
                      {sub.addonBreakdown.map((addon, i) => (
                        <Row key={`addon-${i}`} style={priceRow}>
                          <Column style={priceLabel}>{addon.name}</Column>
                          <Column style={priceValueGreen}>+${addon.amount.toFixed(2)}/mo</Column>
                        </Row>
                      ))}

                      {/* Before Discounts + Discounts */}
                      {sub.monthlyDiscountBreakdown.length > 0 && (
                        <>
                          <Hr style={priceDividerLight} />
                          <Row style={priceRow}>
                            <Column style={priceLabelMedium}>Before Discounts</Column>
                            <Column style={priceValue}>${sub.priceBeforeDiscounts.toFixed(2)}/mo</Column>
                          </Row>
                          {sub.monthlyDiscountBreakdown.map((disc, i) => (
                            <Row key={`disc-${i}`} style={priceRow}>
                              <Column style={priceLabel}>{disc.name}</Column>
                              <Column style={priceValueRed}>-${disc.amount.toFixed(2)}/mo</Column>
                            </Row>
                          ))}
                          <Row style={priceRow}>
                            <Column style={priceLabelMedium}>Monthly Subtotal</Column>
                            <Column style={priceValueBold}>${sub.monthlyAfterDiscounts.toFixed(2)}/mo</Column>
                          </Row>
                        </>
                      )}

                      <Hr style={priceDivider} />

                      {/* Billing Period Total */}
                      <Text style={priceGroupHeading}>{sub.durationLabel} Total</Text>

                      {sub.durationMonths > 1 && (
                        <Row style={priceRow}>
                          <Column style={priceLabel}>
                            ${sub.monthlyAfterDiscounts.toFixed(2)} x {sub.durationMonths} mo
                          </Column>
                          <Column style={priceValue}>${sub.billingPeriodTotal.toFixed(2)}</Column>
                        </Row>
                      )}

                      {/* Overall Discounts */}
                      {sub.overallDiscountBreakdown.length > 0 && (
                        <>
                          {sub.overallDiscountBreakdown.map((disc, i) => (
                            <Row key={`odisc-${i}`} style={priceRow}>
                              <Column style={priceLabel}>{disc.name}</Column>
                              <Column style={priceValueRed}>-${disc.amount.toFixed(2)}</Column>
                            </Row>
                          ))}
                          <Row style={priceRow}>
                            <Column style={priceLabelMedium}>Subtotal After Discounts</Column>
                            <Column style={priceValue}>${sub.subtotalAfterAllDiscounts.toFixed(2)}</Column>
                          </Row>
                        </>
                      )}

                      {/* Tax */}
                      {sub.taxRate > 0 && (
                        <Row style={priceRow}>
                          <Column style={priceLabel}>Tax ({(sub.taxRate * 100).toFixed(1)}%)</Column>
                          <Column style={priceValue}>${sub.taxAmount.toFixed(2)}</Column>
                        </Row>
                      )}

                      {/* Subscription Total */}
                      {hasAncPricing && (
                        <Row style={priceRowHighlight}>
                          <Column style={priceLabelBold}>Subscription Total</Column>
                          <Column style={priceValueBold}>${sub.totalDueToday.toFixed(2)}</Column>
                        </Row>
                      )}

                    </>
                  )}

                  {/* ---- ANCILLARY ---- */}
                  {hasAncPricing && anc && (
                    <>
                      {hasSubPricing && <Hr style={priceDivider} />}
                      <Text style={priceGroupHeading}>Ancillary Medications (One-time)</Text>

                      {anc.lineItems.map((item, i) => (
                        <React.Fragment key={`anc-${i}`}>
                          <Row style={priceRow}>
                            <Column style={priceLabel}>
                              {item.name}
                              {item.tier_label ? ` (${item.tier_label})` : ''}
                            </Column>
                            <Column style={priceValue}>
                              {item.subtotal > 0 ? `$${item.subtotal.toFixed(2)}` : 'Included'}
                            </Column>
                          </Row>
                          {item.quantity != null && item.quantity > 0 && (
                            <Row style={priceRow}>
                              <Column style={priceDetail}>
                                {item.quantity} x ${item.unit_price.toFixed(2)}
                                {item.processing_fee > 0 ? ` + $${item.processing_fee.toFixed(2)} fee` : ''}
                              </Column>
                              <Column style={priceValue}>{''}</Column>
                            </Row>
                          )}
                          {item.tax_amount > 0 && (
                            <Row style={priceRow}>
                              <Column style={priceDetail}>
                                Tax ({(item.tax_rate * 100).toFixed(1)}%)
                              </Column>
                              <Column style={priceDetailValue}>${item.tax_amount.toFixed(2)}</Column>
                            </Row>
                          )}
                        </React.Fragment>
                      ))}

                      <Row style={priceRowHighlight}>
                        <Column style={priceLabelBold}>Ancillary Total</Column>
                        <Column style={priceValueBold}>${anc.total.toFixed(2)}</Column>
                      </Row>
                    </>
                  )}

                  {/* ---- GRAND TOTAL ---- */}
                  <Hr style={priceDivider} />
                  <Row style={grandTotalRow}>
                    <Column style={grandTotalLabel}>Total Due Today</Column>
                    <Column style={grandTotalValue}>${pricingData!.grandTotal.toFixed(2)}</Column>
                  </Row>
                </div>
              </Section>
            ) : sections.pricing.length > 0 ? (
              <Section style={pricingSection}>
                <Text style={sectionHeader}>PRICING BREAKDOWN</Text>
                <div style={pricingBox}>
                  {sections.pricing.map((line, index) => {
                    const trimmed = line.trim()
                    if (trimmed === '') return <div key={index} style={smallSpacer} />
                    if (trimmed.startsWith('PAYMENT TERMS:')) {
                      return (
                        <Text key={index} style={pricingSubheader}>
                          {trimmed}
                        </Text>
                      )
                    }
                    if (trimmed.includes('Grand Total') || trimmed.includes('Monthly Grand Total')) {
                      return (
                        <Text key={index} style={grandTotalLine}>
                          {line}
                        </Text>
                      )
                    }
                    if (
                      trimmed.includes('Monthly') ||
                      trimmed.includes('Total') ||
                      trimmed.includes('Cost') ||
                      trimmed.includes('Tax') ||
                      trimmed.includes('$') ||
                      trimmed.includes('Program Fee') ||
                      trimmed.includes('Discount')
                    ) {
                      return (
                        <Text key={index} style={pricingLine}>
                          {line}
                        </Text>
                      )
                    }
                    if (trimmed.startsWith('Applied Discount')) {
                      return (
                        <Text key={index} style={discountLine}>
                          {line}
                        </Text>
                      )
                    }
                    return (
                      <Text key={index} style={pricingText}>
                        {line}
                      </Text>
                    )
                  })}
                </div>
              </Section>
            ) : null}

            {/* Subtle CTA after Pricing */}
            {!hideReplyButton && (hasStructuredPricing || sections.pricing.length > 0) && (
              <Section style={subtleCtaSection}>
                <Text style={subtleCtaText}>
                  Questions about pricing?{' '}
                  <Link href={confirmProtocolUrl} style={subtleCtaLink}>
                    Log in to your account
                  </Link>
                  {' '}to review details or ask questions. (Use &quot;Forgot Password&quot; if needed.)
                </Text>
              </Section>
            )}

            {/* How It Works Section - Table */}
            {howItWorksRows.length > 0 && (
              <Section style={howItWorksSection}>
                <Text style={sectionHeader}>HOW IT WORKS</Text>
                <div style={tableContainer}>
                  {/* Table Header */}
                  <Row style={tableHeaderRow}>
                    <Column style={tableHeaderCell}>Activity</Column>
                    <Column style={tableHeaderCell}>Frequency</Column>
                    <Column style={tableHeaderCellWide}>What it Covers</Column>
                  </Row>
                  {/* Table Rows */}
                  {howItWorksRows.map((row, index) => (
                    <Row
                      key={index}
                      style={index % 2 === 0 ? tableRow : tableRowAlt}
                    >
                      <Column style={tableCell}>
                        <Text style={tableCellText}>{row.activity}</Text>
                      </Column>
                      <Column style={tableCell}>
                        <Text style={tableCellTextBold}>{row.frequency}</Text>
                      </Column>
                      <Column style={tableCellWide}>
                        <Text style={tableCellText}>{row.description}</Text>
                      </Column>
                    </Row>
                  ))}
                </div>
                {howItWorksFootnotes.length > 0 && (
                  <div>
                    {howItWorksFootnotes.map((note, index) => (
                      <Text key={index} style={footnoteText}>
                        {note}
                      </Text>
                    ))}
                  </div>
                )}
              </Section>
            )}

            {/* Subtle CTA after How It Works */}
            {!hideReplyButton && howItWorksRows.length > 0 && (
              <Section style={subtleCtaSection}>
                <Text style={subtleCtaText}>
                  Like what you see?{' '}
                  <Link href={confirmProtocolUrl} style={subtleCtaLink}>
                    Click here to confirm your protocol
                  </Link>
                  {' '}(login required - reset password if needed).
                </Text>
              </Section>
            )}

            {/* Seamless Supply Section */}
            {sections.seamlessSupply.length > 0 && (
              <Section style={infoBoxSection}>
                <div style={infoBox}>
                  <Text style={infoBoxTitle}>📦 Seamless Supply</Text>
                  {sections.seamlessSupply.map((line, index) => {
                    if (line.trim() === '') return null
                    return (
                      <Text key={index} style={infoBoxText}>
                        {line}
                      </Text>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* Bank Statement Section */}
            {sections.bankStatement.length > 0 && (
              <Section style={infoBoxSection}>
                <div style={infoBoxAlt}>
                  <Text style={infoBoxTitle}>💳 What to Expect on Your Bank Statement</Text>
                  {sections.bankStatement.map((line, index) => {
                    if (line.trim() === '') return null
                    return (
                      <Text key={index} style={infoBoxText}>
                        {line}
                      </Text>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* First Order Section */}
            {sections.firstOrder.length > 0 && (
              <Section style={infoBoxSection}>
                <div style={firstOrderBox}>
                  <Text style={infoBoxTitle}>📦 Your First Order</Text>
                  {sections.firstOrder.map((line, index) => {
                    const trimmed = line.trim()
                    if (trimmed === '') return null
                    if (
                      trimmed.startsWith('Processing') ||
                      trimmed.startsWith('Shipping') ||
                      trimmed.startsWith('Tracking') ||
                      trimmed.startsWith('•') ||
                      trimmed.startsWith('-')
                    ) {
                      return (
                        <Text key={index} style={firstOrderItem}>
                          {trimmed.startsWith('•') || trimmed.startsWith('-')
                            ? line
                            : `• ${line}`}
                        </Text>
                      )
                    }
                    return (
                      <Text key={index} style={infoBoxText}>
                        {line}
                      </Text>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* Subtle CTA after First Order */}
            {!hideReplyButton && sections.firstOrder.length > 0 && (
              <Section style={subtleCtaSection}>
                <Text style={subtleCtaText}>
                  Ready to start your treatment?{' '}
                  <Link href={confirmProtocolUrl} style={subtleCtaLink}>
                    Log in and confirm your protocol
                  </Link>
                  {' '}to begin. (Forgot password? Reset it on the login page.)
                </Text>
              </Section>
            )}

            <Hr style={divider} />

            {/* Approval CTA Section */}
            {sections.approval.length > 0 && (
              <Section style={approvalSection}>
                {sections.approval.map((line, index) => {
                  if (line.trim() === '') return null
                  return (
                    <Text key={index} style={approvalText}>
                      {line}
                    </Text>
                  )
                })}
              </Section>
            )}

            {/* Prominent CTA at Bottom */}
            {!hideReplyButton && (
              <Section style={prominentCtaSection}>
                <div style={prominentCtaBox}>
                  <Text style={prominentCtaTitle}>
                    Ready to Get Started?
                  </Text>
                  <Text style={prominentCtaText}>
                    Click the button below to log into your AlphaMD account and confirm your protocol.
                    Once confirmed, we&apos;ll begin processing your treatment plan.
                  </Text>
                  <Button style={prominentButton} href={confirmProtocolUrl}>
                    Click Here to Confirm Your Protocol
                  </Button>
                  <Text style={prominentCtaSubtext}>
                    You&apos;ll need to log in to confirm. Forgot your password? Use the &quot;Forgot Password&quot; link on the login page to reset it.
                  </Text>
                </div>
              </Section>
            )}

            {/* Signature */}
            <Section style={signatureSection}>
              <Text style={signatureText}>
                Best regards,
                <br />
                The AlphaMD Team
              </Text>
            </Section>
          </Section>

          <Hr style={divider} />

          {/* Footer Section */}
          <Section style={footer}>
            <Text style={footerText}>
              Questions? Contact us at{' '}
              <Link href="mailto:contact@alphamd.org" style={link}>
                contact@alphamd.org
              </Link>
            </Text>
            <Text style={footerText}>
              Thank you for choosing AlphaMD for your healthcare needs.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default PricingProtocolEmail

// Styles
const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen-Sans,Ubuntu,Cantarell,"Helvetica Neue",sans-serif',
}

const container = {
  margin: '0 auto',
  padding: '20px 0 48px',
  maxWidth: '600px',
}

const header = {
  padding: '20px 0',
  textAlign: 'center' as const,
}

const logo = {
  margin: '0 auto',
}

const divider = {
  borderColor: '#e6ebf1',
  margin: '20px 0',
}

const contentSection = {
  padding: '0 20px',
}

const greetingSection = {
  marginTop: '24px',
  textAlign: 'left' as const,
}

const tagline = {
  margin: '16px 0',
  fontWeight: '600',
  fontSize: '18px',
  color: '#0891b2',
  lineHeight: '28px',
  textAlign: 'center' as const,
}

const title = {
  margin: '0',
  marginTop: '8px',
  fontWeight: '600',
  fontSize: '32px',
  color: '#111827',
  lineHeight: '40px',
  textAlign: 'center' as const,
}

const bodyText = {
  fontSize: '16px',
  color: '#374151',
  lineHeight: '24px',
  textAlign: 'left' as const,
  margin: '8px 0',
}

const sectionHeader = {
  fontSize: '16px',
  fontWeight: '700',
  color: '#0891b2',
  margin: '24px 0 12px 0',
  lineHeight: '24px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
}

// Protocol Section Styles
const protocolSection = {
  marginTop: '24px',
}

const protocolBox = {
  backgroundColor: '#f0fdfa',
  border: '1px solid #99f6e4',
  borderRadius: '8px',
  padding: '20px',
  marginTop: '12px',
}

const protocolText = {
  fontSize: '15px',
  color: '#134e4a',
  lineHeight: '22px',
  margin: '6px 0',
}

const bulletPoint = {
  fontSize: '15px',
  color: '#134e4a',
  lineHeight: '22px',
  margin: '8px 0',
  paddingLeft: '8px',
}

const medicationItem = {
  marginBottom: '20px',
  paddingBottom: '16px',
  borderBottom: '1px solid #ccfbf1',
}

const medicationName_style = {
  fontSize: '17px',
  fontWeight: '700',
  color: '#0f766e',
  lineHeight: '24px',
  margin: '0 0 8px 0',
  display: 'block' as const,
}

const medicationDescription = {
  fontSize: '15px',
  color: '#134e4a',
  lineHeight: '24px',
  margin: '0',
  display: 'block' as const,
}

// Pricing Section Styles
const pricingSection = {
  marginTop: '24px',
}

const pricingBox = {
  backgroundColor: '#fafafa',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '20px',
  marginTop: '12px',
}

const pricingSubheader = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#374151',
  margin: '16px 0 8px 0',
  lineHeight: '20px',
}

const pricingLine = {
  fontSize: '15px',
  color: '#111827',
  lineHeight: '24px',
  margin: '6px 0',
}

const pricingText = {
  fontSize: '14px',
  color: '#6b7280',
  lineHeight: '20px',
  margin: '4px 0',
}

const discountLine = {
  fontSize: '15px',
  color: '#059669',
  lineHeight: '24px',
  margin: '6px 0',
  fontWeight: '500',
}

const grandTotalLine = {
  fontSize: '18px',
  fontWeight: '700',
  color: '#111827',
  lineHeight: '28px',
  margin: '12px 0 4px 0',
  borderTop: '1px solid #e5e7eb',
  paddingTop: '12px',
}

// How It Works Table Styles
const howItWorksSection = {
  marginTop: '32px',
}

const howItWorksIntro = {
  fontSize: '14px',
  color: '#6b7280',
  lineHeight: '20px',
  margin: '8px 0 16px 0',
}

const tableContainer = {
  width: '100%',
  borderCollapse: 'collapse' as const,
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  overflow: 'hidden',
}

const tableHeaderRow = {
  backgroundColor: '#0891b2',
}

const tableHeaderCell = {
  padding: '12px 16px',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: '600',
  textAlign: 'left' as const,
  width: '25%',
}

const tableHeaderCellWide = {
  padding: '12px 16px',
  color: '#ffffff',
  fontSize: '13px',
  fontWeight: '600',
  textAlign: 'left' as const,
  width: '50%',
}

const tableRow = {
  backgroundColor: '#ffffff',
}

const tableRowAlt = {
  backgroundColor: '#f9fafb',
}

const tableCell = {
  padding: '12px 16px',
  borderBottom: '1px solid #e5e7eb',
  verticalAlign: 'top' as const,
  width: '25%',
}

const tableCellWide = {
  padding: '12px 16px',
  borderBottom: '1px solid #e5e7eb',
  verticalAlign: 'top' as const,
  width: '50%',
}

const tableCellText = {
  fontSize: '14px',
  color: '#374151',
  lineHeight: '20px',
  margin: '0',
}

const tableCellTextBold = {
  fontSize: '14px',
  color: '#111827',
  lineHeight: '20px',
  margin: '0',
  fontWeight: '600',
}

// Info Box Styles
const infoBoxSection = {
  marginTop: '20px',
}

const infoBox = {
  backgroundColor: '#f0fdfa',
  border: '1px solid #99f6e4',
  borderRadius: '8px',
  padding: '20px',
}

const infoBoxAlt = {
  backgroundColor: '#fef3c7',
  border: '1px solid #fcd34d',
  borderRadius: '8px',
  padding: '20px',
}

const firstOrderBox = {
  backgroundColor: '#eff6ff',
  border: '1px solid #93c5fd',
  borderRadius: '8px',
  padding: '20px',
}

const infoBoxTitle = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#111827',
  margin: '0 0 12px 0',
  lineHeight: '24px',
}

const infoBoxText = {
  fontSize: '14px',
  color: '#374151',
  lineHeight: '22px',
  margin: '8px 0',
}

const firstOrderItem = {
  fontSize: '14px',
  color: '#1e40af',
  lineHeight: '22px',
  margin: '6px 0',
  paddingLeft: '8px',
}

// Approval Section Styles
const approvalSection = {
  marginTop: '24px',
  textAlign: 'center' as const,
}

const approvalText = {
  fontSize: '16px',
  color: '#374151',
  lineHeight: '26px',
  margin: '8px 0',
  textAlign: 'center' as const,
}

// CTA Styles
const ctaSection = {
  marginTop: '24px',
  textAlign: 'center' as const,
}

const ctaText = {
  fontSize: '15px',
  color: '#6b7280',
  lineHeight: '24px',
  textAlign: 'center' as const,
  margin: '16px 0',
}

const ctaSubtext = {
  fontSize: '13px',
  color: '#9ca3af',
  lineHeight: '20px',
  textAlign: 'center' as const,
  margin: '12px 0 0 0',
}

// Prominent CTA Styles (Top of Email)
const prominentCtaSection = {
  marginTop: '32px',
  marginBottom: '8px',
}

const prominentCtaBox = {
  backgroundColor: '#0891b2',
  borderRadius: '12px',
  padding: '28px 24px',
  textAlign: 'center' as const,
}

const prominentCtaTitle = {
  fontSize: '22px',
  fontWeight: '700',
  color: '#ffffff',
  margin: '0 0 12px 0',
  lineHeight: '28px',
}

const prominentCtaText = {
  fontSize: '15px',
  color: '#e0f2fe',
  lineHeight: '24px',
  margin: '0 0 20px 0',
}

const prominentButton = {
  borderRadius: '8px',
  backgroundColor: '#ffffff',
  paddingLeft: '32px',
  paddingRight: '32px',
  paddingTop: '16px',
  paddingBottom: '16px',
  fontWeight: '700',
  color: '#0891b2',
  fontSize: '16px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
}

const prominentCtaSubtext = {
  fontSize: '12px',
  color: '#bae6fd',
  lineHeight: '18px',
  margin: '16px 0 0 0',
}

// Subtle CTA Styles (Between Sections)
const subtleCtaSection = {
  marginTop: '16px',
  marginBottom: '8px',
  textAlign: 'center' as const,
}

const subtleCtaText = {
  fontSize: '14px',
  color: '#6b7280',
  lineHeight: '22px',
  margin: '0',
  fontStyle: 'italic' as const,
}

const subtleCtaLink = {
  color: '#0891b2',
  textDecoration: 'underline',
  fontWeight: '500',
}

const button = {
  marginTop: '8px',
  borderRadius: '8px',
  backgroundColor: '#0891b2',
  paddingLeft: '40px',
  paddingRight: '40px',
  paddingTop: '14px',
  paddingBottom: '14px',
  fontWeight: '600',
  color: '#ffffff',
  fontSize: '16px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
}

// Signature Styles
const signatureSection = {
  marginTop: '32px',
  textAlign: 'center' as const,
}

const signatureText = {
  fontSize: '15px',
  color: '#374151',
  lineHeight: '24px',
  margin: '0',
}

// Footer Styles
const footer = {
  padding: '20px',
  textAlign: 'center' as const,
}

const footerText = {
  fontSize: '14px',
  color: '#6b7280',
  lineHeight: '20px',
  margin: '8px 0',
}

const link = {
  color: '#0891b2',
  textDecoration: 'underline',
}

const spacer = {
  height: '16px',
}

const smallSpacer = {
  height: '8px',
}

const footnoteText = {
  fontSize: '13px',
  color: '#6b7280',
  lineHeight: '20px',
  margin: '8px 0 0 0',
  fontStyle: 'italic' as const,
}

// ---- Structured Pricing Row Styles ----
const priceRow = {
  width: '100%',
  marginBottom: '2px',
}

const priceRowHighlight = {
  width: '100%',
  marginBottom: '2px',
  paddingTop: '6px',
}

const priceLabel = {
  fontSize: '14px',
  color: '#6b7280',
  lineHeight: '24px',
  verticalAlign: 'baseline' as const,
  paddingRight: '12px',
}

const priceLabelMedium = {
  fontSize: '14px',
  fontWeight: '500',
  color: '#4b5563',
  lineHeight: '24px',
  verticalAlign: 'baseline' as const,
  paddingRight: '12px',
}

const priceLabelBold = {
  fontSize: '14px',
  fontWeight: '600',
  color: '#1f2937',
  lineHeight: '24px',
  verticalAlign: 'baseline' as const,
  paddingRight: '12px',
}

const priceValue = {
  fontSize: '14px',
  fontWeight: '500',
  color: '#111827',
  lineHeight: '24px',
  textAlign: 'right' as const,
  verticalAlign: 'baseline' as const,
}

const priceValueBold = {
  fontSize: '14px',
  fontWeight: '700',
  color: '#111827',
  lineHeight: '24px',
  textAlign: 'right' as const,
  verticalAlign: 'baseline' as const,
}

const priceValueGreen = {
  fontSize: '14px',
  fontWeight: '500',
  color: '#15803d',
  lineHeight: '24px',
  textAlign: 'right' as const,
  verticalAlign: 'baseline' as const,
}

const priceValueRed = {
  fontSize: '14px',
  fontWeight: '500',
  color: '#dc2626',
  lineHeight: '24px',
  textAlign: 'right' as const,
  verticalAlign: 'baseline' as const,
}

const priceDetail = {
  fontSize: '12px',
  color: '#9ca3af',
  lineHeight: '20px',
  paddingLeft: '8px',
  verticalAlign: 'baseline' as const,
}

const priceDetailValue = {
  fontSize: '12px',
  color: '#6b7280',
  lineHeight: '20px',
  textAlign: 'right' as const,
  verticalAlign: 'baseline' as const,
}

const priceGroupHeading = {
  fontSize: '11px',
  fontWeight: '600',
  color: '#9ca3af',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  margin: '4px 0 6px 0',
  lineHeight: '16px',
}

const priceDivider = {
  borderColor: '#e5e7eb',
  margin: '10px 0',
}

const priceDividerLight = {
  borderColor: '#f3f4f6',
  margin: '6px 0',
}

const grandTotalRow = {
  width: '100%',
  paddingTop: '8px',
}

const grandTotalLabel = {
  fontSize: '16px',
  fontWeight: '600',
  color: '#111827',
  lineHeight: '28px',
  verticalAlign: 'baseline' as const,
}

const grandTotalValue = {
  fontSize: '20px',
  fontWeight: '700',
  color: '#111827',
  lineHeight: '28px',
  textAlign: 'right' as const,
  verticalAlign: 'baseline' as const,
}
