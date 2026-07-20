import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

const LOCAL_TEST_CONFIRMATION = 'local-test-access'

export function confirmationPassword(required: boolean, password: string): string {
  return required ? password : LOCAL_TEST_CONFIRMATION
}

export function passwordConfirmationFailure(
  required: boolean,
  fallback: string,
  passwordFallback: string,
): string {
  return required ? passwordFallback : fallback
}

export function passwordConfirmationInstructions(
  required: boolean,
  action: 'delete' | 'export',
): string {
  if (!required) {
    return action === 'export'
      ? 'Local test access is active, so no administrator password is required.'
      : 'Type delete to confirm.'
  }
  return action === 'export'
    ? 'Enter the current administrator password. It is sent only for this confirmation and cleared after every response.'
    : 'Enter the current password and type delete to confirm.'
}

export function PasswordConfirmationField({
  id,
  onChange,
  required,
  value,
}: {
  readonly id: string
  readonly onChange: (value: string) => void
  readonly required: boolean
  readonly value: string
}) {
  if (!required) return null
  return (
    <Field>
      <FieldLabel htmlFor={id}>Current password</FieldLabel>
      <Input
        autoComplete="current-password"
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        type="password"
        value={value}
      />
    </Field>
  )
}
