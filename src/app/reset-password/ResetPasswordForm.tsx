'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { updatePassword, type ResetState } from './actions'

const initialState: ResetState = { error: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
    >
      {pending ? 'Submitting…' : 'Submit'}
    </button>
  )
}

export default function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePassword, initialState)

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <p role="alert" className="text-sm font-medium text-red-500">
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm"
        />
      </div>
      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm"
        />
      </div>
      <p className="text-sm text-gray-500">
        * Ensure that your password has at least 8 characters.
      </p>
      <SubmitButton />
    </form>
  )
}
