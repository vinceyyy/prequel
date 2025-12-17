import { useEffect, useRef, useState, useCallback } from 'react'

export interface OperationResult {
  success: boolean
  accessUrl?: string
  password?: string
  healthCheckPassed?: boolean
  infrastructureReady?: boolean
  error?: string
  fullOutput?: string
}

export interface OperationData {
  id: string
  type: 'create' | 'destroy'
  status:
    | 'scheduled'
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
  interviewId: string
  candidateName?: string
  challenge?: string
  scheduledAt?: string
  autoDestroyAt?: string
  createdAt?: string
  executionStartedAt?: string
  completedAt?: string
  result?: OperationResult
}

interface UsePollingOptions {
  /** Filter operations by interview ID prefix (e.g., 'INTERVIEW#' or 'TAKEHOME#') */
  filterPrefix?: string
  /** Active polling interval in ms (default: 5000) */
  activeInterval?: number
  /** Idle polling interval in ms (default: 30000) */
  idleInterval?: number
  /** Callback when operations change */
  onOperationsChange?: (operations: OperationData[]) => void
}

interface UsePollingResult {
  /** All operations (filtered if filterPrefix is set) */
  operations: OperationData[]
  /** Whether there are active operations */
  hasActiveOperations: boolean
  /** Last time data was fetched */
  lastUpdated: Date | null
  /** Whether currently fetching */
  isLoading: boolean
  /** Any error that occurred */
  error: string | null
  /** Manually trigger a refresh */
  refresh: () => Promise<void>
}

/**
 * Smart polling hook for operations.
 * Polls at activeInterval when operations are in progress,
 * switches to idleInterval when all operations are complete.
 */
export function usePolling(options: UsePollingOptions = {}): UsePollingResult {
  const {
    filterPrefix,
    activeInterval = 5000,
    idleInterval = 30000,
    onOperationsChange,
  } = options

  const [operations, setOperations] = useState<OperationData[]>([])
  const [hasActiveOperations, setHasActiveOperations] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const previousOperationsRef = useRef<string>('')

  const fetchOperations = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const timestamp = Date.now()
      const response = await fetch(
        `/api/operations?activeOnly=true&t=${timestamp}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch operations: ${response.status}`)
      }

      const data = await response.json()
      let ops: OperationData[] = data.operations || []

      // Filter by prefix if specified
      if (filterPrefix) {
        ops = ops.filter(op => op.interviewId?.startsWith(filterPrefix))
      }

      // Check if any operations are active
      const activeOps = ops.some(
        op =>
          op.status === 'pending' ||
          op.status === 'running' ||
          op.status === 'scheduled'
      )

      setOperations(ops)
      setHasActiveOperations(activeOps)
      setLastUpdated(new Date())

      // Notify callback if operations changed
      const currentOpsJson = JSON.stringify(ops)
      if (currentOpsJson !== previousOperationsRef.current) {
        previousOperationsRef.current = currentOpsJson
        onOperationsChange?.(ops)
      }

      return activeOps
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      console.error('Polling error:', errorMessage)
      return hasActiveOperations // Keep current state on error
    } finally {
      setIsLoading(false)
    }
  }, [filterPrefix, onOperationsChange, hasActiveOperations])

  const refresh = useCallback(async () => {
    await fetchOperations()
  }, [fetchOperations])

  // Set up polling with smart intervals
  useEffect(() => {
    // Initial fetch
    fetchOperations()

    const setupPolling = (isActive: boolean) => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }

      const interval = isActive ? activeInterval : idleInterval
      console.log(
        `[Polling] Setting interval to ${interval}ms (${isActive ? 'active' : 'idle'} mode)`
      )

      intervalRef.current = setInterval(async () => {
        const stillActive = await fetchOperations()

        // Adjust interval if activity state changed
        if (stillActive !== isActive) {
          setupPolling(stillActive)
        }
      }, interval)
    }

    // Start with active polling to catch any in-progress operations
    setupPolling(true)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [fetchOperations, activeInterval, idleInterval])

  return {
    operations,
    hasActiveOperations,
    lastUpdated,
    isLoading,
    error,
    refresh,
  }
}

/**
 * Hook that provides operation updates in a format compatible with the old SSE interface.
 * This makes migration easier by providing similar callback patterns.
 */
export function useOperationPolling(options: UsePollingOptions = {}) {
  const [lastOperation, setLastOperation] = useState<OperationData | null>(null)
  const previousOpsRef = useRef<Map<string, OperationData>>(new Map())

  const handleOperationsChange = useCallback((ops: OperationData[]) => {
    // Find operations that changed
    for (const op of ops) {
      const prevOp = previousOpsRef.current.get(op.id)

      // If operation is new or status changed, emit it
      if (!prevOp || prevOp.status !== op.status) {
        setLastOperation(op)
      }

      previousOpsRef.current.set(op.id, op)
    }
  }, [])

  const polling = usePolling({
    ...options,
    onOperationsChange: handleOperationsChange,
  })

  return {
    ...polling,
    /** The most recently changed operation (similar to SSE lastEvent.operation) */
    lastOperation,
  }
}
