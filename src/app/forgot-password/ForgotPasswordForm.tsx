'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestPasswordReset, type ForgotState } from './actions'

const initialState: ForgotState = { error: null, submitted: false }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? 'Submitting…' : 'Submit'}
    </Button>
  )
}

export default function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, initialState)

  if (state.submitted) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Your password request has been sent. If there is an account associated
          with this email address you will be emailed instructions on how to
          reset your password.
        </p>
        <BackToSignIn />
      </div>
    )
  }

  return (
    <form action={formAction} className="grid gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <p className="text-sm text-muted-foreground">
        Enter your email address to reset your password.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@alphamd.org"
          required
        />
      </div>
      <SubmitButton />
      <BackToSignIn />
    </form>
  )
}

function BackToSignIn() {
  return (
    <Link
      href="/login"
      className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
    >
      Back to sign in
    </Link>
  )
}
