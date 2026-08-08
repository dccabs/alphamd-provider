'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { login } from './actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
    >
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  )
}

export default function LoginForm({
  redirectTo,
  initialError,
}: {
  redirectTo: string
  initialError: string | null
}) {
  const [state, formAction] = useActionState(login, { error: initialError })
  const [showPassword, setShowPassword] = useState(false)

  return (
    <form action={formAction} className="mt-8 space-y-6">
      <input type="hidden" name="redirect" value={redirectTo} />
      {state.error && (
        <p role="alert" className="rounded-md bg-yellow-50 p-4 text-sm text-yellow-800">
          {state.error}
        </p>
      )}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <div className="relative mt-1">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            className="block w-full rounded-md border border-gray-300 px-3 py-2 pr-10 shadow-sm"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 px-3 text-sm text-gray-500"
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <Link href="/forgot-password" className="block text-sm font-medium text-cyan-700">
        Forgot your password?
      </Link>
      <SubmitButton />
    </form>
  )
}
