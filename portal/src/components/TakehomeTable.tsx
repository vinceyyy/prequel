'use client'

import React, { useState } from 'react'

interface Takehome {
  passcode: string
  candidateName: string
  challenge: string
  customInstructions: string
  status: string
  validUntil: string
  createdAt: string
  activatedAt?: string
  durationMinutes: number
  url: string
  interviewId?: string
  accessUrl?: string
  password?: string
  autoDestroyAt?: string
}

interface Challenge {
  id: string
  name: string
}

interface TakehomeTableProps {
  takehomes: Takehome[]
  challenges: Challenge[]
  onRevoke: (passcode: string) => void
  onViewLogs?: (interviewId: string) => void
}

export function TakehomeTable({
  takehomes,
  challenges,
  onRevoke,
  onViewLogs,
}: TakehomeTableProps) {
  const [copiedPasscode, setCopiedPasscode] = useState<string | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [revokingPasscode, setRevokingPasscode] = useState<string | null>(null)

  const copyToClipboard = async (text: string, passcode: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedPasscode(passcode)
      setTimeout(() => setCopiedPasscode(null), 2000)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
      // Optionally show error feedback to user
    }
  }

  const handleRevoke = async (passcode: string) => {
    setRevokingPasscode(passcode)
    try {
      await onRevoke(passcode)
    } finally {
      setRevokingPasscode(null)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">
            Active
          </span>
        )
      case 'activated':
      case 'initializing':
      case 'configuring':
        return (
          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">
            Provisioning
          </span>
        )
      case 'completed':
        return (
          <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold">
            Completed
          </span>
        )
      case 'revoked':
        return (
          <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold">
            Revoked
          </span>
        )
      case 'destroying':
        return (
          <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded text-xs font-semibold">
            Destroying
          </span>
        )
      case 'error':
        return (
          <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-semibold">
            Error
          </span>
        )
      default:
        return (
          <span className="px-2 py-1 bg-slate-100 text-slate-700 rounded text-xs font-semibold">
            {status}
          </span>
        )
    }
  }

  if (takehomes.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        No take-home tests created yet
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="bg-slate-100 border-b border-slate-200">
          <tr>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              Candidate
            </th>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              Challenge
            </th>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              URL
            </th>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              Status
            </th>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              Valid Until
            </th>
            <th className="text-left py-3 px-4 font-semibold text-slate-700">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {takehomes.map(takehome => {
            const validUntil = new Date(takehome.validUntil)
            const isExpired = new Date() > validUntil
            const isExpanded = expandedRow === takehome.passcode

            return (
              <React.Fragment key={takehome.passcode}>
                <tr className="border-b border-slate-200 hover:bg-slate-50">
                  <td className="py-3 px-4 font-medium text-slate-800">
                    {takehome.candidateName}
                  </td>
                  <td className="py-3 px-4 text-slate-700">
                    {challenges.find(c => c.id === takehome.challenge)?.name ||
                      takehome.challenge}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <a
                        href={takehome.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 text-sm break-all underline"
                      >
                        {takehome.url}
                      </a>
                      <button
                        onClick={() =>
                          copyToClipboard(takehome.url, takehome.passcode)
                        }
                        className="text-sm px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded flex-shrink-0"
                        title="Copy URL"
                      >
                        {copiedPasscode === takehome.passcode ? '✓' : '📋'}
                      </button>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {getStatusBadge(takehome.status)}

                    {/* Show access details when workspace is ready */}
                    {takehome.accessUrl && takehome.password && (
                      <div className="mt-2 text-xs bg-green-50 border border-green-200 rounded p-2">
                        <div className="font-medium text-green-900 mb-1">
                          Workspace Ready:
                        </div>
                        <div className="text-green-800 break-all">
                          <span className="font-semibold">URL:</span>{' '}
                          {takehome.accessUrl}
                        </div>
                        <div className="text-green-800">
                          <span className="font-semibold">Password:</span>{' '}
                          {takehome.password}
                        </div>
                        {takehome.autoDestroyAt && (
                          <div className="text-green-700 mt-1">
                            Expires:{' '}
                            {new Date(takehome.autoDestroyAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Show progress during provisioning */}
                    {(takehome.status === 'initializing' ||
                      takehome.status === 'configuring') && (
                      <div className="mt-2 text-xs text-blue-600">
                        <div className="inline-block animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-2"></div>
                        Provisioning...
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-sm text-slate-600">
                    {isExpired ? (
                      <span className="text-red-600">Expired</span>
                    ) : (
                      validUntil.toLocaleString()
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex gap-2">
                      {takehome.interviewId && onViewLogs && (
                        <button
                          onClick={() => onViewLogs(takehome.interviewId!)}
                          className="text-sm px-3 py-1 bg-slate-600 hover:bg-slate-700 text-white rounded"
                          title="View operation logs"
                        >
                          Logs
                        </button>
                      )}
                      {takehome.status === 'active' && (
                        <button
                          onClick={() => handleRevoke(takehome.passcode)}
                          disabled={revokingPasscode === takehome.passcode}
                          className={`text-sm px-3 py-1 rounded ${
                            revokingPasscode === takehome.passcode
                              ? 'bg-slate-400 cursor-not-allowed'
                              : 'bg-red-600 hover:bg-red-700'
                          } text-white`}
                        >
                          {revokingPasscode === takehome.passcode
                            ? 'Revoking...'
                            : 'Revoke'}
                        </button>
                      )}
                      <button
                        onClick={() =>
                          setExpandedRow(isExpanded ? null : takehome.passcode)
                        }
                        className="text-sm px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded"
                      >
                        {isExpanded ? 'Hide' : 'Details'}
                      </button>
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="bg-slate-50">
                    <td colSpan={6} className="py-4 px-6">
                      <div className="space-y-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-700 mb-1">
                            Passcode:
                          </div>
                          <div className="text-sm text-slate-900">
                            <code className="bg-slate-100 px-2 py-1 rounded font-mono">
                              {takehome.passcode}
                            </code>
                          </div>
                        </div>
                        {takehome.customInstructions && (
                          <div>
                            <div className="text-sm font-semibold text-slate-700 mb-1">
                              Custom Instructions:
                            </div>
                            <div className="text-sm text-slate-600 whitespace-pre-wrap">
                              {takehome.customInstructions}
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-sm font-semibold text-slate-700">
                              Duration:
                            </div>
                            <div className="text-sm text-slate-600">
                              {takehome.durationMinutes} minutes
                            </div>
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-700">
                              Created:
                            </div>
                            <div className="text-sm text-slate-600">
                              {new Date(takehome.createdAt).toLocaleString()}
                            </div>
                          </div>
                          {takehome.activatedAt && (
                            <div>
                              <div className="text-sm font-semibold text-slate-700">
                                Activated:
                              </div>
                              <div className="text-sm text-slate-600">
                                {new Date(
                                  takehome.activatedAt
                                ).toLocaleString()}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
