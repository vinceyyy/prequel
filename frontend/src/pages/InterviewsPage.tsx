import { useState, useEffect, useCallback, useRef } from 'react'
import ActiveInterviewsTable from '@/components/interviews/ActiveInterviewsTable'
import CreateInterviewForm from '@/components/interviews/CreateInterviewForm'
import InterviewHistoryTable from '@/components/interviews/InterviewHistoryTable'
import LogsModal from '@/components/interviews/LogsModal'
import { type Challenge, type Interview } from '@/components/interviews/types'
import { useOperations } from '@/hooks/useOperations'
import { useInterviewPolling, useOperationPolling, type OperationData } from '@/hooks/usePolling'

export default function InterviewsPage() {
  const [historicalInterviews, setHistoricalInterviews] = useState<Interview[]>([])
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const historyLoadingRef = useRef(false)
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [selectedInterviewForLogs, setSelectedInterviewForLogs] = useState<string | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    candidateName: '',
    challenge: '', // Will be set to first available challenge
    scheduledAt: '',
    autoDestroyMinutes: 60,
    enableScheduling: false,
    saveFiles: true, // Default to true as requested
  })

  // Use the operations hook for background operations (destroy only)
  const { destroyInterview } = useOperations()

  // Poll interviews directly - server handles operation status merging
  const {
    interviews,
    hasInProgressInterviews,
    lastUpdated,
    isLoading: initialLoading,
  } = useInterviewPolling()

  // Operation polling is only used for toast notifications
  const { lastOperation } = useOperationPolling({
    filterPrefix: 'INTERVIEW#',
  })

  const [challenges, setChallenges] = useState<Challenge[]>([])

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
            setFormData((prev) => ({ ...prev, challenge: data.challenges[0].id }))
          }
        }
      } else {
        console.warn('Failed to load challenges, using fallback')
      }
    } catch (error) {
      console.error('Error loading challenges:', error)
    }
  }, [formData.challenge])

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
          'interviews',
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

  // Load history and challenges on initial page load
  // (interviews are loaded by useInterviewPolling hook)
  useEffect(() => {
    console.log('[DEBUG] Interviews page: Loading history and challenges')
    loadHistoricalInterviews()
    loadChallenges()
  }, [loadHistoricalInterviews, loadChallenges])

  // 30-second polling for interview history updates
  useEffect(() => {
    const interval = setInterval(() => {
      loadHistoricalInterviews()
    }, 30000)

    return () => clearInterval(interval)
  }, [loadHistoricalInterviews])

  // Track operation completions for toast notifications only
  // Interview list updates are handled by useInterviewPolling
  const previousOperationRef = useRef<OperationData | null>(null)
  useEffect(() => {
    if (!lastOperation) return

    const operation = lastOperation
    const prevOperation = previousOperationRef.current

    // Only show toast for status transitions we haven't seen
    if (prevOperation?.id === operation.id && prevOperation?.status === operation.status) {
      return
    }
    previousOperationRef.current = operation

    // Show toast for completed operations
    if (operation.status === 'completed' && operation.type === 'create') {
      if (operation.result?.success) {
        setNotification(`Interview ready for ${operation.candidateName || 'candidate'}`)
        setTimeout(() => setNotification(null), 5000)
      } else {
        setNotification(`Interview creation failed for ${operation.candidateName || 'candidate'}`)
        setTimeout(() => setNotification(null), 5000)
      }
    } else if (operation.status === 'completed' && operation.type === 'destroy') {
      if (operation.result?.success) {
        setNotification(`Interview destroyed for ${operation.candidateName || 'candidate'}`)
        setTimeout(() => setNotification(null), 5000)
        // Refresh history after successful destroy
        loadHistoricalInterviews()
      }
    } else if (operation.status === 'failed') {
      setNotification(
        `Operation failed for ${operation.candidateName || 'candidate'}: ${operation.result?.error || 'Unknown error'}`,
      )
      setTimeout(() => setNotification(null), 7000)
    }
  }, [lastOperation, loadHistoricalInterviews])

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
          errorMessage = 'Files were not saved for this interview'
        } else if (error.message.includes('not yet available')) {
          errorMessage = 'Files are still being processed or extraction failed'
        } else if (error.message.includes('not found')) {
          errorMessage = 'Saved files not found - they may have been cleaned up'
        } else if (error.message.includes('Failed to download files')) {
          errorMessage = 'Download failed - please try again or contact support'
        }
      }

      setNotification(`Download Error: ${errorMessage}`)
      setTimeout(() => setNotification(null), 7000) // Longer timeout for error messages
    }
  }

  const handleDeleteInterview = async (interviewId: string) => {
    const interview = historicalInterviews.find((i) => i.id === interviewId)
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
        `Failed to delete interview: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  const cancelScheduledInterview = async (interview: Interview) => {
    if (!interview.operationId) {
      setNotification('Cannot cancel: operation ID not found')
      setTimeout(() => setNotification(null), 5000)
      return
    }

    const message = `Are you sure you want to cancel the scheduled interview for ${interview.candidateName}? This action cannot be undone.`

    if (!confirm(message)) {
      return
    }

    try {
      const response = await fetch(`/api/operations/${interview.operationId}/cancel`, {
        method: 'POST',
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to cancel interview')
      }

      // Show notification
      setNotification(`Interview cancelled for ${interview.candidateName}`)
      setTimeout(() => setNotification(null), 5000)

      // Interview will be removed automatically via polling
    } catch (error) {
      console.error('Error cancelling interview:', error)
      setNotification(
        `Failed to cancel interview: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
      setTimeout(() => setNotification(null), 5000)
    }
  }

  const stopInterview = async (id: string) => {
    const interview = interviews.find((i) => i.id === id)
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
      setNotification('Failed to start destroy operation. Please try again.')
      setTimeout(() => setNotification(null), 5000)
    }
  }

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

      await response.json()

      // Interview will appear automatically via polling - no need to manually add

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
        }`,
      )
    } finally {
      setLoading(false)
    }
  }

  const showLogs = (id: string) => {
    setSelectedInterviewForLogs(id)
    setShowLogsModal(true)
  }

  const closeLogs = () => {
    setShowLogsModal(false)
    setSelectedInterviewForLogs(null)
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8 w-full overflow-x-hidden">
      {/* Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 text-white px-6 py-3 rounded-xl shadow-lg z-50 fade-in ${
            notification.includes('Failed') ||
            notification.includes('Download Error') ||
            notification.includes('Cannot')
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
              <h1 className="text-3xl font-bold text-slate-900">Interviews</h1>
              <p className="text-slate-600 mt-2">
                View and manage active and historical interviews
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  hasInProgressInterviews ? 'bg-blue-500 animate-pulse' : 'bg-green-500'
                }`}
              ></div>
              <span className="text-sm text-slate-600">
                {hasInProgressInterviews ? 'Active' : 'Idle'}
                {lastUpdated && (
                  <span className="ml-2 text-slate-400">
                    Updated {lastUpdated.toLocaleTimeString()}
                  </span>
                )}
              </span>
            </div>
          </div>
        </header>

        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <button onClick={() => setShowCreateForm(true)} className="btn-primary">
            Create New Interview
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="border-b border-slate-200">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('active')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap cursor-pointer ${
                  activeTab === 'active'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                Active Interviews
                {interviews.length > 0 && (
                  <span className="ml-2 bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded-full">
                    {interviews.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap cursor-pointer ${
                  activeTab === 'history'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                History
                {historicalInterviews.length > 0 && (
                  <span className="ml-2 bg-slate-100 text-slate-600 text-xs px-2 py-1 rounded-full">
                    {historicalInterviews.length}
                  </span>
                )}
              </button>
            </nav>
          </div>
        </div>

        {showCreateForm && (
          <CreateInterviewForm
            formData={formData}
            setFormData={setFormData}
            challenges={challenges}
            loading={loading}
            onSubmit={handleCreateInterview}
            onCancel={() => setShowCreateForm(false)}
          />
        )}

        {/* Active Interviews Tab */}
        {activeTab === 'active' && (
          <ActiveInterviewsTable
            interviews={interviews}
            challenges={challenges}
            initialLoading={initialLoading}
            onStop={stopInterview}
            onCancel={cancelScheduledInterview}
            onShowLogs={showLogs}
          />
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <InterviewHistoryTable
            historicalInterviews={historicalInterviews}
            challenges={challenges}
            historyLoading={historyLoading}
            onDownload={handleDownloadFiles}
            onDelete={handleDeleteInterview}
            onShowLogs={showLogs}
          />
        )}

        {/* Logs Modal */}
        {showLogsModal && (
          <LogsModal selectedInterviewForLogs={selectedInterviewForLogs} onClose={closeLogs} />
        )}
      </div>
    </div>
  )
}
