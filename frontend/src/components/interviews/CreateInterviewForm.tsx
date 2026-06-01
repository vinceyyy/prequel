import { type Challenge, type CreateInterviewFormData } from './types'

interface CreateInterviewFormProps {
  formData: CreateInterviewFormData
  setFormData: React.Dispatch<React.SetStateAction<CreateInterviewFormData>>
  challenges: Challenge[]
  loading: boolean
  onSubmit: () => void
  onCancel: () => void
}

export default function CreateInterviewForm({
  formData,
  setFormData,
  challenges,
  loading,
  onSubmit,
  onCancel,
}: CreateInterviewFormProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="card p-4 sm:p-6 w-full max-w-md fade-in">
        <h2 className="text-xl font-semibold mb-4 text-slate-900">Create New Interview</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-900 mb-1">Candidate Name</label>
            <input
              type="text"
              value={formData.candidateName}
              onChange={(e) =>
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
                challenges.map((challenge) => (
                  <div key={challenge.id}>
                    <label className="flex items-start space-x-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                      <input
                        type="radio"
                        name="challenge"
                        value={challenge.id}
                        checked={formData.challenge === challenge.id}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            challenge: e.target.value,
                          })
                        }
                        className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium text-slate-900">{challenge.name}</h4>
                          <div className="flex items-center space-x-2 text-xs text-slate-500">
                            <span>Used {challenge.usageCount} times</span>
                          </div>
                        </div>
                        <p className="text-sm text-slate-600 mt-1">{challenge.description}</p>
                        <div className="mt-2 text-xs text-slate-600">
                          {challenge.ecsConfig.cpuCores} CPU{' '}
                          {challenge.ecsConfig.cpuCores === 1 ? 'core' : 'cores'} /{' '}
                          {challenge.ecsConfig.memory / 1024}GB RAM / {challenge.ecsConfig.storage}
                          GB Storage
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                          <span>Created: {new Date(challenge.createdAt).toLocaleDateString()}</span>
                          <span>
                            {challenge.lastUsedAt
                              ? `Last used: ${new Date(challenge.lastUsedAt).toLocaleDateString()}`
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
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    enableScheduling: e.target.checked,
                  })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="enableScheduling" className="text-sm font-medium text-slate-900">
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
                  onChange={(e) =>
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
                onChange={(e) =>
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
                Required: Interview will auto-destroy after this duration to prevent resource waste
              </p>
            </div>

            {/* File Saving Options */}
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="saveFiles"
                checked={formData.saveFiles}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    saveFiles: e.target.checked,
                  })
                }
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="saveFiles" className="text-sm font-medium text-slate-900">
                Save candidate files to history
              </label>
            </div>
            <p className="text-xs text-slate-500 -mt-2">
              Recommended: Save candidate&apos;s work files before destroying the interview
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onSubmit}
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
          <button onClick={onCancel} className="flex-1 btn-outline">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
