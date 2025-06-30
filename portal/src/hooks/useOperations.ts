'use client'

import { useState, useEffect, useCallback } from 'react'

interface Operation {
  id: string
  type: 'create' | 'destroy'
  status: 'pending' | 'running' | 'completed' | 'failed'
  interviewId: string
  candidateName?: string
  scenario?: string
  startedAt: string
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
    async (candidateName: string, scenario: string) => {
      try {
        setLoading(true)
        const response = await fetch('/api/interviews/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidateName, scenario }),
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
    async (interviewId: string) => {
      try {
        setLoading(true)
        const response = await fetch(`/api/interviews/${interviewId}/destroy`, {
          method: 'POST',
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

  // Only poll when there are running or pending operations
  useEffect(() => {
    const hasActiveOperations = operations.some(
      op => op.status === 'running' || op.status === 'pending'
    )

    if (hasActiveOperations) {
      console.log(
        '[DEBUG] useOperations: Active operations detected, starting polling...'
      )
      const interval = setInterval(loadOperations, 3000)
      return () => {
        console.log('[DEBUG] useOperations: Stopping polling')
        clearInterval(interval)
      }
    }
  }, [operations, loadOperations])

  return {
    operations,
    loading,
    createInterview,
    destroyInterview,
    refreshOperations: loadOperations,
  }
}
