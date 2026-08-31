import Link from 'next/link'
import { PortalChrome } from '@/components/portal-chrome'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Shown to an `@alphamd.org` user who can sign in but holds neither the
 * `provider` nor the `admin` role. It says so explicitly rather than rendering
 * an empty queue, which is what an RLS-based gate would have produced.
 */
export function AccessDenied() {
  return (
    <>
      <PortalChrome />
      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No lab review access</CardTitle>
            <CardDescription>
              Your account can sign in to the provider portal, but lab reviews are
              limited to accounts with the provider or admin role.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              If you should have access, ask an administrator to add the provider
              role to your account.{' '}
              <Link href="/" className="underline underline-offset-4">
                Back to the dashboard
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
