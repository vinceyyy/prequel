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
  /** Polling interval in ms (default: 1000) */
  interval?: number
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
 * Simple polling hook for operations.
 * Polls at a fixed interval (default 1 second).
 */
export function usePolling(options: UsePollingOptions = {}): UsePollingResult {
  const { filterPrefix, interval = 1000, onOperationsChange } = options

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

  // Set up polling with fixed interval
  useEffect(() => {
    // Initial fetch
    fetchOperations()

    intervalRef.current = setInterval(() => {
      fetchOperations()
    }, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [fetchOperations, interval])

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

// Interview data structure (matching API response)
export interface InterviewData {
  id: string
  candidateName: string
  challenge: string
  status:
    | 'scheduled'
    | 'initializing'
    | 'configuring'
    | 'active'
    | 'destroying'
    | 'destroyed'
    | 'error'
  saveFiles?: boolean
  accessUrl?: string
  password?: string
  createdAt: string
  scheduledAt?: string
  autoDestroyAt?: string
  completedAt?: string
  destroyedAt?: string
  historyS3Key?: string
  operationId?: string
}

interface UseInterviewPollingOptions {
  /** Polling interval in ms (default: 1000) */
  interval?: number
  /** Callback when interviews change */
  onInterviewsChange?: (interviews: InterviewData[]) => void
}

interface UseInterviewPollingResult {
  /** All active interviews */
  interviews: InterviewData[]
  /** Whether there are interviews in progress (initializing/configuring/destroying) */
  hasInProgressInterviews: boolean
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
 * Simple polling hook for interviews.
 * Polls /api/interviews directly for real-time updates.
 * The server handles merging operation status into interview status.
 */
export function useInterviewPolling(
  options: UseInterviewPollingOptions = {}
): UseInterviewPollingResult {
  const { interval = 1000, onInterviewsChange } = options

  const [interviews, setInterviews] = useState<InterviewData[]>([])
  const [hasInProgressInterviews, setHasInProgressInterviews] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(true) // Start true for initial load
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const previousItemsRef = useRef<string>('')
  const hasLoadedRef = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      // Only show loading on initial fetch, not subsequent polls
      if (!hasLoadedRef.current) {
        setIsLoading(true)
      }
      setError(null)

      const timestamp = Date.now()
      const response = await fetch(`/api/interviews?t=${timestamp}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch interviews: ${response.status}`)
      }

      const data = await response.json()
      const items: InterviewData[] = data.interviews || []

      // Check if any items are in progress
      const inProgress = items.some(
        item =>
          item.status === 'initializing' ||
          item.status === 'configuring' ||
          item.status === 'destroying'
      )

      setInterviews(items)
      setHasInProgressInterviews(inProgress)
      setLastUpdated(new Date())

      // Notify callback if items changed
      const currentJson = JSON.stringify(items)
      if (currentJson !== previousItemsRef.current) {
        previousItemsRef.current = currentJson
        onInterviewsChange?.(items)
      }

      // Mark as loaded after first successful fetch
      hasLoadedRef.current = true
      setIsLoading(false)

      return inProgress
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      console.error('Interview polling error:', errorMessage)
      // Only clear loading on error if this was initial load
      if (!hasLoadedRef.current) {
        setIsLoading(false)
      }
      return hasInProgressInterviews
    }
  }, [onInterviewsChange, hasInProgressInterviews])

  const refresh = useCallback(async () => {
    await fetchData()
  }, [fetchData])

  // Set up polling with fixed interval
  useEffect(() => {
    // Initial fetch
    fetchData()

    intervalRef.current = setInterval(() => {
      fetchData()
    }, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [fetchData, interval])

  return {
    interviews,
    hasInProgressInterviews,
    lastUpdated,
    isLoading,
    error,
    refresh,
  }
}

// TakeHome data structure (matching API response)
export interface TakeHomeData {
  id: string
  candidateName?: string
  candidateEmail?: string
  challengeId: string
  sessionStatus: 'available' | 'activated' | 'completed' | 'expired' | 'revoked'
  instanceStatus:
    | 'pending'
    | 'initializing'
    | 'configuring'
    | 'active'
    | 'destroying'
    | 'destroyed'
    | 'error'
  createdAt: string
  availableFrom: string
  availableUntil: string
  activatedAt?: string
  accessToken: string
  url?: string
  password?: string
  autoDestroyAt?: string
  destroyedAt?: string
  saveFiles?: boolean
}

interface UseTakeHomePollingOptions {
  /** Polling interval in ms (default: 1000) */
  interval?: number
  /** Callback when take-homes change */
  onTakeHomesChange?: (takeHomes: TakeHomeData[]) => void
}

interface UseTakeHomePollingResult {
  /** All take-homes */
  takeHomes: TakeHomeData[]
  /** Whether there are take-homes in progress (initializing/configuring/destroying) */
  hasInProgressTakeHomes: boolean
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
 * Simple polling hook for take-homes.
 * Polls /api/takehomes directly for real-time updates.
 */
export function useTakeHomePolling(
  options: UseTakeHomePollingOptions = {}
): UseTakeHomePollingResult {
  const { interval = 1000, onTakeHomesChange } = options

  const [takeHomes, setTakeHomes] = useState<TakeHomeData[]>([])
  const [hasInProgressTakeHomes, setHasInProgressTakeHomes] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(true) // Start true for initial load
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const previousItemsRef = useRef<string>('')
  const hasLoadedRef = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      // Only show loading on initial fetch, not subsequent polls
      if (!hasLoadedRef.current) {
        setIsLoading(true)
      }
      setError(null)

      const timestamp = Date.now()
      const response = await fetch(`/api/takehomes?t=${timestamp}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch take-homes: ${response.status}`)
      }

      const data = await response.json()
      const items: TakeHomeData[] = data.takeHomes || []

      // Check if any items are in progress
      const inProgress = items.some(
        item =>
          item.instanceStatus === 'initializing' ||
          item.instanceStatus === 'configuring' ||
          item.instanceStatus === 'destroying'
      )

      setTakeHomes(items)
      setHasInProgressTakeHomes(inProgress)
      setLastUpdated(new Date())

      // Notify callback if items changed
      const currentJson = JSON.stringify(items)
      if (currentJson !== previousItemsRef.current) {
        previousItemsRef.current = currentJson
        onTakeHomesChange?.(items)
      }

      // Mark as loaded after first successful fetch
      hasLoadedRef.current = true
      setIsLoading(false)

      return inProgress
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      console.error('Take-home polling error:', errorMessage)
      // Only clear loading on error if this was initial load
      if (!hasLoadedRef.current) {
        setIsLoading(false)
      }
      return hasInProgressTakeHomes
    }
  }, [onTakeHomesChange, hasInProgressTakeHomes])

  const refresh = useCallback(async () => {
    await fetchData()
  }, [fetchData])

  // Set up polling with fixed interval
  useEffect(() => {
    // Initial fetch
    fetchData()

    intervalRef.current = setInterval(() => {
      fetchData()
    }, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [fetchData, interval])

  return {
    takeHomes,
    hasInProgressTakeHomes,
    lastUpdated,
    isLoading,
    error,
    refresh,
  }
}

// API Key data structure (matching API response)
export interface ApiKeyData {
  id: string
  name: string
  description?: string
  status:
    | 'scheduled'
    | 'available'
    | 'initializing'
    | 'active'
    | 'expired'
    | 'revoked'
    | 'error'
    | 'orphan'
  provider: 'openai'
  source: 'standalone' | 'interview' | 'takehome' | 'unknown'
  sourceId?: string
  apiKey?: string
  accessToken?: string
  createdAt: number
  scheduledAt?: number
  activatedAt?: number
  expiresAt?: number
  expiredAt?: number
}

interface UseApiKeyPollingOptions {
  /** Polling interval in ms (default: 1000) */
  interval?: number
  /** Callback when API keys change */
  onApiKeysChange?: (apiKeys: ApiKeyData[]) => void
}

interface UseApiKeyPollingResult {
  /** All API keys */
  apiKeys: ApiKeyData[]
  /** Count of currently active keys */
  activeCount: number
  /** Whether orphan check failed */
  orphanCheckFailed: boolean
  /** Whether there are keys in progress (scheduled/available/initializing) */
  hasInProgressKeys: boolean
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
 * Simple polling hook for API keys.
 * Polls /api/apikeys directly for real-time updates.
 */
export function useApiKeyPolling(
  options: UseApiKeyPollingOptions = {}
): UseApiKeyPollingResult {
  const { interval = 1000, onApiKeysChange } = options

  const [keys, setKeys] = useState<ApiKeyData[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [orphanCheckFailed, setOrphanCheckFailed] = useState(false)
  const [hasInProgressKeys, setHasInProgressKeys] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(true) // Start true for initial load
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const previousItemsRef = useRef<string>('')
  const hasLoadedRef = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      // Only show loading on initial fetch, not subsequent polls
      if (!hasLoadedRef.current) {
        setIsLoading(true)
      }
      setError(null)

      const timestamp = Date.now()
      const response = await fetch(`/api/apikeys?t=${timestamp}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch API keys: ${response.status}`)
      }

      const data = await response.json()
      const items: ApiKeyData[] = data.keys || []

      // Check if any keys are in progress (scheduled, available, or initializing)
      const inProgress = items.some(
        item =>
          item.status === 'scheduled' ||
          item.status === 'available' ||
          item.status === 'initializing'
      )

      setKeys(items)
      setActiveCount(data.activeCount || 0)
      setOrphanCheckFailed(data.orphanCheckFailed || false)
      setHasInProgressKeys(inProgress)
      setLastUpdated(new Date())

      // Notify callback if items changed
      const currentJson = JSON.stringify(items)
      if (currentJson !== previousItemsRef.current) {
        previousItemsRef.current = currentJson
        onApiKeysChange?.(items)
      }

      // Mark as loaded after first successful fetch
      hasLoadedRef.current = true
      setIsLoading(false)

      return inProgress
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      console.error('API key polling error:', errorMessage)
      // Only clear loading on error if this was initial load
      if (!hasLoadedRef.current) {
        setIsLoading(false)
      }
      return hasInProgressKeys
    }
  }, [onApiKeysChange, hasInProgressKeys])

  const refresh = useCallback(async () => {
    await fetchData()
  }, [fetchData])

  // Set up polling with fixed interval
  useEffect(() => {
    // Initial fetch
    fetchData()

    intervalRef.current = setInterval(() => {
      fetchData()
    }, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [fetchData, interval])

  return {
    apiKeys: keys,
    activeCount,
    orphanCheckFailed,
    hasInProgressKeys,
    lastUpdated,
    isLoading,
    error,
    refresh,
  }
}

interface UseApiKeyStatusPollingOptions {
  /** API key access token */
  token: string
  /** Polling interval in ms (default: 1000) */
  interval?: number
  /** Callback when API key changes */
  onApiKeyChange?: (apiKey: ApiKeyData | null) => void
}

interface UseApiKeyStatusPollingResult {
  /** API key data */
  apiKey: ApiKeyData | null
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
 * Simple polling hook for a single API key status.
 * Polls /api/apikey/[token] for real-time updates on the candidate page.
 */
export function useApiKeyStatusPolling(
  options: UseApiKeyStatusPollingOptions
): UseApiKeyStatusPollingResult {
  const { token, interval = 1000, onApiKeyChange } = options

  const [apiKey, setApiKey] = useState<ApiKeyData | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(true) // Start true for initial load
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const previousItemRef = useRef<string>('')
  const hasLoadedRef = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      // Only show loading on initial fetch, not subsequent polls
      if (!hasLoadedRef.current) {
        setIsLoading(true)
      }
      setError(null)

      const timestamp = Date.now()
      const response = await fetch(`/api/apikey/${token}?t=${timestamp}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch API key: ${response.status}`)
      }

      const data = await response.json()
      const item: ApiKeyData | null = data.key || null

      setApiKey(item)
      setLastUpdated(new Date())

      // Notify callback if item changed
      const currentJson = JSON.stringify(item)
      if (currentJson !== previousItemRef.current) {
        previousItemRef.current = currentJson
        onApiKeyChange?.(item)
      }

      // Mark as loaded after first successful fetch
      hasLoadedRef.current = true
      setIsLoading(false)
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      console.error('API key status polling error:', errorMessage)
      // Only clear loading on error if this was initial load
      if (!hasLoadedRef.current) {
        setIsLoading(false)
      }
    }
  }, [token, onApiKeyChange])

  const refresh = useCallback(async () => {
    await fetchData()
  }, [fetchData])

  // Set up polling with fixed interval
  useEffect(() => {
    // Initial fetch
    fetchData()

    intervalRef.current = setInterval(() => {
      fetchData()
    }, interval)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [fetchData, interval])

  return {
    apiKey,
    lastUpdated,
    isLoading,
    error,
    refresh,
  }
}
