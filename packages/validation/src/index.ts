/**
 * @palantir/validation
 *
 * Zod-Schemas, die Backend (Request-Validierung) und Frontend (Formular-/
 * Typprüfung) gemeinsam nutzen – Pflichtenheft §3 und §4.
 *
 * Enthalten sind bisher die paket-übergreifende Basis (ID-Format, Schema zum
 * Response-Envelope) und die Frame-Schemas des Agent-Protokolls. Fachliche
 * Schemas werden zusammen mit den zugehörigen Typen aus `@palantir/contracts`
 * über eigene, kleine PRs ergänzt (CLAUDE.md §3 und §6).
 */

export { type Id, idSchema } from './common.js';
export { apiErrorBodySchema, apiResponseSchema, errorCodeSchema } from './envelope.js';
export {
  type CreateRoleInput,
  type UpdateRoleInput,
  createRoleInputSchema,
  permissionSchema,
  roleDescriptionSchema,
  roleNameSchema,
  rolePermissionsBundleSchema,
  updateRoleInputSchema,
} from './rbac.js';
export {
  agentCommandNameSchema,
  agentCommandResultFrameSchema,
  agentContainerStateSchema,
  agentContainerStatusSchema,
  agentEventFrameSchema,
  agentEventNameSchema,
  agentHelloFrameSchema,
  agentStateReportFrameSchema,
  agentToBackendFrameSchema,
  backendCommandFrameSchema,
  backendStateRequestFrameSchema,
  backendToAgentFrameSchema,
  backendWelcomeFrameSchema,
  correlationIdSchema,
  isoTimestampSchema,
} from './agent-protocol.js';
export {
  AGENT_COMMAND_PAYLOAD_SCHEMAS,
  agentPortMappingSchema,
  agentResourceLimitsSchema,
  agentServerIdSchema,
  agentVolumeMountSchema,
  containerIdSchema,
  containerPathSchema,
  createCommandPayloadSchema,
  deleteCommandPayloadSchema,
  execConsoleCommandPayloadSchema,
  fileListCommandPayloadSchema,
  fileReadCommandPayloadSchema,
  fileWriteCommandPayloadSchema,
  getLogsCommandPayloadSchema,
  getStatsCommandPayloadSchema,
  restartCommandPayloadSchema,
  startCommandPayloadSchema,
  stopCommandPayloadSchema,
} from './agent-commands.js';
export {
  type NodeResourcesInput,
  type UserResourceLimitsInput,
  cpuCoresSchema,
  megabytesSchema,
  nodeResourcesSchema,
  resourceWarningThresholdsSchema,
  serverCountSchema,
  thresholdPercentSchema,
  userResourceLimitsInputSchema,
} from './resources.js';
