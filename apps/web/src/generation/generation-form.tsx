import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const TITLE_MAX_LENGTH = 120

export interface GenerationFormValue {
  readonly title?: string
  readonly prompt: string
  readonly promptRetention: 'discard' | 'persist'
}

const guidedExamples = [
  {
    label: 'Explore pendulum length',
    prompt:
      'Create a pendulum explorer where students can vary length and starting amplitude, compare the motion, and discuss how length changes the period.',
  },
  {
    label: 'Compare projectile launches',
    prompt:
      'Create a projectile explorer where students can vary launch speed and angle, compare trajectories, and identify which inputs change range and airtime.',
  },
  {
    label: 'Test a prediction',
    prompt:
      'Create a focused simulation that asks learners to predict the outcome, change one allowed parameter, and compare the prediction with a numerical result.',
  },
] as const

export function GenerationForm({
  collectTitle = false,
  failure,
  onStart,
  submitting,
}: {
  readonly collectTitle?: boolean
  readonly failure: string | null
  readonly onStart: (value: GenerationFormValue) => void
  readonly submitting: boolean
}) {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const {
    normalizedTitle,
    normalizedPrompt,
    titleInvalid,
    promptInvalid,
    startDisabled,
    showPromptCount,
    startBlockedReason,
  } = deriveStartState(collectTitle, title, prompt, submitting)

  const submit = () => {
    if (startDisabled) return
    onStart(
      collectTitle
        ? { title: normalizedTitle, prompt: normalizedPrompt, promptRetention: 'discard' }
        : { prompt: normalizedPrompt, promptRetention: 'discard' },
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.55fr)]">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>
              {collectTitle
                ? 'Name and describe your simulation'
                : 'Describe the learning experience'}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {collectTitle ? (
              <Field data-invalid={titleInvalid}>
                <FieldLabel htmlFor="new-simulation-title">Simulation title</FieldLabel>
                <Input
                  aria-invalid={titleInvalid}
                  autoComplete="off"
                  disabled={submitting}
                  id="new-simulation-title"
                  maxLength={TITLE_MAX_LENGTH + 1}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  value={title}
                />
                <FieldDescription>
                  Use a title educators will recognize in the library.
                </FieldDescription>
                {titleInvalid ? (
                  <FieldError>Keep the title at or below {TITLE_MAX_LENGTH} characters.</FieldError>
                ) : null}
              </Field>
            ) : null}
            <Field data-invalid={promptInvalid}>
              <FieldLabel htmlFor="generation-prompt">Describe the learning experience</FieldLabel>
              <Textarea
                aria-describedby={`generation-prompt-description${
                  showPromptCount ? ' generation-prompt-count' : ''
                }`}
                aria-invalid={promptInvalid}
                disabled={submitting}
                id="generation-prompt"
                maxLength={16_385}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                placeholder="What should students be able to explore, compare, or explain?"
                rows={9}
                value={prompt}
              />
              <FieldDescription id="generation-prompt-description">
                Describe the learning goal and controls. The provider may refine wording, but
                trusted verification defines the science.
              </FieldDescription>
              {showPromptCount ? (
                <p
                  className="text-right text-xs text-muted-foreground"
                  data-dynamic-number
                  id="generation-prompt-count"
                >
                  {prompt.length.toLocaleString()} / 16,384 characters
                </p>
              ) : null}
              {promptInvalid ? (
                <FieldError>Keep the prompt at or below 16,384 characters.</FieldError>
              ) : null}
            </Field>
            {failure === null ? null : (
              <Alert variant="destructive">
                <AlertTitle>Generation could not be started</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    aria-describedby={
                      startBlockedReason === null ? undefined : 'generation-start-hint'
                    }
                    disabled={startDisabled}
                    size="lg"
                  >
                    {submitting ? 'Starting generation…' : 'Review disclosure and start'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Send this prompt to an external AI provider?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      SimProof will send your prompt to an external AI provider to draft the
                      simulation. That provider runs separately from this server. Any code it
                      produces runs only inside a sealed sandbox, never on your computer or in your
                      browser. Your prompt is used only to draft this simulation and is not stored.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Go back</AlertDialogCancel>
                    <AlertDialogAction onClick={submit}>I understand and start</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {startBlockedReason === null ? null : (
                <p className="text-sm text-muted-foreground" id="generation-start-hint">
                  {startBlockedReason}
                </p>
              )}
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
      <aside aria-labelledby="guided-prompts-heading">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 id="guided-prompts-heading">Start from an example</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Choose an example, then edit it to match your lesson.
            </p>
            {guidedExamples.map((example) => (
              <Button
                className="h-auto justify-start whitespace-normal py-3 text-left"
                disabled={submitting}
                key={example.label}
                onClick={() => setPrompt(example.prompt)}
                variant="outline"
              >
                Use example: {example.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}

function deriveStartState(
  collectTitle: boolean,
  title: string,
  prompt: string,
  submitting: boolean,
) {
  const normalizedTitle = title.trim()
  const normalizedPrompt = prompt.trim()
  const titleInvalid = collectTitle && normalizedTitle.length > TITLE_MAX_LENGTH
  const titleMissing = collectTitle && normalizedTitle === ''
  const promptInvalid = prompt.length > 16_384
  const promptMissing = normalizedPrompt === ''
  return {
    normalizedTitle,
    normalizedPrompt,
    titleInvalid,
    promptInvalid,
    startDisabled: titleMissing || titleInvalid || promptMissing || promptInvalid || submitting,
    showPromptCount: prompt.length > 12_000 || promptInvalid,
    startBlockedReason: startBlockedHint(submitting, titleMissing, promptMissing),
  }
}

function startBlockedHint(
  submitting: boolean,
  titleMissing: boolean,
  promptMissing: boolean,
): string | null {
  if (submitting) return null
  if (titleMissing && promptMissing) return 'Add a title and a description to continue.'
  if (titleMissing) return 'Add a title to continue.'
  if (promptMissing) return 'Add a description to continue.'
  return null
}
