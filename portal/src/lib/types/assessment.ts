
/**
 * Instance-level status (infrastructure provisioning state).
 * Shared by both Interview and TakeHome types.
 */
export type InstanceStatus =
  | 'pending' // Not started provisioning yet
  | 'initializing' // Terraform provisioning AWS resources
  | 'configuring' // Infrastructure ready, ECS container booting
  | 'active' // Fully ready for candidate access
  | 'destroying' // Infrastructure being torn down
  | 'destroyed' // Infrastructure completely removed
  | 'error' // Failed state requiring manual intervention

export const instanceStatusValues: InstanceStatus[] = [
  'pending',
  'initializing',
  'configuring',
  'active',
  'destroying',
  'destroyed',
  'error',
]

/**
 * Interview session-level status (interview lifecycle).
 */
export type InterviewSessionStatus =
  | 'scheduled' // Waiting for scheduled start time
  | 'active' // Interview is happening (instance provisioned/active)
  | 'completed' // Interview finished

export const interviewSessionStatusValues: InterviewSessionStatus[] = [
  'scheduled',
  'active',
  'completed',
]

/**
 * TakeHome session-level status (take-home lifecycle).
 */
export type TakeHomeSessionStatus =
  | 'available' // Waiting for candidate to activate
  | 'activated' // Candidate started (instance provisioning/active)
  | 'completed' // Take-home finished
  | 'expired' // Availability window passed without activation

export const takeHomeSessionStatusValues: TakeHomeSessionStatus[] = [
  'available',
  'activated',
  'completed',
  'expired',
]

/**
 * Shared instance fields (infrastructure metadata).
 * These fields are embedded in both Interview and TakeHome records.
 */
export interface InstanceFields {
  instanceStatus: InstanceStatus
  challengeId: string
  url?: string
  password?: string
  provisionedAt?: number
  destroyedAt?: number
  autoDestroyAt?: number
  resourceConfig: {
    cpu: number
    memory: number
    storage: number
  }
  openaiServiceAccount?: {
    apiKey: string
    projectId: string
  }
  saveFiles?: boolean
  historyKey?: string
}

/**
 * Interview record stored in DynamoDB (assessments table).
 * Represents immediate or scheduled interview sessions.
 */
export interface Interview extends InstanceFields {
  PK: `INTERVIEW#${string}`
  SK: 'METADATA'
  sessionType: 'interview'
  id: string
  type: 'immediate' | 'scheduled'
  sessionStatus: InterviewSessionStatus
  scheduledAt?: number
  createdAt: number
  createdBy: string
}

/**
 * TakeHome record stored in DynamoDB (assessments table).
 * Represents take-home assessments that candidates activate.
 */
export interface TakeHome extends InstanceFields {
  PK: `TAKEHOME#${string}`
  SK: 'METADATA'
  sessionType: 'takehome'
  id: string
  accessToken: string
  availableFrom: number
  availableUntil: number
  activatedAt?: number
  isActivated: boolean
  sessionStatus: TakeHomeSessionStatus
  createdAt: number
  createdBy: string
  candidateEmail?: string
  candidateName?: string
}

/**
 * Union type for all assessment types.
 */
export type Assessment = Interview | TakeHome

/**
 * Type guard to check if assessment is Interview.
 */
export function isInterview(assessment: Assessment): assessment is Interview {
  return assessment.sessionType === 'interview'
}

/**
 * Type guard to check if assessment is TakeHome.
 */
export function isTakeHome(assessment: Assessment): assessment is TakeHome {
  return assessment.sessionType === 'takehome'
}
