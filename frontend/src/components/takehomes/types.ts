import { type TakeHomeData } from '@/hooks/usePolling'

// Use the shared TakeHomeData type from usePolling
export type TakeHome = TakeHomeData

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

export interface TakeHomeFormData {
  candidateName: string
  candidateEmail: string
  challenge: string
  availableDays: number
  durationHours: number
  additionalInstructions: string
}
