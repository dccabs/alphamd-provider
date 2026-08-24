/**
 * Ported from alphamd `components/EmailTemplates/ConsultationLinkEmail.tsx`.
 *
 * The HTML the patient sees when a consultation booking link is emailed. Kept
 * as a copy rather than an HTTP call into that app; markup changes here should
 * be mirrored there, or this file replaced by a shared package.
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
} from '@react-email/components'
import * as React from 'react'

interface ConsultationLinkEmailProps {
  firstName: string
  singleUseCalendlyLink: string
  eventTypeName?: string
}

const baseUrl = process.env.NEXT_PUBLIC_DEFAULT_URL || 'https://www.alphamd.org'

export const ConsultationLinkEmail: React.FC<
  Readonly<ConsultationLinkEmailProps>
> = ({ firstName, singleUseCalendlyLink, eventTypeName }) => (
  <Html>
    <Head />
    <Preview>
      Schedule your AlphaMD Consultation - Secure booking link included
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Img
            src={`${baseUrl}/images/logo.png`}
            width="120"
            alt="AlphaMD"
            style={logo}
          />
        </Section>

        <Hr style={divider} />

        <Section style={contentSection}>
          <Section style={textSection}>
            <Text style={tagline}>Consultation Scheduling</Text>
            <Heading style={title}>Schedule Your AlphaMD Consultation</Heading>
            <Text style={bodyText}>Dear {firstName || 'Valued Patient'},</Text>
            <Text style={bodyText}>
              We're ready to help you on your health journey! Please click the
              secure booking link below to schedule your consultation with one
              of our experienced AlphaMD providers.
            </Text>
            {eventTypeName && (
              <Text style={bodyText}>
                <strong>Consultation Type:</strong> {eventTypeName}
              </Text>
            )}
            <Text style={bodyText}>
              This personalized booking link has been created specifically for
              you and provides access to our available appointment slots. For
              your security and to ensure dedicated time slots, this is a
              single-use link that will expire once you've booked your
              appointment.
            </Text>
            <Button style={button} href={singleUseCalendlyLink}>
              Schedule My Consultation
            </Button>
            <Text style={bodyText}>
              During your consultation, our providers will discuss your health
              goals, review any relevant medical history, and create a
              personalized treatment plan tailored to your needs. We look
              forward to supporting you on your wellness journey.
            </Text>
            <Text style={bodyText}>
              <strong>Important:</strong> This secure link can only be used once
              and is valid for scheduling your consultation. If you experience
              any technical difficulties or have questions, please contact our
              support team at{' '}
              <Link href="mailto:contact@alphamd.org" style={link}>
                contact@alphamd.org
              </Link>
            </Text>
          </Section>
        </Section>

        <Hr style={divider} />

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

export default ConsultationLinkEmail

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

const textSection = {
  marginTop: '32px',
  textAlign: 'center' as const,
}

const tagline = {
  margin: '16px 0',
  fontWeight: '600',
  fontSize: '18px',
  color: '#0891b2',
  lineHeight: '28px',
}

const title = {
  margin: '0',
  marginTop: '8px',
  fontWeight: '600',
  fontSize: '36px',
  color: '#111827',
  lineHeight: '36px',
}

const bodyText = {
  fontSize: '16px',
  color: '#6b7280',
  lineHeight: '24px',
  textAlign: 'left' as const,
  margin: '16px 0',
}

const button = {
  marginTop: '16px',
  borderRadius: '8px',
  backgroundColor: '#0891b2',
  paddingLeft: '40px',
  paddingRight: '40px',
  paddingTop: '12px',
  paddingBottom: '12px',
  fontWeight: '600',
  color: '#ffffff',
  fontSize: '16px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
}

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
