import { AuthShell } from '@/components/auth-shell'
import ForgotPasswordForm from './ForgotPasswordForm'

export const metadata = { title: 'Forgot password | Alpha MD Provider' }

export default function ForgotPasswordPage() {
  // The description lives in the form, not here, because the form replaces it
  // with a confirmation once submitted.
  return (
    <AuthShell title="Reset password">
      <ForgotPasswordForm />
    </AuthShell>
  )
}
