import {
  type CurrentVerificationBindings,
  type RunnerBinding,
  type Sha256,
  type VerificationFinding,
  type VerificationPolicy,
  type VerificationReport,
  verificationReportSchema,
} from '@simproof/contracts'
import { hashCanonicalJson, hashNormalizedSource } from './hashing.js'
import { getDomainPack } from './supported-domain-packs.js'

export interface DomainVerificationResult {
  readonly verdict: 'verified' | 'rejected' | 'inapplicable'
  readonly findings: readonly VerificationFinding[]
  readonly sampleCount: number
}

export interface VerificationReportInput {
  readonly reportId: string
  readonly createdAt: string
  readonly conceptSpec: unknown
  readonly artifactSource: string
  readonly policy: VerificationPolicy
  readonly runner: RunnerBinding
  readonly observations: readonly unknown[]
}

const inputKey = (value: unknown): string => hashCanonicalJson(value)

const trustedPackFor = (policy: VerificationPolicy) => {
  const pack = getDomainPack(policy.domain)
  if (pack === undefined || hashCanonicalJson(policy) !== hashCanonicalJson(pack.policy)) {
    throw new TypeError('Verification reports require the application-owned trusted policy.')
  }
  return pack
}

function validateObservations(input: VerificationReportInput): readonly unknown[] {
  return trustedPackFor(input.policy).report.validateObservations(input.observations)
}

function trustedResultFor(
  policy: VerificationPolicy,
  observations: readonly unknown[],
): DomainVerificationResult {
  return trustedPackFor(policy).report.verifyObservations(observations)
}

function assertCoverage(
  policy: VerificationPolicy,
  observations: readonly unknown[],
  result: DomainVerificationResult,
): void {
  if (result.sampleCount !== observations.length) {
    throw new TypeError('Trusted verifier sample count must match the validated observations.')
  }
  if (result.verdict === 'inapplicable') return

  const report = trustedPackFor(policy).report
  const required = report.expectedInputs().map(inputKey)
  const actual = observations.map((observation) => inputKey(report.observationInput(observation)))
  if (
    actual.length !== required.length ||
    required.some((key) => actual.filter((actualKey) => actualKey === key).length !== 1)
  ) {
    throw new TypeError(
      'Verified observations must contain the exact trusted policy sampling grid.',
    )
  }
}

function validatedEvidence(input: VerificationReportInput) {
  const observations = validateObservations(input)
  const result = trustedResultFor(input.policy, observations)
  assertCoverage(input.policy, observations, result)
  return { observations, result } as const
}

const sampleCountForCheck = (
  policy: VerificationPolicy,
  checkId: string,
  result: DomainVerificationResult,
): number => {
  return trustedPackFor(policy).report.sampleCountForCheck(checkId, result)
}

const checkOutcome = (
  checkId: string,
  result: DomainVerificationResult,
): 'failed' | 'not-applicable' | 'passed' => {
  if (result.verdict === 'inapplicable') return 'not-applicable'
  return result.findings.some((finding) => finding.checkId === checkId) ? 'failed' : 'passed'
}

function reportBindings(input: VerificationReportInput, observationHash: Sha256) {
  const domainPack = getDomainPack(input.policy.domain)
  if (domainPack === undefined) {
    throw new TypeError(`No trusted domain pack exists for ${input.policy.domain}.`)
  }
  return {
    conceptSpecHash: hashCanonicalJson(input.conceptSpec),
    artifactHash: hashNormalizedSource(input.artifactSource),
    observationHash,
    policy: {
      id: input.policy.id,
      version: input.policy.version,
      contentHash: hashCanonicalJson(input.policy),
    },
    domainPack: {
      id: domainPack.id,
      version: domainPack.version,
      contentHash: domainPack.contentHash,
    },
    runner: input.runner,
  } as const
}

export function currentBindingsFor(input: VerificationReportInput): CurrentVerificationBindings {
  const { observations } = validatedEvidence(input)
  return reportBindings(input, hashCanonicalJson(observations))
}

export function createVerificationReport(input: VerificationReportInput): VerificationReport {
  const { observations, result } = validatedEvidence(input)
  const bindings = reportBindings(input, hashCanonicalJson(observations))
  return verificationReportSchema.parse({
    schemaVersion: '1',
    reportId: input.reportId,
    createdAt: input.createdAt,
    conceptSpecHash: bindings.conceptSpecHash,
    artifact: { hash: bindings.artifactHash },
    policy: bindings.policy,
    domainPack: bindings.domainPack,
    runner: bindings.runner,
    observationHash: bindings.observationHash,
    verdict: result.verdict,
    checks: input.policy.checks.map((id) => ({
      id,
      outcome: checkOutcome(id, result),
      sampleCount: sampleCountForCheck(input.policy, id, result),
    })),
    findings: [...result.findings],
    testedScope: {
      parameters: trustedPackFor(input.policy).report.testedParameters(observations),
      sampleCount: observations.length,
      samplingGridHash: hashCanonicalJson(input.policy.sampling),
    },
    assumptions: [...input.policy.assumptions],
    limitations: [...input.policy.limitations],
  })
}
