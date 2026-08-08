import ForgotPasswordForm from './ForgotPasswordForm'

export const metadata = { title: 'Forgot password | Alpha MD Provider' }

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto mt-36 max-w-xl px-4">
      <div className="rounded-lg bg-white p-6 shadow">
        <h1 className="text-lg font-medium text-gray-900">Reset password</h1>
        <p className="mt-2 text-sm text-gray-500">
          Enter your email address to reset your password.
        </p>
        <ForgotPasswordForm />
      </div>
    </main>
  )
}
