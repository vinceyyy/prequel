'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useApiKeyStatusPolling } from '@/hooks/usePolling'

export default function ApiKeyPage() {
  const params = useParams()
  const token = params.token as string

  const {
    apiKey,
    isLoading,
    error: fetchError,
  } = useApiKeyStatusPolling({
    token,
  })

  const [activating, setActivating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  // Update time remaining when apiKey changes
  useEffect(() => {
    if (apiKey?.status === 'active' && apiKey.expiresAt) {
      const remaining = Math.max(
        0,
        Math.floor((apiKey.expiresAt - Date.now() / 1000) / 1)
      )
      setTimeRemaining(remaining)
    } else {
      setTimeRemaining(null)
    }
  }, [apiKey])

  // Countdown timer for active keys
  useEffect(() => {
    if (timeRemaining !== null && timeRemaining > 0) {
      const interval = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev === null || prev <= 0) {
            return 0
          }
          return prev - 1
        })
      }, 1000)

      return () => clearInterval(interval)
    }
  }, [timeRemaining])

  // Handle activation
  const handleActivate = async () => {
    setActivating(true)
    setError(null)

    try {
      const response = await fetch(`/api/apikey/${token}/activate`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to activate API key')
      }
    } catch (err) {
      console.error('Error activating API key:', err)
      setError(err instanceof Error ? err.message : 'Failed to activate')
    } finally {
      setActivating(false)
    }
  }

  // Handle copy to clipboard
  const handleCopy = () => {
    if (apiKey?.apiKey) {
      navigator.clipboard.writeText(apiKey.apiKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
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

  // Format duration in a readable way
  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    if (hours >= 24) {
      return `${Math.floor(hours / 24)} days`
    }
    return `${hours} hours`
  }

  // Get configured duration
  const getDurationSeconds = (): number => {
    // Use durationSeconds if available (set during creation)
    if (apiKey?.durationSeconds) {
      return apiKey.durationSeconds
    }
    // Fall back to calculating from timestamps for active keys
    if (apiKey?.activatedAt && apiKey?.expiresAt) {
      return Math.floor(apiKey.expiresAt - apiKey.activatedAt)
    }
    return 4 * 3600 // Default 4 hours
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading API key...</p>
        </div>
      </div>
    )
  }

  if ((fetchError || error) && !apiKey) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
          <div className="text-center">
            <div className="text-red-600 text-5xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Error Loading API Key
            </h1>
            <p className="text-slate-600 mb-4">{fetchError || error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!apiKey) {
    return null
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto p-4 sm:p-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 mb-4">
          <h1 className="text-3xl font-bold text-slate-900 mb-2">
            OpenAI API Key Access
          </h1>
          {apiKey.name && <p className="text-slate-600">Key: {apiKey.name}</p>}
        </div>

        {/* Status: Scheduled */}
        {apiKey.status === 'scheduled' && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            <div className="text-center">
              <div className="text-purple-600 text-5xl mb-4">⏰</div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Scheduled
              </h2>
              {apiKey.scheduledAt && (
                <p className="text-slate-600 mb-4">
                  This API key is scheduled to become available on{' '}
                  <span className="font-medium">
                    {new Date(apiKey.scheduledAt * 1000).toLocaleString()}
                  </span>
                </p>
              )}
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 inline-block">
                <p className="text-purple-900 text-sm">
                  Please check back at the scheduled time.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Status: Available */}
        {apiKey.status === 'available' && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
              <h2 className="text-xl font-bold text-blue-900 mb-4">
                Instructions
              </h2>
              <div className="space-y-3 text-sm text-blue-900">
                <p>
                  You have been granted access to a temporary OpenAI API key.
                </p>
                <p>Once activated:</p>
                <ul className="list-disc list-inside ml-2 space-y-1">
                  <li>
                    The key will be valid for{' '}
                    {formatDuration(getDurationSeconds())}
                  </li>
                  <li>It will be automatically deleted when expired</li>
                  <li>You can use it with any OpenAI-compatible tool</li>
                </ul>
                {apiKey.scheduledAt && (
                  <p className="mt-4">
                    <strong>Available until:</strong>{' '}
                    {new Date(apiKey.scheduledAt * 1000).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                <p className="text-red-800 text-sm">{error}</p>
              </div>
            )}

            <button
              onClick={handleActivate}
              disabled={activating}
              className="w-full px-8 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-blue-300 cursor-pointer disabled:cursor-not-allowed transition-colors"
            >
              {activating ? (
                <span className="flex items-center justify-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Activating...
                </span>
              ) : (
                'Activate API Key'
              )}
            </button>
          </div>
        )}

        {/* Status: Initializing */}
        {apiKey.status === 'initializing' && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Initializing API Key
              </h2>
              <p className="text-slate-600 mb-4">
                Creating your OpenAI API key...
              </p>
              <p className="text-slate-600 text-sm">
                This typically takes a few seconds.
              </p>
            </div>
          </div>
        )}

        {/* Status: Active */}
        {apiKey.status === 'active' && apiKey.apiKey && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-slate-900">
                  Your API Key is Ready!
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
                      Your API key will be automatically deleted when time
                      expires.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="bg-slate-50 rounded-lg p-4 sm:p-6 mb-6">
              <h3 className="text-sm font-medium text-slate-700 mb-3">
                API Key
              </h3>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={apiKey.apiKey}
                  className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono text-sm"
                />
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm text-slate-900 font-medium cursor-pointer min-w-[60px]"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <h3 className="text-sm font-bold text-blue-900 mb-2">
                Usage Instructions
              </h3>
              <div className="text-sm text-blue-900 space-y-2">
                <p>Use this key with any OpenAI-compatible tool or library:</p>
                <div className="bg-white rounded p-2 font-mono text-xs overflow-x-auto">
                  export OPENAI_API_KEY={apiKey.apiKey}
                </div>
                <p className="text-xs">
                  The key will be automatically deleted after{' '}
                  {formatDuration(getDurationSeconds())}.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-2">
                Available Models & Rate Limits
              </h3>
              <div className="overflow-x-auto">
                <table className="text-sm text-slate-700 border-collapse w-full">
                  <thead>
                    <tr className="border-b border-slate-300">
                      <th className="text-left pr-6 pb-1 font-medium">Model</th>
                      <th className="text-right pb-1 font-medium">
                        Tokens/min
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-xs">
                    <tr>
                      <td className="pr-6 py-0.5">gpt-5</td>
                      <td className="text-right">25,000</td>
                    </tr>
                    <tr>
                      <td className="pr-6 py-0.5">gpt-5-mini</td>
                      <td className="text-right">125,000</td>
                    </tr>
                    <tr>
                      <td className="pr-6 py-0.5">gpt-5-nano</td>
                      <td className="text-right">625,000</td>
                    </tr>
                    <tr>
                      <td className="pr-6 py-0.5">gpt-4.1</td>
                      <td className="text-right">30,000</td>
                    </tr>
                    <tr>
                      <td className="pr-6 py-0.5">gpt-4.1-mini</td>
                      <td className="text-right">150,000</td>
                    </tr>
                    <tr>
                      <td className="pr-6 py-0.5">gpt-4.1-nano</td>
                      <td className="text-right">600,000</td>
                    </tr>
                    <tr>
                      <td className="pr-6 py-0.5">gpt-4o-mini</td>
                      <td className="text-right">400,000</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Status: Expired */}
        {apiKey.status === 'expired' && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            <div className="text-center">
              <div className="text-amber-600 text-5xl mb-4">⏱️</div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                API Key Expired
              </h2>
              <p className="text-slate-600 mb-4">
                This API key is no longer available. It has been automatically
                deleted.
              </p>
              {apiKey.expiredAt && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 inline-block">
                  <p className="text-slate-700 text-sm">
                    Expired on:{' '}
                    <span className="font-medium">
                      {new Date(apiKey.expiredAt * 1000).toLocaleString()}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status: Revoked */}
        {apiKey.status === 'revoked' && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            <div className="text-center">
              <div className="text-red-600 text-5xl mb-4">🚫</div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                API Key Revoked
              </h2>
              <p className="text-slate-600 mb-4">
                This API key has been revoked and is no longer available.
              </p>
            </div>
          </div>
        )}

        {/* Status: Error */}
        {apiKey.status === 'error' && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            <div className="text-center">
              <div className="text-red-600 text-5xl mb-4">⚠️</div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Error</h2>
              <p className="text-slate-600 mb-4">
                There was an error with this API key. Please contact support.
              </p>
            </div>
          </div>
        )}

        {/* Status: Orphan */}
        {apiKey.status === 'orphan' && (
          <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8">
            <div className="text-center">
              <div className="text-amber-600 text-5xl mb-4">⚠️</div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                API Key Issue
              </h2>
              <p className="text-slate-600 mb-4">
                This API key has a configuration issue. Please contact support.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
