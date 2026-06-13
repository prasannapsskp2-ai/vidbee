// Public exports for in-process consumers (tests, host adapters, the
// three-host equivalence test). The CLI binary lives in ./bin.ts.

export * from './parser'
export * from './envelope'
export * from './subcommands'
export * from './transport'
export { connect } from './transport/connect'
export type { ConnectOptions, ConnectResult } from './transport/connect'
export { AutomationClient, AutomationHttpError } from './transport/automation-client'
export type { AutomationClientOptions, HandshakeResponse } from './transport/automation-client'
export { readDescriptor, resolveDescriptorPath, isPidAlive } from './transport/descriptor'
export type { DescriptorPayload, ReadDescriptorResult } from './transport/descriptor'
export { ensureDesktopReady } from './transport/autostart'
export type { AutostartOptions, AutostartResult } from './transport/autostart'
export { createLocalClient } from './transport/local-client'
export type { LocalClientOptions, LocalClientHandle } from './transport/local-client'
export { redactArgs, redactText, REDACTED_PLACEHOLDER } from './parser/redact'
export { buildForwardedInput } from './download/build-input'
export { enqueueDownload } from './download/enqueue'
export type { EnqueueOptions, EnqueueResult } from './download/enqueue'
export { runProbe } from './download/probe'
export type { ProbeOptions, ProbeResult, ProbeSpawner, ProbeSpawnHandle } from './download/probe'
export { run } from './runtime'
export type { RunIO, RunResult } from './runtime'
export {
  readCliVersion,
  checkUpgrade,
  compareSemver,
  defaultCachePath
} from './local-info'
export type {
  CliVersionInfo,
  UpgradeCheckInput,
  UpgradeCheckResult
} from './local-info'
