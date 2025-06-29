'use client'

import { useState, useEffect, useRef } from 'react'

interface Operation {
  id: string
  type: 'create' | 'destroy'
  status: 'pending' | 'running' | 'completed' | 'failed'
  interviewId: string
  candidateName?: string
  scenario?: string
  startedAt: string
  completedAt?: string
  logs: string[]
  result?: {
    success: boolean
    accessUrl?: string
    error?: string
    fullOutput?: string
  }
}

interface OperationDashboardProps {
  interviewId?: string // If provided, only show operations for this interview
  className?: string
}

export default function OperationDashboard({
  interviewId,
  className = '',
}: OperationDashboardProps) {
  const [operations, setOperations] = useState<Operation[]>([])
  const [selectedOperation, setSelectedOperation] = useState<string | null>(
    null
  )
  const [logs, setLogs] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const terminalRef = useRef<HTMLDivElement>(null)
  const pollInterval = useRef<NodeJS.Timeout>()

  useEffect(() => {
    loadOperations()

    // Poll for updates every 2 seconds
    pollInterval.current = setInterval(loadOperations, 2000)

    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current)
      }
    }
  }, [interviewId])

  useEffect(() => {
    if (selectedOperation) {
      loadOperationLogs(selectedOperation)
    }
  }, [selectedOperation])

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [logs])

  const loadOperations = async () => {
    try {
      const url = interviewId
        ? `/api/operations?interviewId=${interviewId}`
        : '/api/operations'
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setOperations(data.operations || [])
      }
    } catch (error) {
      console.error('Failed to load operations:', error)
    }
  }

  const loadOperationLogs = async (operationId: string) => {
    try {
      setLoading(true)
      const response = await fetch(`/api/operations/${operationId}/logs`)
      if (response.ok) {
        const data = await response.json()
        setLogs(data.logs || [])
      }
    } catch (error) {
      console.error('Failed to load operation logs:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusIcon = (status: Operation['status']) => {
    switch (status) {
      case 'pending':
        return '⏳'
      case 'running':
        return '🔄'
      case 'completed':
        return '✅'
      case 'failed':
        return '❌'
      default:
        return '❓'
    }
  }

  const getStatusColor = (status: Operation['status']) => {
    switch (status) {
      case 'pending':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'running':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'completed':
        return 'text-green-600 bg-green-50 border-green-200'
      case 'failed':
        return 'text-red-600 bg-red-50 border-red-200'
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  const getDuration = (startedAt: string, completedAt?: string) => {
    const start = new Date(startedAt)
    const end = completedAt ? new Date(completedAt) : new Date()
    const duration = Math.floor((end.getTime() - start.getTime()) / 1000)

    if (duration < 60) return `${duration}s`
    if (duration < 3600)
      return `${Math.floor(duration / 60)}m ${duration % 60}s`
    return `${Math.floor(duration / 3600)}h ${Math.floor(
      (duration % 3600) / 60
    )}m`
  }

  return (
    <div className={`bg-white rounded-lg shadow-md ${className}`}>
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">
          {interviewId
            ? `Operations for Interview ${interviewId}`
            : 'All Operations'}
        </h2>
      </div>

      <div className="flex h-96">
        {/* Operations List */}
        <div className="w-1/2 border-r border-gray-200 overflow-y-auto">
          {operations.length === 0 ? (
            <div className="p-4 text-gray-500 text-center">
              No operations found
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {operations.map(operation => (
                <div
                  key={operation.id}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedOperation === operation.id
                      ? 'bg-blue-50 border-l-4 border-blue-500'
                      : ''
                  }`}
                  onClick={() => setSelectedOperation(operation.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">
                        {getStatusIcon(operation.status)}
                      </span>
                      <span className="font-medium text-gray-900">
                        {operation.type === 'create' ? 'Create' : 'Destroy'}{' '}
                        Interview
                      </span>
                    </div>
                    <span
                      className={`px-2 py-1 text-xs rounded-full border ${getStatusColor(
                        operation.status
                      )}`}
                    >
                      {operation.status}
                    </span>
                  </div>

                  <div className="text-sm text-gray-600 space-y-1">
                    <div>Interview ID: {operation.interviewId}</div>
                    {operation.candidateName && (
                      <div>Candidate: {operation.candidateName}</div>
                    )}
                    {operation.scenario && (
                      <div>Scenario: {operation.scenario}</div>
                    )}
                    <div>Started: {formatTime(operation.startedAt)}</div>
                    <div>
                      Duration:{' '}
                      {getDuration(operation.startedAt, operation.completedAt)}
                    </div>
                  </div>

                  {operation.result?.accessUrl && (
                    <div className="mt-2">
                      <a
                        href={operation.result.accessUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm"
                        onClick={e => e.stopPropagation()}
                      >
                        🔗 Access Interview
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Logs Panel */}
        <div className="w-1/2 flex flex-col">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h3 className="font-medium text-gray-900">
              {selectedOperation
                ? 'Operation Logs'
                : 'Select an operation to view logs'}
            </h3>
          </div>

          <div className="flex-1 p-4">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-gray-500">Loading logs...</div>
              </div>
            ) : selectedOperation ? (
              <div
                ref={terminalRef}
                className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm h-full overflow-y-auto whitespace-pre-wrap"
              >
                {logs.length > 0 ? logs.join('\n') : 'No logs available yet...'}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                Select an operation to view its logs
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
