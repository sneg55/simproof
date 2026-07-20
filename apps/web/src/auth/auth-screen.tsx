import type { EducatorSession } from '@simproof/contracts'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { EducatorApi } from '@/api/educator-api'
import { DocumentTitle } from '@/app/document-title'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

interface AuthScreenProps {
  readonly api: EducatorApi
  readonly bootstrapAvailable: boolean
  readonly onAuthenticated: (session: EducatorSession) => void
  readonly onBootstrapCompleted: () => void
}

export function AuthScreen(props: AuthScreenProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])

  return (
    <>
      <DocumentTitle
        value={props.bootstrapAvailable ? 'Set up administrator | SimProof' : 'Sign in | SimProof'}
      />
      <main className="mx-auto grid min-h-svh max-w-shell place-items-center px-page py-section">
        <div className="grid w-full max-w-md gap-6">
          <div className="grid gap-2 text-center">
            <p className="font-medium text-primary">SimProof educator workspace</p>
            <h1
              className="text-3xl font-heading font-semibold tracking-tight"
              ref={heading}
              tabIndex={-1}
            >
              {props.bootstrapAvailable ? 'Secure this installation' : 'Welcome back'}
            </h1>
            <p className="text-muted-foreground">
              {props.bootstrapAvailable
                ? 'Create the local administrator before opening the simulation library.'
                : 'Sign in with the local administrator password.'}
            </p>
          </div>
          {props.bootstrapAvailable ? <BootstrapForm {...props} /> : <LoginForm {...props} />}
        </div>
      </main>
    </>
  )
}

function LoginForm({ api, onAuthenticated }: AuthScreenProps) {
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setFailed(false)
    const result = await api.login(password)
    setPassword('')
    setPending(false)
    if (result.ok) onAuthenticated(result.value)
    else setFailed(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Administrator sign in</CardTitle>
        <CardDescription>Your password stays on this server.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <Field>
            <FieldLabel htmlFor="administrator-password">Administrator password</FieldLabel>
            <Input
              autoComplete="current-password"
              id="administrator-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </Field>
          {failed ? (
            <AuthFailure message="Sign in was denied. Check the password and try again." />
          ) : null}
          <Button disabled={pending} type="submit">
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function BootstrapForm({ api, onBootstrapCompleted }: AuthScreenProps) {
  const [secret, setSecret] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setFailed(false)
    const result = await api.bootstrap(secret, password)
    setSecret('')
    setPassword('')
    setPending(false)
    if (result.ok) onBootstrapCompleted()
    else setFailed(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create local administrator</CardTitle>
        <CardDescription>
          No model-provider credential is needed to use bundled examples.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <Field>
            <FieldLabel htmlFor="bootstrap-secret">Bootstrap secret</FieldLabel>
            <Input
              autoComplete="off"
              id="bootstrap-secret"
              onChange={(event) => setSecret(event.target.value)}
              required
              type="password"
              value={secret}
            />
            <FieldDescription>
              Use the one-time secret supplied by the server administrator.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="new-administrator-password">New administrator password</FieldLabel>
            <Input
              autoComplete="new-password"
              id="new-administrator-password"
              minLength={12}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </Field>
          {failed ? (
            <AuthFailure message="The administrator could not be created. Verify the bootstrap secret." />
          ) : null}
          <Button disabled={pending} type="submit">
            {pending ? 'Creating administrator…' : 'Create administrator'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function AuthFailure({ message }: { readonly message: string }) {
  const summary = useRef<HTMLDivElement>(null)
  useEffect(() => summary.current?.focus(), [])
  return (
    <Alert ref={summary} tabIndex={-1} variant="destructive">
      <AlertTitle>Authentication unsuccessful</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
