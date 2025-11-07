'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface TakehomeData {
  passcode: string
  candidateName: string
  challenge: string
  customInstructions: string
  status: string
  validUntil: string
  durationMinutes: number
}

export default function TakeHomePage({
  params,
}: {
  params: Promise<{ passcode: string }>
}) {
  const { passcode } = use(params)
  const router = useRouter()
  const [takehome, setTakehome] = useState<TakehomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activating, setActivating] = useState(false)

  useEffect(() => {
    const fetchTakehome = async () => {
      try {
        const response = await fetch(`/api/takehome/${passcode}`)
        if (response.ok) {
          const data = await response.json()
          setTakehome(data)
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

    fetchTakehome()
  }, [passcode])

  const handleStart = async () => {
    if (!takehome) return

    setActivating(true)
    setError(null)

    try {
      const response = await fetch(`/api/takehome/${passcode}/activate`, {
        method: 'POST',
      })

      const data = await response.json()

      if (response.ok) {
        // Redirect to main portal to see progress
        router.push('/')
      } else {
        setError(data.error || 'Failed to start interview')
        setActivating(false)
      }
    } catch {
      setError('Failed to start interview. Please try again.')
      setActivating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-xl text-slate-600">Loading...</div>
        </div>
      </div>
    )
  }

  if (error || !takehome) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md max-w-md">
          <div className="text-red-600 text-xl font-semibold mb-4">Error</div>
          <div className="text-slate-700">{error || 'Invalid invitation'}</div>
        </div>
      </div>
    )
  }

  const validUntil = new Date(takehome.validUntil)
  const isExpired = new Date() > validUntil
  const isAlreadyActivated = takehome.status !== 'active'

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto py-12 px-4">
        <div className="bg-white rounded-lg shadow-md p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-800 mb-2">
              Coding Interview - {takehome.candidateName}
            </h1>
            <div className="text-slate-600">
              Challenge:{' '}
              <span className="font-semibold">{takehome.challenge}</span>
            </div>
            <div className="text-sm text-slate-500 mt-2">
              Valid until: {validUntil.toLocaleString()}
            </div>
          </div>

          {/* Platform Instructions */}
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-blue-900 mb-3">
              Platform Instructions
            </h2>
            <ul className="space-y-2 text-blue-800 text-sm">
              <li>
                • Click &quot;Start Interview&quot; to begin provisioning your
                workspace
              </li>
              <li>
                • Your workspace will be ready in approximately 2-3 minutes
              </li>
              <li>
                • You will have {takehome.durationMinutes} minutes to complete
                the challenge
              </li>
              <li>
                • Your workspace will automatically shut down after{' '}
                {takehome.durationMinutes} minutes
              </li>
              <li>• All your work will be automatically saved</li>
              <li>• You can only start this interview once</li>
            </ul>
          </div>

          {/* Custom Instructions */}
          {takehome.customInstructions && (
            <div className="mb-6 bg-slate-50 border border-slate-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-3">
                Challenge Instructions
              </h2>
              <div className="text-slate-700 whitespace-pre-wrap text-sm">
                {takehome.customInstructions}
              </div>
            </div>
          )}

          {/* Start Button */}
          <div className="mt-8">
            {isExpired ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                This invitation has expired
              </div>
            ) : isAlreadyActivated ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-700">
                This interview has already been started
              </div>
            ) : (
              <button
                onClick={handleStart}
                disabled={activating}
                className={`w-full py-4 px-6 rounded-lg font-semibold text-lg transition-colors ${
                  activating
                    ? 'bg-slate-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {activating ? 'Starting...' : 'Start Interview'}
              </button>
            )}

            {activating && (
              <div className="mt-4 text-center text-sm text-slate-600">
                Provisioning your workspace... This will take 2-3 minutes.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
