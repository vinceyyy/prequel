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
}

interface TakehomeTableProps {
  takehomes: Takehome[]
  onRevoke: (passcode: string) => void
}

export function TakehomeTable({ takehomes, onRevoke }: TakehomeTableProps) {
  const [copiedPasscode, setCopiedPasscode] = useState<string | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

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

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">
            Active
          </span>
        )
      case 'activated':
        return (
          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">
            In Progress
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
              Passcode
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
                    {takehome.challenge}
                  </td>
                  <td className="py-3 px-4">
                    <code className="bg-slate-100 px-2 py-1 rounded text-sm font-mono">
                      {takehome.passcode}
                    </code>
                  </td>
                  <td className="py-3 px-4">
                    {getStatusBadge(takehome.status)}
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
                      <button
                        onClick={() =>
                          copyToClipboard(takehome.url, takehome.passcode)
                        }
                        className="text-sm px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded"
                      >
                        {copiedPasscode === takehome.passcode
                          ? 'Copied'
                          : 'Copy URL'}
                      </button>
                      {takehome.status === 'active' && (
                        <button
                          onClick={() => onRevoke(takehome.passcode)}
                          className="text-sm px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded"
                        >
                          Revoke
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
                            URL:
                          </div>
                          <div className="text-sm text-blue-600 font-mono break-all">
                            {takehome.url}
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
