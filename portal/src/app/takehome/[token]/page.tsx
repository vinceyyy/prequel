'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface TakeHomeStatus {
  sessionStatus: 'available' | 'activated' | 'completed' | 'expired'
  instanceStatus?: string
  accessUrl?: string
  password?: string
  activatedAt?: string
  autoDestroyAt?: string
  destroyedAt?: string
  timeRemaining?: number
  availableFrom?: string
  availableUntil?: string
  candidateName?: string
  challengeId?: string
}

interface ChallengeInfo {
  id: string
  name: string
  description: string
  ecsConfig: {
    cpu: number
    cpuCores: number
    memory: number
    storage: number
  }
}

export default function TakeHomePage() {
  const params = useParams()
  const token = params.token as string

  const [status, setStatus] = useState<TakeHomeStatus | null>(null)
  const [challenge, setChallenge] = useState<ChallengeInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)

  // Fetch take-home status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/takehome/${token}`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch take-home status')
      }

      const data: TakeHomeStatus = await response.json()
      setStatus(data)
      setError(null)

      // Fetch challenge details if available
      if (data.challengeId && !challenge) {
        const challengesResponse = await fetch('/api/challenges')
        if (challengesResponse.ok) {
          const challengesData = await challengesResponse.json()
          const foundChallenge = challengesData.challenges?.find(
            (c: ChallengeInfo) => c.id === data.challengeId
          )
          if (foundChallenge) {
            setChallenge(foundChallenge)
          }
        }
      }

      // Update time remaining if activated
      if (data.sessionStatus === 'activated' && data.timeRemaining) {
        setTimeRemaining(data.timeRemaining)
      }
    } catch (err) {
      console.error('Error fetching take-home status:', err)
      setError(err instanceof Error ? err.message : 'Failed to load take-home')
    } finally {
      setLoading(false)
    }
  }, [token, challenge])

  // Initial load
  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Polling for status updates when activated and not yet active
  useEffect(() => {
    if (
      status?.sessionStatus === 'activated' &&
      status.instanceStatus !== 'active'
    ) {
      const interval = setInterval(() => {
        fetchStatus()
      }, 5000) // Poll every 5 seconds

      return () => clearInterval(interval)
    }
  }, [status, fetchStatus])

  // Countdown timer for time remaining
  useEffect(() => {
    if (timeRemaining !== null && timeRemaining > 0) {
      const interval = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev === null || prev <= 0) {
            return 0
          }
          return prev - 1
        })
      }, 1000) // Update every second

      return () => clearInterval(interval)
    }
  }, [timeRemaining])

  // Handle activation
  const handleActivate = async () => {
    setActivating(true)
    setError(null)

    try {
      const response = await fetch(`/api/takehome/${token}/activate`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to activate take-home')
      }

      // Poll for status after activation
      await fetchStatus()
    } catch (err) {
      console.error('Error activating take-home:', err)
      setError(
        err instanceof Error ? err.message : 'Failed to activate take-home'
      )
    } finally {
      setActivating(false)
    }
  }

  // Format time remaining
  const formatTimeRemaining = (seconds: number): string => {
    if (seconds <= 0) return 'Expired'

    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`
    } else {
      return `${secs}s`
    }
  }

  // Calculate duration in hours from timeRemaining
  const getDurationHours = (): number => {
    if (!status?.autoDestroyAt || !status?.activatedAt) return 4 // Default 4 hours

    const activatedTime = new Date(status.activatedAt).getTime()
    const destroyTime = new Date(status.autoDestroyAt).getTime()
    const durationMs = destroyTime - activatedTime

    return Math.round(durationMs / (1000 * 60 * 60))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading take-home assessment...</p>
        </div>
      </div>
    )
  }

  if (error && !status) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
          <div className="text-center">
            <div className="text-red-600 text-5xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Error Loading Assessment
            </h1>
            <p className="text-slate-600 mb-4">{error}</p>
            <button
              onClick={() => {
                setLoading(true)
                setError(null)
                fetchStatus()
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!status) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-4 sm:p-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 mb-6">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            Take-Home Coding Assessment
          </h1>
          {status.candidateName && (
            <p className="text-slate-600">Welcome, {status.candidateName}</p>
          )}
        </div>

        {/* Status: Available (not yet activated) */}
        {status.sessionStatus === 'available' && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            {challenge && (
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                  {challenge.name}
                </h2>
                <p className="text-slate-600 mb-4">{challenge.description}</p>

                <div className="bg-slate-50 rounded-lg p-4 mb-4">
                  <h3 className="text-sm font-medium text-slate-700 mb-2">
                    Environment Specifications
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-slate-500">CPU:</span>
                      <span className="ml-2 font-medium text-slate-900">
                        {challenge.ecsConfig.cpuCores}{' '}
                        {challenge.ecsConfig.cpuCores === 1 ? 'core' : 'cores'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Memory:</span>
                      <span className="ml-2 font-medium text-slate-900">
                        {challenge.ecsConfig.memory / 1024}GB
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Storage:</span>
                      <span className="ml-2 font-medium text-slate-900">
                        {challenge.ecsConfig.storage}GB
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <h3 className="text-sm font-medium text-blue-900 mb-2">
                Assessment Details
              </h3>
              <div className="space-y-2 text-sm">
                {status.availableUntil && (
                  <div>
                    <span className="text-blue-700">Available until:</span>
                    <span className="ml-2 font-medium text-blue-900">
                      {new Date(status.availableUntil).toLocaleString()}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-blue-700">
                    Duration after activation:
                  </span>
                  <span className="ml-2 font-medium text-blue-900">
                    {getDurationHours()} hours
                  </span>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <p className="text-red-800 text-sm">{error}</p>
              </div>
            )}

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <p className="text-amber-800 text-sm">
                <strong>Important:</strong> Once you activate this assessment,
                the timer will start immediately. Make sure you are ready to
                begin before clicking the button below.
              </p>
            </div>

            <button
              onClick={handleActivate}
              disabled={activating}
              className="w-full sm:w-auto px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
            >
              {activating ? (
                <span className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Activating...
                </span>
              ) : (
                'Activate Take-Home Assessment'
              )}
            </button>
          </div>
        )}

        {/* Status: Activated + Initializing/Configuring */}
        {status.sessionStatus === 'activated' &&
          status.instanceStatus !== 'active' &&
          status.instanceStatus !== 'error' && (
            <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
              <div className="text-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                  Setting Up Your Environment
                </h2>
                <p className="text-slate-600 mb-4">
                  {status.instanceStatus === 'initializing'
                    ? 'Provisioning cloud infrastructure...'
                    : status.instanceStatus === 'configuring'
                      ? 'Configuring VS Code environment...'
                      : 'Preparing your coding environment...'}
                </p>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 inline-block">
                  <p className="text-blue-900 text-sm">
                    Status:{' '}
                    <span className="font-medium capitalize">
                      {status.instanceStatus || 'pending'}
                    </span>
                  </p>
                  <p className="text-blue-700 text-xs mt-1">
                    This usually takes 3-5 minutes
                  </p>
                </div>
              </div>
            </div>
          )}

        {/* Status: Activated + Active */}
        {status.sessionStatus === 'activated' &&
          status.instanceStatus === 'active' &&
          status.accessUrl &&
          status.password && (
            <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-slate-900">
                    Your Environment is Ready!
                  </h2>
                  <div className="flex items-center space-x-2">
                    <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-sm font-medium text-green-700">
                      Active
                    </span>
                  </div>
                </div>

                {timeRemaining !== null && (
                  <div
                    className={`rounded-lg p-4 mb-4 ${
                      timeRemaining < 600
                        ? 'bg-red-50 border border-red-200'
                        : timeRemaining < 1800
                          ? 'bg-amber-50 border border-amber-200'
                          : 'bg-green-50 border border-green-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-sm font-medium ${
                          timeRemaining < 600
                            ? 'text-red-700'
                            : timeRemaining < 1800
                              ? 'text-amber-700'
                              : 'text-green-700'
                        }`}
                      >
                        Time Remaining:
                      </span>
                      <span
                        className={`text-2xl font-bold ${
                          timeRemaining < 600
                            ? 'text-red-900'
                            : timeRemaining < 1800
                              ? 'text-amber-900'
                              : 'text-green-900'
                        }`}
                      >
                        {formatTimeRemaining(timeRemaining)}
                      </span>
                    </div>
                    {timeRemaining < 600 && (
                      <p className="text-red-700 text-xs mt-2">
                        Your environment will be automatically destroyed when
                        time expires. Save your work!
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-slate-50 rounded-lg p-4 sm:p-6 mb-6">
                <h3 className="text-sm font-medium text-slate-700 mb-3">
                  Access Credentials
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      VS Code URL
                    </label>
                    <div className="flex items-center space-x-2">
                      <a
                        href={status.accessUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-blue-600 hover:text-blue-700 hover:bg-blue-50 transition-colors text-sm font-mono break-all"
                      >
                        {status.accessUrl}
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(status.accessUrl!)
                        }}
                        className="px-3 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">
                      Password
                    </label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        readOnly
                        value={status.password}
                        className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono text-sm"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(status.password!)
                        }}
                        className="px-3 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {challenge && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-blue-900 mb-2">
                    Challenge: {challenge.name}
                  </h3>
                  <p className="text-blue-800 text-sm">
                    {challenge.description}
                  </p>
                </div>
              )}
            </div>
          )}

        {/* Status: Activated + Error */}
        {status.sessionStatus === 'activated' &&
          status.instanceStatus === 'error' && (
            <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
              <div className="text-center">
                <div className="text-red-600 text-5xl mb-4">⚠️</div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                  Setup Failed
                </h2>
                <p className="text-slate-600 mb-4">
                  There was an error setting up your environment. Please contact
                  support with your assessment link.
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 inline-block">
                  <p className="text-red-900 text-sm">
                    Status: <span className="font-medium">Error</span>
                  </p>
                </div>
              </div>
            </div>
          )}

        {/* Status: Completed */}
        {status.sessionStatus === 'completed' && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            <div className="text-center">
              <div className="text-green-600 text-5xl mb-4">✓</div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Assessment Completed
              </h2>
              <p className="text-slate-600 mb-4">
                Your take-home assessment has been completed and the environment
                has been destroyed.
              </p>
              {status.destroyedAt && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 inline-block">
                  <p className="text-slate-700 text-sm">
                    Completed at:{' '}
                    <span className="font-medium">
                      {new Date(status.destroyedAt).toLocaleString()}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status: Expired */}
        {status.sessionStatus === 'expired' && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            <div className="text-center">
              <div className="text-amber-600 text-5xl mb-4">⏱️</div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Assessment Expired
              </h2>
              <p className="text-slate-600 mb-4">
                This take-home assessment is no longer available. The activation
                window has passed.
              </p>
              {status.availableUntil && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 inline-block">
                  <p className="text-slate-700 text-sm">
                    Expired on:{' '}
                    <span className="font-medium">
                      {new Date(status.availableUntil).toLocaleString()}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
