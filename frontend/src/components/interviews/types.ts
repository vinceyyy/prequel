import { type InterviewData } from '@/hooks/usePolling'

export type Interview = InterviewData

export interface Challenge {
  id: string
  name: string
  description: string
  ecsConfig: {
    cpu: number
    cpuCores: number
    memory: number
    storage: number
  }
  usageCount: number
  createdAt: string
  lastUsedAt?: string
}

export interface CreateInterviewFormData {
  candidateName: string
  challenge: string
  scheduledAt: string
  autoDestroyMinutes: number
  enableScheduling: boolean
  saveFiles: boolean
}
