'use client'

import { useState, useEffect, useCallback } from 'react'

interface Operation {
  id: string
  type: 'create' | 'destroy'
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'scheduled'
  interviewId: string
  candidateName?: string
  challenge?: string
  createdAt?: string // When the operation was scheduled/created
  startedAt?: string // Legacy field for backward compatibility
  executionStartedAt?: string // When execution actually began
  completedAt?: string
  result?: {
    success: boolean
    accessUrl?: string
    error?: string
  }
}

export function useOperations(interviewId?: string) {
  const [operations, setOperations] = useState<Operation[]>([])
  const [loading, setLoading] = useState(false)

  const loadOperations = useCallback(async () => {
    try {
      const url = interviewId
        ? `/api/operations?interviewId=${interviewId}`
        : '/api/operations'
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setOperations(data.operations || [])
      }
    } catch (error) {
      console.error('Failed to load operations:', error)
    }
  }, [interviewId])

  const createInterview = useCallback(
    async (candidateName: string, challenge: string) => {
      try {
        setLoading(true)
        const response = await fetch('/api/interviews/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateName, challenge }),
        })

        if (response.ok) {
          const data = await response.json()
          await loadOperations() // Refresh operations list
          return data
        } else {
          throw new Error('Failed to create interview')
        }
      } catch (error) {
        console.error('Error creating interview:', error)
        throw error
      } finally {
        setLoading(false)
      }
    },
    [loadOperations]
  )

  const destroyInterview = useCallback(
    async (interviewId: string, candidateName?: string, challenge?: string) => {
      try {
        setLoading(true)
        const response = await fetch(`/api/interviews/${interviewId}/destroy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            candidateName,
            challenge,
          }),
        })

        if (response.ok) {
          const data = await response.json()
          await loadOperations() // Refresh operations list
          return data
        } else {
          throw new Error('Failed to destroy interview')
        }
      } catch (error) {
        console.error('Error destroying interview:', error)
        throw error
      } finally {
        setLoading(false)
      }
    },
    [loadOperations]
  )

  useEffect(() => {
    loadOperations()
  }, [loadOperations])

  // NOTE: No polling needed - SSE provides real-time updates via useSSE hook
  // The main page uses SSE events to trigger refreshes when operations complete

  return {
    operations,
    loading,
    createInterview,
    destroyInterview,
    refreshOperations: loadOperations,
  }
}
