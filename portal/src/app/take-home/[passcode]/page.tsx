'use client'

import { use, useEffect, useState } from 'react'
import { useSSE } from '@/hooks/useSSE'

interface Interview {
  id: string
  candidateName: string
  challenge: string
  customInstructions?: string
  status: string
  validUntil: string
  durationMinutes: number
  passcode: string
  accessUrl?: string
  password?: string
  autoDestroyAt?: string
}

export default function TakeHomePage({
  params,
}: {
  params: Promise<{ passcode: string }>
}) {
  const { passcode } = use(params)
  const [interview, setInterview] = useState<Interview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activating, setActivating] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState<string>('')

  const { lastEvent } = useSSE('/api/events')

  // Fetch interview data
  const fetchInterview = async () => {
    try {
      const response = await fetch(`/api/interviews/by-passcode/${passcode}`)
      if (response.ok) {
        const data = await response.json()
        setInterview(data)
        setError(null)
      } else {
        const data = await response.json()
        setError(data.error || 'Take-home test not found')
      }
    } catch {
      setError('Failed to load take-home test')
    } finally {
      setLoading(false)
    }
  }

  // Initial load
  useEffect(() => {
    fetchInterview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passcode])

  // SSE updates - refresh interview when operation updates
  useEffect(() => {
    if (lastEvent?.type === 'operation_update' && interview) {
      const operation = lastEvent.operation
      if (operation?.interviewId === interview.id) {
        fetchInterview()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent, interview?.id])

  // Countdown timer
  useEffect(() => {
    if (!interview?.autoDestroyAt) {
      setTimeRemaining('')
      return
    }

    const updateTimer = () => {
      const now = Date.now()
      const destroyTime = new Date(interview.autoDestroyAt!).getTime()
      const diff = destroyTime - now

      if (diff <= 0) {
        setTimeRemaining('Expired')
        return
      }

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      setTimeRemaining(`${hours}h ${minutes}m ${seconds}s`)
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)

    return () => clearInterval(interval)
  }, [interview?.autoDestroyAt])

  // Handle start test button click
  const handleStart = async () => {
    if (!interview) return

    setActivating(true)
    setError(null)

    try {
      const response = await fetch(`/api/interviews/${interview.id}/activate`, {
        method: 'POST',
      })

      const data = await response.json()

      if (response.ok) {
        // Success - page will update via SSE
        fetchInterview()
      } else {
        setError(data.error || 'Failed to start test')
      }
    } catch {
      setError('Failed to start test. Please try again.')
    } finally {
      setActivating(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-slate-600">Loading...</div>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !interview) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md">
          <div className="text-red-600 text-xl font-semibold mb-4">Error</div>
          <div className="text-slate-700">{error || 'Invalid invitation'}</div>
        </div>
      </div>
    )
  }

  const validUntil = new Date(interview.validUntil)
  const isExpired = new Date() > validUntil
  const isNotStarted = interview.status === 'active' && !interview.accessUrl
  const isProvisioning =
    interview.status === 'activated' ||
    interview.status === 'initializing' ||
    interview.status === 'configuring'
  const isReady = interview.status === 'active' && interview.accessUrl
  const isCompleted =
    interview.status === 'destroyed' || interview.status === 'completed'
  const hasError = interview.status === 'error'

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto py-12 px-4">
        <div className="bg-white rounded-lg shadow-md p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-800 mb-2">
              Take-Home Test: {interview.candidateName}
            </h1>
            <div className="text-sm text-slate-500 mt-2">
              Valid until: {validUntil.toLocaleString()}
            </div>
          </div>

          {/* Not Started - Show Instructions and Start Button */}
          {isNotStarted && !isExpired && (
            <>
              {/* Platform Instructions */}
              <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h2 className="text-lg font-semibold text-blue-900 mb-3">
                  Platform Instructions
                </h2>
                <ul className="space-y-2 text-blue-800 text-sm">
                  <li>
                    • Click &quot;Start Test&quot; to begin provisioning your
                    workspace
                  </li>
                  <li>
                    • Your workspace will be ready in approximately 3-5 minutes
                  </li>
                  <li>
                    • You will have {interview.durationMinutes} minutes to
                    complete the challenge
                  </li>
                  <li>
                    • Once your workspace is created, it will automatically shut
                    down after {interview.durationMinutes} minutes
                  </li>
                  <li>• All your work will be automatically saved</li>
                  <li>• You can only start this test once</li>
                </ul>
              </div>

              {/* Custom Instructions */}
              {interview.customInstructions && (
                <div className="mb-6 bg-slate-50 border border-slate-200 rounded-lg p-6">
                  <h2 className="text-lg font-semibold text-slate-800 mb-3">
                    Challenge Instructions
                  </h2>
                  <div className="text-slate-700 whitespace-pre-wrap text-sm">
                    {interview.customInstructions}
                  </div>
                </div>
              )}

              {/* Start Button */}
              <div className="mt-8">
                <button
                  onClick={handleStart}
                  disabled={activating}
                  className={`w-full py-4 px-6 rounded-lg font-semibold text-lg transition-colors ${
                    activating
                      ? 'bg-slate-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {activating ? 'Starting...' : 'Start Test'}
                </button>
              </div>
            </>
          )}

          {/* Provisioning - Show Progress */}
          {isProvisioning && (
            <div className="text-center py-12">
              <div className="mb-6">
                <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600"></div>
              </div>
              <h2 className="text-2xl font-semibold text-slate-800 mb-4">
                {interview.status === 'activated' && 'Starting your test...'}
                {interview.status === 'initializing' &&
                  'Provisioning infrastructure...'}
                {interview.status === 'configuring' &&
                  'Setting up your workspace...'}
              </h2>
              <p className="text-slate-600">
                This typically takes 3-5 minutes. You can safely close this page
                and return later.
              </p>
              {interview.status === 'configuring' && interview.accessUrl && (
                <div className="mt-6 text-left bg-blue-50 border border-blue-200 rounded-lg p-6">
                  <p className="text-blue-800 text-sm">
                    Your workspace URL is ready! The environment is still being
                    configured...
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Ready - Show Access Details */}
          {isReady && (
            <div className="space-y-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                <h2 className="text-2xl font-semibold text-green-900 mb-4">
                  Your Workspace is Ready!
                </h2>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-green-900 mb-2">
                      Access URL:
                    </label>
                    <div className="flex items-center gap-2">
                      <a
                        href={interview.accessUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 px-4 py-2 bg-white border border-green-300 rounded text-green-900 hover:bg-green-50 font-mono text-sm break-all"
                      >
                        {interview.accessUrl}
                      </a>
                      <button
                        onClick={() =>
                          navigator.clipboard.writeText(interview.accessUrl!)
                        }
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-green-900 mb-2">
                      Password:
                    </label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-4 py-2 bg-white border border-green-300 rounded text-green-900 font-mono text-sm">
                        {interview.password}
                      </code>
                      <button
                        onClick={() =>
                          navigator.clipboard.writeText(interview.password!)
                        }
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  {timeRemaining && (
                    <div className="pt-4 border-t border-green-200">
                      <p className="text-sm text-green-800">
                        Time remaining:{' '}
                        <span className="font-semibold">{timeRemaining}</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {interview.customInstructions && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-slate-800 mb-3">
                    Challenge Instructions
                  </h3>
                  <div className="text-slate-700 whitespace-pre-wrap text-sm">
                    {interview.customInstructions}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Completed */}
          {isCompleted && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">✅</div>
              <h2 className="text-2xl font-semibold text-slate-800 mb-4">
                Test Completed
              </h2>
              <p className="text-slate-600">
                Your workspace has been shut down and your work has been saved.
              </p>
            </div>
          )}

          {/* Provisioning Error */}
          {hasError && (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">❌</div>
              <h2 className="text-2xl font-semibold text-red-700 mb-4">
                Provisioning Failed
              </h2>
              <p className="text-slate-600 mb-6">
                There was an error setting up your workspace. Please contact the
                interviewer for assistance.
              </p>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-left">
                <p className="text-sm text-red-800 font-semibold mb-2">
                  What happened?
                </p>
                <p className="text-sm text-red-700">
                  The system encountered an error while provisioning your coding
                  environment. This is typically a temporary infrastructure
                  issue. The interviewer has been notified and will reach out to
                  you shortly.
                </p>
              </div>
            </div>
          )}

          {/* Expired */}
          {isExpired && isNotStarted && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-700">
              This invitation has expired
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
