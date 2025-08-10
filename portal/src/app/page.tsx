'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import OperationDashboard from '@/components/OperationDashboard'
import CleanupDashboard from '@/components/CleanupDashboard'
import AuthStatus from '@/components/AuthStatus'
import { useOperations } from '@/hooks/useOperations'
import { useSSE, type OperationData } from '@/hooks/useSSE'

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
  saveFiles: boolean
  accessUrl?: string
  password?: string
  createdAt: string
  scheduledAt?: string
  autoDestroyAt?: string
  completedAt?: string
  destroyedAt?: string
  historyS3Key?: string
}

export default function Home() {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [historicalInterviews, setHistoricalInterviews] = useState<Interview[]>(
    []
  )
  const [activeTab, setActiveTab] = useState<'current' | 'history' | 'admin'>(
    'current'
  )
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [creatingInterviewId, setCreatingInterviewId] = useState<string | null>(
    null
  )
  const [initialLoading, setInitialLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const historyLoadingRef = useRef(false)
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [selectedInterviewForLogs, setSelectedInterviewForLogs] = useState<
    string | null
  >(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    candidateName: '',
    challenge: '', // Will be set to first available challenge
    scheduledAt: '',
    autoDestroyMinutes: 60,
    enableScheduling: false,
    saveFiles: true, // Default to true as requested
  })

  // Use the operations hook for background operations
  const { destroyInterview } = useOperations()

  // Use SSE for real-time updates
  const { connected: sseConnected, lastEvent } = useSSE('/api/events')

  const [challenges, setChallenges] = useState<
    Array<{
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
    }>
  >([])

  const loadChallenges = useCallback(async () => {
    try {
      const response = await fetch('/api/challenges')
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.challenges) {
          console.log('[DEBUG] Loaded challenges from API:', data.challenges)
          setChallenges(data.challenges)
          // Set first challenge as default if no challenge selected
          if (data.challenges.length > 0 && !formData.challenge) {
            setFormData(prev => ({ ...prev, challenge: data.challenges[0].id }))
          }
        }
      } else {
        console.warn('Failed to load challenges, using fallback')
      }
    } catch (error) {
      console.error('Error loading challenges:', error)
    }
  }, [formData.challenge])

  const loadInterviews = useCallback(async () => {
    try {
      // Add cache busting to ensure fresh data
      const timestamp = new Date().getTime()
      const response = await fetch(`/api/interviews?t=${timestamp}`)
      if (response.ok) {
        const data = await response.json()
        console.log(
          '[DEBUG] Loaded current interviews from API:',
          data.interviews?.map((i: Interview) => ({
            id: i.id,
            status: i.status,
            candidateName: i.candidateName,
          }))
        )

        const newInterviews = data.interviews || []
        setInterviews(newInterviews)
      } else {
        console.error('Failed to load current interviews')
      }
    } catch (error) {
      console.error('Error loading current interviews:', error)
    } finally {
      // Set initial loading to false after first load
      if (initialLoading) {
        setInitialLoading(false)
      }
    }
  }, [initialLoading])

  const loadHistoricalInterviews = useCallback(async () => {
    if (historyLoadingRef.current) return // Prevent duplicate calls

    historyLoadingRef.current = true
    setHistoryLoading(true)
    try {
      const response = await fetch('/api/interviews/history?limit=50')
      if (response.ok) {
        const data = await response.json()
        console.log(
          '[DEBUG] Loaded historical interviews from API:',
          data.interviews?.length || 0,
          'interviews'
        )

        setHistoricalInterviews(data.interviews || [])
      } else {
        console.error('Failed to load historical interviews')
      }
    } catch (error) {
      console.error('Error loading historical interviews:', error)
    } finally {
      historyLoadingRef.current = false
      setHistoryLoading(false)
    }
  }, []) // Empty dependency array - function is stable

  // Step 1: Load both current interviews and history on initial page load
  useEffect(() => {
    console.log(
      '[DEBUG] Main page: Step 1 - Initial load, loading current interviews, history, and challenges'
    )
    loadInterviews()
    loadHistoricalInterviews()
    loadChallenges()
  }, [loadInterviews, loadHistoricalInterviews, loadChallenges])

  // 30-second polling for interview history updates
  useEffect(() => {
    const interval = setInterval(() => {
      console.log(
        '[DEBUG] Polling: Refreshing interview history (30s interval)'
      )
      loadHistoricalInterviews()
    }, 30000) // 30 seconds

    return () => clearInterval(interval)
  }, [loadHistoricalInterviews])

  // Listen for SSE events to update data immediately and refresh
  useEffect(() => {
    if (lastEvent) {
      console.log('Received SSE event:', lastEvent)

      // Handle operation updates immediately for better UX
      if (lastEvent.type === 'operation_update' && lastEvent.operation) {
        const operation: OperationData = lastEvent.operation
        console.log('Processing operation update:', operation)

        // Map operation status to interview status for immediate updates
        let interviewStatus: Interview['status'] = 'initializing'

        if (operation.status === 'scheduled') {
          interviewStatus = 'scheduled'
        } else if (operation.status === 'running') {
          if (operation.result?.infrastructureReady) {
            interviewStatus = 'configuring'
          } else {
            interviewStatus = 'initializing'
          }
        } else if (operation.status === 'completed') {
          if (operation.result?.success) {
            interviewStatus = operation.result?.healthCheckPassed
              ? 'active'
              : 'configuring'
          } else {
            interviewStatus = 'error'
          }
        } else if (operation.status === 'failed') {
          interviewStatus = 'error'
        }

        console.log('Immediately updating interview status and details:', {
          interviewId: operation.interviewId,
          status: interviewStatus,
          hasAccessUrl: !!operation.result?.accessUrl,
          hasPassword: !!operation.result?.password,
        })

        // Update interview state with latest operation data
        setInterviews(prev => {
          const updated = prev.map(interview => {
            if (interview.id === operation.interviewId) {
              return {
                ...interview,
                status: interviewStatus,
                // Only update access details if they're available
                ...(operation.result?.accessUrl && {
                  accessUrl: operation.result.accessUrl,
                  password: operation.result.password,
                }),
              }
            }
            return interview
          })

          // If interview doesn't exist in current state, add it
          const exists = prev.some(i => i.id === operation.interviewId)
          if (!exists && operation.candidateName && operation.challenge) {
            const newInterview: Interview = {
              id: operation.interviewId,
              candidateName: operation.candidateName,
              challenge: operation.challenge,
              status: interviewStatus,
              createdAt: operation.createdAt || new Date().toISOString(),
              scheduledAt: operation.scheduledAt,
              autoDestroyAt: operation.autoDestroyAt,
              saveFiles: true, // Default value
              // Only include access details if available
              ...(operation.result?.accessUrl && {
                accessUrl: operation.result.accessUrl,
                password: operation.result.password,
              }),
            }
            return [...updated, newInterview]
          }

          return updated
        })

        // Clear creating loading state if this is for the interview we're waiting for
        if (operation.interviewId === creatingInterviewId) {
          setCreatingInterviewId(null)
        }
      }

      // Refresh interviews from API for consistency (after immediate update)
      if (
        lastEvent.type === 'operation_update' ||
        lastEvent.type === 'scheduler_event'
      ) {
        console.log('Refreshing interviews from API due to SSE event')
        // Use setTimeout to allow immediate UI update first
        setTimeout(() => {
          loadInterviews()
        }, 100)
      }
    }
  }, [lastEvent, loadInterviews, creatingInterviewId])

  // NO AUTOMATIC POLLING for current interviews - SSE provides real-time updates
  // History interviews use 30-second polling for reasonable freshness

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
        saveFiles?: boolean
      } = {
        candidateName: formData.candidateName.trim(),
        challenge: formData.challenge,
        saveFiles: formData.saveFiles,
      }

      // Add scheduling if enabled
      if (formData.enableScheduling && formData.scheduledAt) {
        // Convert datetime-local to ISO string to preserve user's timezone
        const localDate = new Date(formData.scheduledAt)
        requestBody.scheduledAt = localDate.toISOString()
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

      const data = await response.json()

      // Close the modal immediately since operation is now background
      // Set the creating interview ID to show loading state
      setCreatingInterviewId(data.interviewId)

      // Reset form and close modal
      setFormData({
        candidateName: '',
        challenge: challenges.length > 0 ? challenges[0].id : '',
        scheduledAt: '',
        autoDestroyMinutes: 60,
        enableScheduling: false,
        saveFiles: true,
      })
      setShowCreateForm(false)

      // Show notification
      const message = formData.enableScheduling
        ? `Interview scheduled for ${formData.candidateName.trim()}`
        : `Interview creation started for ${formData.candidateName.trim()}`
      setNotification(message)
      setTimeout(() => setNotification(null), 5000) // Clear after 5 seconds
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

  const handleDownloadFiles = async (interviewId: string) => {
    try {
      const response = await fetch(`/api/interviews/${interviewId}/files`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to download files')
      }

      // Create download link
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url

      // Extract filename from response headers or use default
      const contentDisposition = response.headers.get('Content-Disposition')
      let filename = `interview-${interviewId}-files.tar.gz`

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/)
        if (filenameMatch) {
          filename = filenameMatch[1]
        }
      }

      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      setNotification('Files downloaded successfully')
      setTimeout(() => setNotification(null), 3000)
    } catch (error) {
      console.error('Error downloading files:', error)
      let errorMessage = 'Failed to download files'

      if (error instanceof Error) {
        // Use the API's error message if available
        errorMessage = error.message

        // Make some common errors more user-friendly
        if (error.message.includes('Files were not saved')) {
          errorMessage = '❌ Files were not saved for this interview'
        } else if (error.message.includes('not yet available')) {
          errorMessage =
            '⏳ Files are still being processed or extraction failed'
        } else if (error.message.includes('not found')) {
          errorMessage =
            '📁 Saved files not found - they may have been cleaned up'
        } else if (error.message.includes('Failed to download files')) {
          errorMessage =
            '🚫 Download failed - please try again or contact support'
        }
      }

      setNotification(`Download Error: ${errorMessage}`)
      setTimeout(() => setNotification(null), 7000) // Longer timeout for error messages
    }
  }

  const handleDeleteInterview = async (interviewId: string) => {
    const interview = historicalInterviews.find(i => i.id === interviewId)
    if (!interview) return

    const hasFiles = !!interview.historyS3Key
    const message = hasFiles
      ? `Are you sure you want to permanently delete this interview record and all history files for ${interview.candidateName}? This action cannot be undone.`
      : `Are you sure you want to permanently delete this interview record for ${interview.candidateName}? This action cannot be undone.`

    if (!confirm(message)) {
      return
    }

    try {
      const response = await fetch(`/api/interviews/${interviewId}/delete`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete interview')
      }

      const result = await response.json()

      // Show success notification
      const successMessage = result.deletedHistoryFiles
        ? 'Interview record and history files deleted successfully'
        : 'Interview record deleted successfully'

      setNotification(successMessage)
      setTimeout(() => setNotification(null), 5000)

      // Refresh the historical interviews list
      loadHistoricalInterviews()
    } catch (error) {
      console.error('Error deleting interview:', error)
      alert(
        `Failed to delete interview: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
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
      // Use the background destroy API with interview metadata
      await destroyInterview(id, interview?.candidateName, interview?.challenge)

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
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 w-full overflow-x-hidden">
      {/* Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 text-white px-6 py-3 rounded-xl shadow-lg z-50 fade-in ${
            notification.includes('❌') ||
            notification.includes('Download Error') ||
            notification.includes('Failed')
              ? 'bg-red-600'
              : 'bg-green-600'
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

      <div className="max-w-7xl mx-auto w-full">
        <header className="mb-8">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                Prequel Portal
              </h1>
              <p className="text-slate-600 mt-2">
                Manage coding interviews and VS Code instances
              </p>
            </div>
            <AuthStatus />
          </div>
        </header>

        <div className="mb-6 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-3 items-center">
            <button
              onClick={() => setShowCreateForm(true)}
              className="btn-primary"
            >
              Create New Interview
            </button>
            <a href="/challenges" className="btn-secondary">
              Manage Challenges
            </a>
            <div className="flex items-center space-x-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  sseConnected ? 'bg-green-500' : 'bg-red-500'
                }`}
              ></div>
              <span className="text-sm text-slate-600">
                {sseConnected ? 'Live updates' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="border-b border-slate-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('current')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeTab === 'current'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                Current Interviews
                {interviews.length > 0 && (
                  <span className="ml-2 bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded-full">
                    {interviews.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeTab === 'history'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                Interview History
                {historicalInterviews.length > 0 && (
                  <span className="ml-2 bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full">
                    {historicalInterviews.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('admin')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                  activeTab === 'admin'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                Admin
              </button>
            </nav>
          </div>
        </div>

        {showCreateForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="card p-4 sm:p-6 w-full max-w-md fade-in">
              <h2 className="text-xl font-semibold mb-4 text-slate-900">
                Create New Interview
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-1">
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
                    className="input-field"
                    placeholder="Enter candidate name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-900 mb-2">
                    Interview Challenge
                  </label>
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {challenges.length === 0 ? (
                      <div className="text-slate-500 text-sm p-3 border border-slate-200 rounded-lg">
                        No challenges available. Create challenges first.
                      </div>
                    ) : (
                      challenges.map(challenge => (
                        <div key={challenge.id}>
                          <label className="flex items-start space-x-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                            <input
                              type="radio"
                              name="challenge"
                              value={challenge.id}
                              checked={formData.challenge === challenge.id}
                              onChange={e =>
                                setFormData({
                                  ...formData,
                                  challenge: e.target.value,
                                })
                              }
                              className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <h4 className="text-sm font-medium text-slate-900">
                                  {challenge.name}
                                </h4>
                                <div className="flex items-center space-x-2 text-xs text-slate-500">
                                  <span>Used {challenge.usageCount} times</span>
                                </div>
                              </div>
                              <p className="text-sm text-slate-600 mt-1">
                                {challenge.description}
                              </p>
                              <div className="mt-2 text-xs text-slate-600">
                                {challenge.ecsConfig.cpuCores} CPU{' '}
                                {challenge.ecsConfig.cpuCores === 1
                                  ? 'core'
                                  : 'cores'}{' '}
                                / {challenge.ecsConfig.memory / 1024}GB RAM /{' '}
                                {challenge.ecsConfig.storage}GB Storage
                              </div>
                              <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                                <span>
                                  Created:{' '}
                                  {new Date(
                                    challenge.createdAt
                                  ).toLocaleDateString()}
                                </span>
                                <span>
                                  {challenge.lastUsedAt
                                    ? `Last used: ${new Date(
                                        challenge.lastUsedAt
                                      ).toLocaleDateString()}`
                                    : 'Never used'}
                                </span>
                              </div>
                            </div>
                          </label>
                        </div>
                      ))
                    )}
                  </div>
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
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label
                      htmlFor="enableScheduling"
                      className="text-sm font-medium text-slate-900"
                    >
                      Schedule for later
                    </label>
                  </div>

                  {formData.enableScheduling && (
                    <div>
                      <label className="block text-sm font-medium text-slate-900 mb-1">
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
                        className="input-field"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-slate-900 mb-1">
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
                      className="input-field"
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
                    <p className="text-xs text-slate-500 mt-1">
                      Required: Interview will auto-destroy after this duration
                      to prevent resource waste
                    </p>
                  </div>

                  {/* File Saving Options */}
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="saveFiles"
                      checked={formData.saveFiles}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          saveFiles: e.target.checked,
                        })
                      }
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <label
                      htmlFor="saveFiles"
                      className="text-sm font-medium text-slate-900"
                    >
                      Save candidate files to history
                    </label>
                  </div>
                  <p className="text-xs text-slate-500 -mt-2">
                    Recommended: Save candidate&apos;s work files before
                    destroying the interview
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCreateInterview}
                  disabled={
                    !formData.candidateName.trim() ||
                    !formData.challenge ||
                    loading ||
                    (formData.enableScheduling && !formData.scheduledAt)
                  }
                  className="flex-1 btn-primary"
                >
                  {loading
                    ? 'Creating...'
                    : formData.enableScheduling
                      ? 'Schedule Interview'
                      : 'Create Interview'}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 btn-outline"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Current Interviews Tab */}
        {activeTab === 'current' && (
          <div className="card overflow-hidden">
            {/* Show loading state when creating a new interview */}
            {creatingInterviewId && (
              <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-3"></div>
                  <span className="text-blue-700">
                    Creating interview... Waiting for it to appear in the list.
                  </span>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Candidate
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Challenge
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Schedule
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Access Details
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {initialLoading ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 sm:px-6 py-4 text-center text-slate-500"
                      >
                        <div className="flex items-center justify-center space-x-2">
                          <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                          <span>Loading current interviews...</span>
                        </div>
                      </td>
                    </tr>
                  ) : interviews.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 sm:px-6 py-4 text-center text-slate-500"
                      >
                        No current interviews
                      </td>
                    </tr>
                  ) : (
                    interviews.map(interview => (
                      <tr key={interview.id}>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-slate-900">
                            {interview.candidateName}
                          </div>
                          <div className="text-sm text-slate-500">
                            {new Date(interview.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {
                            challenges.find(c => c.id === interview.challenge)
                              ?.name
                          }
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div>
                            <span
                              className={`status-badge status-${interview.status}`}
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
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {interview.status === 'scheduled' &&
                          interview.scheduledAt ? (
                            <div className="space-y-2">
                              <div className="bg-purple-50 p-2 rounded-md border border-purple-200">
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
                                <div className="bg-red-50 p-2 rounded-md border border-red-200">
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
                                  <div className="text-xs text-slate-500">
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
                                <div className="bg-amber-50 p-1 rounded-md border border-amber-200">
                                  <div className="text-xs text-amber-700">
                                    Auto-destroy:
                                  </div>
                                  <div className="text-xs font-medium text-amber-900">
                                    {new Date(
                                      interview.autoDestroyAt
                                    ).toLocaleString()}
                                  </div>
                                </div>
                              )}
                              {!interview.scheduledAt &&
                                !interview.autoDestroyAt && (
                                  <span className="text-slate-400">
                                    Immediate
                                  </span>
                                )}
                            </div>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 text-sm text-slate-900">
                          {interview.status === 'active' &&
                          interview.accessUrl ? (
                            <div className="max-w-xs">
                              <a
                                className="text-blue-600 underline cursor-pointer break-all hover:text-blue-700 transition-colors"
                                href={interview.accessUrl}
                                target="_blank"
                              >
                                {interview.accessUrl}
                              </a>
                              <div className="text-slate-500 break-all">
                                Password: {interview.password}
                              </div>
                            </div>
                          ) : interview.status === 'configuring' ? (
                            <span className="text-slate-400">
                              Configuring...
                            </span>
                          ) : interview.status === 'scheduled' ? (
                            <span className="text-slate-400">Scheduled</span>
                          ) : interview.status === 'initializing' ? (
                            <span className="text-slate-400">
                              Initializing...
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              Not available
                            </span>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 text-sm font-medium">
                          <div className="flex flex-wrap gap-2 items-center">
                            {interview.status === 'active' && (
                              <button
                                onClick={() => stopInterview(interview.id)}
                                className="btn-danger text-sm"
                              >
                                Stop & Destroy
                              </button>
                            )}
                            {interview.status === 'scheduled' && (
                              <span className="text-purple-600 font-medium">
                                Scheduled...
                              </span>
                            )}
                            {interview.status === 'initializing' && (
                              <span className="text-blue-600 font-medium">
                                Initializing...
                              </span>
                            )}
                            {interview.status === 'configuring' && (
                              <span className="text-amber-600 font-medium">
                                Configuring...
                              </span>
                            )}
                            {interview.status === 'destroying' && (
                              <span className="text-orange-600 font-medium">
                                Destroying...
                              </span>
                            )}
                            {interview.status === 'error' && (
                              <button
                                onClick={() => stopInterview(interview.id)}
                                className="btn-danger text-sm px-3 py-1"
                              >
                                Retry Destroy
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSelectedInterviewForLogs(interview.id)
                                setShowLogsModal(true)
                              }}
                              className="btn-primary text-sm px-3 py-1"
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
        )}

        {/* Historical Interviews Tab */}
        {activeTab === 'history' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Candidate
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Challenge
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Completed
                    </th>
                    <th className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {historyLoading ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 sm:px-6 py-4 text-center text-slate-500"
                      >
                        <div className="flex items-center justify-center space-x-2">
                          <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                          <span>Loading interview history...</span>
                        </div>
                      </td>
                    </tr>
                  ) : historicalInterviews.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 sm:px-6 py-4 text-center text-slate-500"
                      >
                        No historical interviews found
                      </td>
                    </tr>
                  ) : (
                    historicalInterviews.map(interview => (
                      <tr key={interview.id}>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-slate-900">
                            {interview.candidateName}
                          </div>
                          <div className="text-sm text-slate-500">
                            {new Date(interview.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {challenges.find(c => c.id === interview.challenge)
                            ?.name || interview.challenge}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap">
                          <span
                            className={`status-badge ${
                              interview.status === 'destroyed'
                                ? 'bg-green-100 text-green-800'
                                : 'status-error'
                            }`}
                          >
                            {interview.status === 'destroyed'
                              ? 'completed'
                              : interview.status}
                          </span>
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {interview.createdAt && interview.destroyedAt ? (
                            <div>
                              {Math.round(
                                (new Date(interview.destroyedAt).getTime() -
                                  new Date(interview.createdAt).getTime()) /
                                  (1000 * 60)
                              )}{' '}
                              minutes
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                          {interview.destroyedAt ? (
                            <div>
                              <div className="font-medium">
                                {new Date(
                                  interview.destroyedAt
                                ).toLocaleDateString()}
                              </div>
                              <div className="text-slate-500">
                                {new Date(
                                  interview.destroyedAt
                                ).toLocaleTimeString()}
                              </div>
                            </div>
                          ) : interview.completedAt ? (
                            <div>
                              <div className="font-medium">
                                {new Date(
                                  interview.completedAt
                                ).toLocaleDateString()}
                              </div>
                              <div className="text-slate-500">
                                {new Date(
                                  interview.completedAt
                                ).toLocaleTimeString()}
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="px-3 sm:px-6 py-4 text-sm font-medium">
                          <div className="flex flex-wrap gap-2 items-center">
                            {interview.saveFiles ? (
                              <button
                                onClick={() =>
                                  handleDownloadFiles(interview.id)
                                }
                                className="btn-secondary text-sm px-3 py-1"
                                title="Download saved interview files"
                              >
                                Download Files
                              </button>
                            ) : (
                              <span className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded border">
                                History not saved
                              </span>
                            )}
                            <button
                              onClick={() => {
                                setSelectedInterviewForLogs(interview.id)
                                setShowLogsModal(true)
                              }}
                              className="btn-primary text-sm px-3 py-1"
                            >
                              Logs
                            </button>
                            <button
                              onClick={() =>
                                handleDeleteInterview(interview.id)
                              }
                              className="btn-danger text-sm px-3 py-1"
                              title="Permanently delete this interview record and history files"
                            >
                              Delete
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
        )}

        {/* Admin Tab */}
        {activeTab === 'admin' && (
          <div className="card overflow-hidden">
            <CleanupDashboard />
          </div>
        )}

        {/* Logs Modal */}
        {showLogsModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="card p-4 sm:p-6 w-full max-w-6xl h-5/6 max-h-screen overflow-hidden fade-in">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-slate-900">
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
                  className="text-slate-500 hover:text-slate-700 cursor-pointer transition-colors"
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
                  className="btn-outline"
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
