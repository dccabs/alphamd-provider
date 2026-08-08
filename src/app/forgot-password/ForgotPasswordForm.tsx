'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { requestPasswordReset, type ForgotState } from './actions'

const initialState: ForgotState = { error: null, submitted: false }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-cyan-500 px-4 py-2 font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
    >
      {pending ? 'Submitting…' : 'Submit'}
    </button>
  )
}

export default function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, initialState)

  if (state.submitted) {
    return (
      <p className="text-center">
        Your password request has been sent. If there is an account associated
        with this email address you will be emailed instructions on how to reset
        your password.
      </p>
    )
  }

  return (
    <form action={formAction} className="mt-5 space-y-4">
      {state.error && (
        <p role="alert" className="text-sm text-red-500">
          {state.error}
        </p>
      )}
      <label htmlFor="email" className="block text-sm font-medium text-gray-700">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        placeholder="you@example.com"
        className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm"
      />
      <SubmitButton />
    </form>
  )
}
