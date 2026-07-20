import { type LibraryQuery, simulationLifecycleStateSchema } from '@simproof/contracts'

import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type DomainFilter = 'all' | 'pendulum' | 'projectile'
type StateFilter =
  | 'all'
  | 'archived'
  | 'draft'
  | 'generating'
  | 'published'
  | 'rejected'
  | 'stale'
  | 'verifying'
  | 'verified'

export function LibraryFilters({
  query,
  onChange,
}: {
  readonly query: LibraryQuery
  readonly onChange: (query: LibraryQuery) => void
}) {
  const domain = query.domains[0] ?? 'all'
  const state = query.states[0] ?? 'all'
  return (
    <div className="grid gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-[minmax(12rem,1fr)_auto_auto]">
      <Field>
        <FieldLabel htmlFor="simulation-search">Search simulations</FieldLabel>
        <Input
          id="simulation-search"
          onChange={(event) => onChange({ ...query, search: event.target.value })}
          placeholder="Title or topic"
          role="searchbox"
          type="search"
          value={query.search}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="domain-filter">Domain</FieldLabel>
        <Select
          onValueChange={(value) => onChange({ ...query, domains: domainValue(value) })}
          value={domain}
        >
          <SelectTrigger aria-label="Domain" className="w-full sm:min-w-40" id="domain-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All domains</SelectItem>
            <SelectItem value="pendulum">Pendulum</SelectItem>
            <SelectItem value="projectile">Projectile</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="state-filter">Lifecycle state</FieldLabel>
        <Select
          onValueChange={(value) => onChange({ ...query, states: stateValue(value) })}
          value={state}
        >
          <SelectTrigger
            aria-label="Lifecycle state"
            className="w-full sm:min-w-40"
            id="state-filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="generating">Generating</SelectItem>
            <SelectItem value="verifying">Verifying</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="stale">Stale</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  )
}

function domainValue(value: string): LibraryQuery['domains'] {
  return value === 'pendulum' || value === 'projectile' ? [value] : []
}

function stateValue(value: string): LibraryQuery['states'] {
  const state = simulationLifecycleStateSchema.safeParse(value)
  return state.success ? [state.data] : []
}

export type { DomainFilter, StateFilter }
