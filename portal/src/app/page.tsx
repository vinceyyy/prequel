'use client'

import { useState, useEffect, useRef } from 'react'

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
  const [streamingOutput, setStreamingOutput] = useState('')
  const [showOutput, setShowOutput] = useState(false)
  const [outputTitle, setOutputTitle] = useState('Terraform Output')
  const [formData, setFormData] = useState({
    candidateName: '',
    scenario: 'javascript',
  })
  const terminalRef = useRef<HTMLDivElement>(null)

  const scenarios = [
    { id: 'javascript', name: 'JavaScript/React' },
    { id: 'python', name: 'Python/Data Science' },
    { id: 'sql', name: 'SQL/Database' },
    { id: 'fullstack', name: 'Full Stack' },
  ]

  useEffect(() => {
    loadInterviews()
  }, [])

  // Auto-scroll terminal to bottom when new output arrives
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [streamingOutput])

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
    setStreamingOutput('')
    setOutputTitle('Creating Interview - Terraform Output')
    setShowOutput(true)

    try {
      const response = await fetch('/api/interviews/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          candidateName: formData.candidateName.trim(),
          scenario: formData.scenario,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let currentInterview: Interview | null = null

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))

                if (data.type === 'metadata') {
                  // Create initial interview entry
                  currentInterview = {
                    id: data.interviewId,
                    candidateName: data.candidateName,
                    scenario: data.scenario,
                    status: 'creating',
                    password: data.password,
                    createdAt: new Date().toISOString(),
                  }
                  setInterviews(prev => [...prev, currentInterview!])
                  setStreamingOutput(
                    prev =>
                      prev +
                      `Starting interview creation for ${data.candidateName}...\n`
                  )
                } else if (data.type === 'output') {
                  setStreamingOutput(prev => prev + data.data)
                } else if (data.type === 'complete') {
                  if (currentInterview && data.success) {
                    setInterviews(prev =>
                      prev.map(interview =>
                        interview.id === currentInterview?.id
                          ? {
                              ...interview,
                              status: 'active',
                              accessUrl: data.accessUrl,
                            }
                          : interview
                      )
                    )
                    setStreamingOutput(
                      prev =>
                        prev +
                        `\n✅ Interview created successfully!\nAccess URL: ${data.accessUrl}\n`
                    )
                  } else {
                    if (currentInterview) {
                      setInterviews(prev =>
                        prev.map(interview =>
                          interview.id === currentInterview?.id
                            ? { ...interview, status: 'error' }
                            : interview
                        )
                      )
                    }
                    setStreamingOutput(
                      prev =>
                        prev +
                        `\n❌ Failed to create interview: ${data.error}\n`
                    )
                  }
                } else if (data.type === 'error') {
                  if (currentInterview) {
                    setInterviews(prev =>
                      prev.map(interview =>
                        interview.id === currentInterview?.id
                          ? { ...interview, status: 'error' }
                          : interview
                      )
                    )
                  }
                  setStreamingOutput(
                    prev => prev + `\n❌ Error: ${data.error}\n`
                  )
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e)
              }
            }
          }
        }
      }

      setFormData({ candidateName: '', scenario: 'javascript' })
      setShowCreateForm(false)
    } catch (error) {
      setStreamingOutput(
        prev => prev + `\n❌ Error creating interview: ${error}\n`
      )
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

    setInterviews(
      interviews.map(interview =>
        interview.id === id ? { ...interview, status: 'destroying' } : interview
      )
    )

    // Show streaming output for destroy
    setStreamingOutput('')
    setOutputTitle('Destroying Interview - Terraform Output')
    setShowOutput(true)

    try {
      const response = await fetch(`/api/interviews/${id}/destroy`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))

                if (data.type === 'metadata') {
                  setStreamingOutput(
                    prev =>
                      prev +
                      `Starting destroy for interview ${data.interviewId}...\n`
                  )
                } else if (data.type === 'output') {
                  setStreamingOutput(prev => prev + data.data)
                } else if (data.type === 'complete') {
                  if (data.success) {
                    setStreamingOutput(
                      prev => prev + '\n✅ Interview destroyed successfully!\n'
                    )
                    setInterviews(
                      interviews.filter(interview => interview.id !== id)
                    )
                  } else {
                    setStreamingOutput(
                      prev =>
                        prev +
                        `\n❌ Failed to destroy interview: ${data.error}\n`
                    )
                    setInterviews(
                      interviews.map(interview =>
                        interview.id === id
                          ? { ...interview, status: 'error' }
                          : interview
                      )
                    )
                  }
                } else if (data.type === 'error') {
                  setStreamingOutput(
                    prev => prev + `\n❌ Error: ${data.error}\n`
                  )
                  setInterviews(
                    interviews.map(interview =>
                      interview.id === id
                        ? { ...interview, status: 'error' }
                        : interview
                    )
                  )
                }
              } catch (e) {
                console.error('Failed to parse SSE data:', e)
              }
            }
          }
        }
      }
    } catch (error) {
      setStreamingOutput(
        prev => prev + `\n❌ Error destroying interview: ${error}\n`
      )
      setInterviews(
        interviews.map(interview =>
          interview.id === id ? { ...interview, status: 'error' } : interview
        )
      )
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

        {showOutput && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-4xl h-3/4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  {outputTitle}
                </h2>
                <button
                  onClick={() => setShowOutput(false)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ✕
                </button>
              </div>

              <div
                ref={terminalRef}
                className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm h-full overflow-y-auto whitespace-pre-wrap"
              >
                {streamingOutput || 'Waiting for output...'}
              </div>

              <div className="flex justify-end mt-4">
                <button
                  onClick={() => setShowOutput(false)}
                  className="bg-gray-200 text-gray-900 px-4 py-2 rounded-md hover:bg-gray-300 transition-colors"
                >
                  Close
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
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
