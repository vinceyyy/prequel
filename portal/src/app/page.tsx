'use client'

import { useState, useEffect, useCallback } from 'react'
import OperationDashboard from '@/components/OperationDashboard'
import { useOperations } from '@/hooks/useOperations'
import { useSSE } from '@/hooks/useSSE'

interface Interview {
  id: string
  candidateName: string
  status:
    | 'scheduled'
    | 'initializing'
    | 'configuring'
    | 'active'
    | 'destroying'
    | 'destroyed'
    | 'error'
  challenge: string
  accessUrl?: string
  password?: string
  createdAt: string
  scheduledAt?: string
  autoDestroyAt?: string
}

export default function Home() {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [selectedInterviewForLogs, setSelectedInterviewForLogs] = useState<
    string | null
  >(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    candidateName: '',
    challenge: 'python',
    scheduledAt: '',
    autoDestroyMinutes: 60,
    enableScheduling: false,
  })

  // Use the operations hook for background operations
  const { destroyInterview } = useOperations()

  // Use SSE for real-time updates
  const { connected: sseConnected, lastEvent } = useSSE('/api/events')

  const [challenges, setChallenges] = useState<
    Array<{ id: string; name: string }>
  >([])

  const loadChallenges = useCallback(async () => {
    try {
      const response = await fetch('/api/challenges')
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.challenges) {
          console.log('[DEBUG] Loaded challenges from API:', data.challenges)
          setChallenges(data.challenges)
        }
      } else {
        console.warn('Failed to load challenges, using fallback')
      }
    } catch (error) {
      console.error('Error loading challenges:', error)
    }
  }, [])

  const loadInterviews = useCallback(async () => {
    try {
      // Add cache busting to ensure fresh data
      const timestamp = new Date().getTime()
      const response = await fetch(`/api/interviews?t=${timestamp}`)
      if (response.ok) {
        const data = await response.json()
        console.log(
          '[DEBUG] Loaded interviews from API:',
          data.interviews?.map((i: Interview) => ({
            id: i.id,
            status: i.status,
            candidateName: i.candidateName,
          }))
        )

        const newInterviews = data.interviews || []
        console.log(
          '[DEBUG] Setting new interviews state:',
          newInterviews.map((i: Interview) => ({
            id: i.id,
            status: i.status,
            candidateName: i.candidateName,
          }))
        )

        setInterviews(newInterviews)
      } else {
        console.error('Failed to load interviews')
      }
    } catch (error) {
      console.error('Error loading interviews:', error)
    } finally {
      // Set initial loading to false after first load
      if (initialLoading) {
        setInitialLoading(false)
      }
    }
  }, [initialLoading])

  // Step 1: One-off request when user first loads the page, blocking until response
  useEffect(() => {
    console.log(
      '[DEBUG] Main page: Step 1 - Initial load, checking existing interviews (one-off request)'
    )
    loadInterviews()
    loadChallenges()
  }, [loadInterviews, loadChallenges])

  // Listen for SSE events to refresh data
  useEffect(() => {
    if (lastEvent) {
      console.log('Received SSE event:', lastEvent)

      // Refresh interviews when operations complete or update
      if (
        lastEvent.type === 'operation_update' ||
        lastEvent.type === 'scheduler_event'
      ) {
        console.log('Refreshing interviews due to SSE event')
        loadInterviews()
      }
    }
  }, [lastEvent, loadInterviews])

  // NO AUTOMATIC POLLING - interviews endpoint is manual refresh only

  // Debug: Monitor when interviews state changes
  useEffect(() => {
    console.log(
      '[DEBUG] Interviews state changed:',
      interviews.map(i => ({
        id: i.id,
        status: i.status,
        candidateName: i.candidateName,
      }))
    )
  }, [interviews])

  // NO AUTOMATIC COMPLETION DETECTION - since interviews endpoint is manual only
  // Users can manually refresh to see completion status

  const handleCreateInterview = async () => {
    if (!formData.candidateName.trim()) return

    setLoading(true)
    try {
      // Prepare the request body
      const requestBody: {
        candidateName: string
        challenge: string
        scheduledAt?: string
        autoDestroyMinutes?: number
      } = {
        candidateName: formData.candidateName.trim(),
        challenge: formData.challenge,
      }

      // Add scheduling if enabled
      if (formData.enableScheduling && formData.scheduledAt) {
        requestBody.scheduledAt = formData.scheduledAt
      }

      // Auto-destroy is always enabled and required
      requestBody.autoDestroyMinutes = formData.autoDestroyMinutes

      // Make the API call
      const response = await fetch('/api/interviews/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create interview')
      }

      await response.json()

      // Close the modal immediately since operation is now background
      setFormData({
        candidateName: '',
        challenge: 'python',
        scheduledAt: '',
        autoDestroyMinutes: 60,
        enableScheduling: false,
      })
      setShowCreateForm(false)

      // Show notification
      const message = formData.enableScheduling
        ? `Interview scheduled for ${formData.candidateName.trim()}`
        : `Interview creation started for ${formData.candidateName.trim()}`
      setNotification(message)
      setTimeout(() => setNotification(null), 5000) // Clear after 5 seconds

      // Refresh the interview list
      loadInterviews()
    } catch (error) {
      console.error('Error creating interview:', error)
      alert(
        `Failed to start interview creation: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    } finally {
      setLoading(false)
    }
  }

  const stopInterview = async (id: string) => {
    const interview = interviews.find(i => i.id === id)
    const isErrorState = interview?.status === 'error'

    const message = isErrorState
      ? 'Are you sure you want to retry destroying this interview? This will attempt to clean up any remaining AWS resources and remove the workspace from S3.'
      : 'Are you sure you want to stop and destroy this interview? This action cannot be undone.'

    if (!confirm(message)) {
      return
    }

    try {
      // Use the background destroy API
      await destroyInterview(id)

      // Show notification
      const candidateName = interview?.candidateName || 'Unknown'
      const actionText = isErrorState ? 'retry destroy' : 'destroy'
      setNotification(`Interview ${actionText} started for ${candidateName}`)
      setTimeout(() => setNotification(null), 5000) // Clear after 5 seconds

      // NO automatic refresh - user can manually refresh to see latest state
    } catch (error) {
      console.error('Error destroying interview:', error)
      setNotification('❌ Failed to start destroy operation. Please try again.')
      setTimeout(() => setNotification(null), 5000)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8 w-full overflow-x-hidden">
      {/* Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 text-white px-6 py-3 rounded-lg shadow-lg z-50 ${
            notification.includes('❌') ? 'bg-red-500' : 'bg-green-500'
          }`}
        >
          <div className="flex items-center space-x-2">
            {notification.includes('started') && (
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
            )}
            <span>{notification}</span>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Prequel Portal</h1>
          <p className="text-gray-600 mt-2">
            Manage coding interviews and VS Code instances
          </p>
        </header>

        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create New Interview
          </button>
          <button
            onClick={loadInterviews}
            className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
          >
            Refresh
          </button>
          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${
                sseConnected ? 'bg-green-500' : 'bg-red-500'
              }`}
            ></div>
            <span className="text-sm text-gray-600">
              {sseConnected ? 'Live updates' : 'Offline'}
            </span>
          </div>
        </div>

        {showCreateForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-md">
              <h2 className="text-xl font-semibold mb-4 text-gray-900">
                Create New Interview
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Candidate Name
                  </label>
                  <input
                    type="text"
                    value={formData.candidateName}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        candidateName: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500"
                    placeholder="Enter candidate name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Interview Challenge
                  </label>
                  <select
                    value={formData.challenge}
                    onChange={e =>
                      setFormData({ ...formData, challenge: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  >
                    {challenges.map(challenge => (
                      <option key={challenge.id} value={challenge.id}>
                        {challenge.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Scheduling Options */}
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="enableScheduling"
                      checked={formData.enableScheduling}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          enableScheduling: e.target.checked,
                        })
                      }
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label
                      htmlFor="enableScheduling"
                      className="text-sm font-medium text-gray-900"
                    >
                      Schedule for later
                    </label>
                  </div>

                  {formData.enableScheduling && (
                    <div>
                      <label className="block text-sm font-medium text-gray-900 mb-1">
                        Scheduled Start Time
                      </label>
                      <input
                        type="datetime-local"
                        value={formData.scheduledAt}
                        onChange={e =>
                          setFormData({
                            ...formData,
                            scheduledAt: e.target.value,
                          })
                        }
                        min={new Date().toISOString().slice(0, 16)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1">
                      Interview Duration <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.autoDestroyMinutes}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          autoDestroyMinutes: parseInt(e.target.value),
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                      required
                    >
                      <option value={30}>30 minutes</option>
                      <option value={45}>45 minutes</option>
                      <option value={60}>1 hour</option>
                      <option value={90}>1.5 hours</option>
                      <option value={120}>2 hours</option>
                      <option value={180}>3 hours</option>
                      <option value={240}>4 hours</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Required: Interview will auto-destroy after this duration
                      to prevent resource waste
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCreateInterview}
                  disabled={
                    !formData.candidateName.trim() ||
                    loading ||
                    (formData.enableScheduling && !formData.scheduledAt)
                  }
                  className="flex-1 bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                >
                  {loading
                    ? 'Creating...'
                    : formData.enableScheduling
                      ? 'Schedule Interview'
                      : 'Create Interview'}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 bg-red-600 text-white py-2 rounded-md hover:bg-red-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Candidate
                  </th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Challenge
                  </th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Schedule
                  </th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Access Details
                  </th>
                  <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {initialLoading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 sm:px-6 py-4 text-center text-gray-500"
                    >
                      <div className="flex items-center justify-center space-x-2">
                        <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                        <span>Loading interviews...</span>
                      </div>
                    </td>
                  </tr>
                ) : interviews.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 sm:px-6 py-4 text-center text-gray-500"
                    >
                      No interviews created yet
                    </td>
                  </tr>
                ) : (
                  interviews.map(interview => (
                    <tr key={interview.id}>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {interview.candidateName}
                        </div>
                        <div className="text-sm text-gray-500">
                          {new Date(interview.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {
                          challenges.find(c => c.id === interview.challenge)
                            ?.name
                        }
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                        <div>
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              interview.status === 'scheduled'
                                ? 'bg-purple-100 text-purple-800'
                                : interview.status === 'initializing'
                                  ? 'bg-blue-100 text-blue-800'
                                  : interview.status === 'configuring'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : interview.status === 'active'
                                      ? 'bg-green-100 text-green-800'
                                      : interview.status === 'destroying'
                                        ? 'bg-orange-100 text-orange-800'
                                        : interview.status === 'error'
                                          ? 'bg-red-100 text-red-800'
                                          : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {interview.status}
                          </span>
                          {interview.status === 'error' && (
                            <div className="text-xs text-red-600 mt-1">
                              Resources may need cleanup
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {interview.status === 'scheduled' &&
                        interview.scheduledAt ? (
                          <div className="space-y-2">
                            <div className="bg-purple-50 p-2 rounded border border-purple-200">
                              <div className="text-xs font-medium text-purple-700">
                                Starts:
                              </div>
                              <div className="text-sm font-semibold text-purple-900">
                                {new Date(
                                  interview.scheduledAt
                                ).toLocaleString()}
                              </div>
                            </div>
                            {interview.autoDestroyAt && (
                              <div className="bg-red-50 p-2 rounded border border-red-200">
                                <div className="text-xs font-medium text-red-700">
                                  Auto-destroy:
                                </div>
                                <div className="text-sm font-semibold text-red-900">
                                  {new Date(
                                    interview.autoDestroyAt
                                  ).toLocaleString()}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            {interview.scheduledAt && (
                              <div className="mb-1">
                                <div className="text-xs text-gray-500">
                                  Started:
                                </div>
                                <div className="text-sm">
                                  {new Date(
                                    interview.scheduledAt
                                  ).toLocaleString()}
                                </div>
                              </div>
                            )}
                            {interview.autoDestroyAt && (
                              <div className="bg-yellow-50 p-1 rounded border border-yellow-200">
                                <div className="text-xs text-yellow-700">
                                  Auto-destroy:
                                </div>
                                <div className="text-xs font-medium text-yellow-900">
                                  {new Date(
                                    interview.autoDestroyAt
                                  ).toLocaleString()}
                                </div>
                              </div>
                            )}
                            {!interview.scheduledAt &&
                              !interview.autoDestroyAt && (
                                <span className="text-gray-400">Immediate</span>
                              )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-sm text-gray-900">
                        {interview.accessUrl ? (
                          <div className="max-w-xs">
                            <a
                              className="text-blue-600 underline cursor-pointer break-all"
                              href={interview.accessUrl}
                              target="_blank"
                            >
                              {interview.accessUrl}
                            </a>
                            <div className="text-gray-500 break-all">
                              Password: {interview.password}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-400">Not started</span>
                        )}
                      </td>
                      <td className="px-3 sm:px-6 py-4 text-sm font-medium">
                        <div className="flex flex-wrap gap-2 items-center">
                          {interview.status === 'active' && (
                            <button
                              onClick={() => stopInterview(interview.id)}
                              className="bg-red-600 hover:bg-red-700 cursor-pointer text-white px-2 py-1 rounded-lg transition-colors"
                            >
                              Stop & Destroy
                            </button>
                          )}
                          {interview.status === 'scheduled' && (
                            <span className="text-purple-600">
                              Scheduled...
                            </span>
                          )}
                          {interview.status === 'initializing' && (
                            <span className="text-blue-600">
                              Initializing...
                            </span>
                          )}
                          {interview.status === 'configuring' && (
                            <span className="text-yellow-600">
                              Configuring...
                            </span>
                          )}
                          {interview.status === 'destroying' && (
                            <span className="text-orange-600">
                              Destroying...
                            </span>
                          )}
                          {interview.status === 'error' && (
                            <button
                              onClick={() => stopInterview(interview.id)}
                              className="bg-red-600 hover:bg-red-700 cursor-pointer text-white px-2 py-1 rounded-lg transition-colors"
                            >
                              Retry Destroy
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setSelectedInterviewForLogs(interview.id)
                              setShowLogsModal(true)
                            }}
                            className="bg-blue-600 hover:bg-blue-700 cursor-pointer text-white px-2 py-1 rounded-lg transition-colors"
                          >
                            Logs
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Logs Modal */}
        {showLogsModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-4 sm:p-6 w-full max-w-6xl h-5/6 max-h-screen overflow-hidden">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  Operation Logs
                  {selectedInterviewForLogs
                    ? ` - Interview ${selectedInterviewForLogs}`
                    : ''}
                </h2>
                <button
                  onClick={() => {
                    setShowLogsModal(false)
                    setSelectedInterviewForLogs(null)
                  }}
                  className="text-gray-500 hover:text-gray-700 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <OperationDashboard interviewFilter={selectedInterviewForLogs} />

              <div className="flex justify-end mt-4">
                <button
                  onClick={() => {
                    setShowLogsModal(false)
                    setSelectedInterviewForLogs(null)
                  }}
                  className="bg-gray-200 text-gray-900 px-4 py-2 rounded-md hover:bg-gray-300 transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
