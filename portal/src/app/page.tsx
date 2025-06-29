'use client'

import { useState, useEffect } from 'react'
import OperationDashboard from '@/components/OperationDashboard'
import { useOperations } from '@/hooks/useOperations'

interface Interview {
  id: string
  candidateName: string
  status: 'creating' | 'active' | 'destroying' | 'destroyed' | 'error'
  scenario: string
  accessUrl?: string
  password?: string
  createdAt: string
}

export default function Home() {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [selectedInterviewForLogs, setSelectedInterviewForLogs] = useState<
    string | null
  >(null)
  const [formData, setFormData] = useState({
    candidateName: '',
    scenario: 'javascript',
  })

  // Use the operations hook for background operations
  const { createInterview, destroyInterview } = useOperations()

  const scenarios = [
    { id: 'javascript', name: 'JavaScript/React' },
    { id: 'python', name: 'Python/Data Science' },
    { id: 'sql', name: 'SQL/Database' },
    { id: 'fullstack', name: 'Full Stack' },
  ]

  useEffect(() => {
    loadInterviews()

    // Poll for interview updates every 3 seconds
    const interval = setInterval(loadInterviews, 3000)

    return () => clearInterval(interval)
  }, [])

  const loadInterviews = async () => {
    try {
      const response = await fetch('/api/interviews')
      if (response.ok) {
        const data = await response.json()
        setInterviews(data.interviews || [])
      } else {
        console.error('Failed to load interviews')
      }
    } catch (error) {
      console.error('Error loading interviews:', error)
    }
  }

  const handleCreateInterview = async () => {
    if (!formData.candidateName.trim()) return

    setLoading(true)
    try {
      // Use the background create API
      await createInterview(formData.candidateName.trim(), formData.scenario)

      // Refresh interviews list immediately to show the new interview
      await loadInterviews()

      setFormData({ candidateName: '', scenario: 'javascript' })
      setShowCreateForm(false)
    } catch (error) {
      console.error('Error creating interview:', error)
    } finally {
      setLoading(false)
    }
  }

  const stopInterview = async (id: string) => {
    if (
      !confirm(
        'Are you sure you want to stop and destroy this interview? This action cannot be undone.'
      )
    ) {
      return
    }

    try {
      // Use the background destroy API
      await destroyInterview(id)

      // Refresh interviews list to show the latest state
      await loadInterviews()
    } catch (error) {
      console.error('Error destroying interview:', error)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Prequel Portal</h1>
          <p className="text-gray-600 mt-2">
            Manage coding interviews and VS Code instances
          </p>
        </header>

        <div className="mb-6">
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create New Interview
          </button>
        </div>

        {showCreateForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
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
                    Interview Scenario
                  </label>
                  <select
                    value={formData.scenario}
                    onChange={e =>
                      setFormData({ ...formData, scenario: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                  >
                    {scenarios.map(scenario => (
                      <option key={scenario.id} value={scenario.id}>
                        {scenario.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCreateInterview}
                  disabled={!formData.candidateName.trim() || loading}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
                >
                  {loading ? 'Creating...' : 'Create Interview'}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="flex-1 bg-gray-200 text-gray-900 py-2 rounded-md hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Candidate
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Scenario
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Access Details
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {interviews.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-6 py-4 text-center text-gray-500"
                  >
                    No interviews created yet
                  </td>
                </tr>
              ) : (
                interviews.map(interview => (
                  <tr key={interview.id}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {interview.candidateName}
                      </div>
                      <div className="text-sm text-gray-500">
                        {new Date(interview.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {scenarios.find(s => s.id === interview.scenario)?.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          interview.status === 'active'
                            ? 'bg-green-100 text-green-800'
                            : interview.status === 'creating'
                              ? 'bg-blue-100 text-blue-800'
                              : interview.status === 'destroying'
                                ? 'bg-orange-100 text-orange-800'
                                : interview.status === 'error'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {interview.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {interview.accessUrl ? (
                        <div>
                          <div className="text-blue-600 underline cursor-pointer">
                            {interview.accessUrl}
                          </div>
                          <div className="text-gray-500">
                            Password: {interview.password}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400">Not started</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex gap-2">
                        {interview.status === 'active' && (
                          <button
                            onClick={() => stopInterview(interview.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Stop & Destroy
                          </button>
                        )}
                        {interview.status === 'creating' && (
                          <span className="text-blue-600">Creating...</span>
                        )}
                        {interview.status === 'destroying' && (
                          <span className="text-orange-600">Destroying...</span>
                        )}
                        {interview.status === 'error' && (
                          <button
                            onClick={() => stopInterview(interview.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Clean Up
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setSelectedInterviewForLogs(interview.id)
                            setShowLogsModal(true)
                          }}
                          className="text-blue-600 hover:text-blue-900"
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

        {/* Logs Modal */}
        {showLogsModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-6xl h-5/6">
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
                  className="text-gray-500 hover:text-gray-700"
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
                  className="bg-gray-200 text-gray-900 px-4 py-2 rounded-md hover:bg-gray-300 transition-colors"
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
