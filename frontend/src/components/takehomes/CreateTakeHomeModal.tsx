import { type Challenge, type TakeHomeFormData } from './types'

interface CreateTakeHomeModalProps {
  formData: TakeHomeFormData
  setFormData: React.Dispatch<React.SetStateAction<TakeHomeFormData>>
  challenges: Challenge[]
  loading: boolean
  onCreate: () => void
  onCancel: () => void
}

export default function CreateTakeHomeModal({
  formData,
  setFormData,
  challenges,
  loading,
  onCreate,
  onCancel,
}: CreateTakeHomeModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="card p-4 sm:p-6 w-full max-w-md fade-in">
        <h2 className="text-xl font-semibold mb-4 text-slate-900">Create New Take-Home</h2>

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
            <label className="block text-sm font-medium text-slate-900 mb-1">
              Candidate Email (optional)
            </label>
            <input
              type="email"
              value={formData.candidateEmail}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  candidateEmail: e.target.value,
                })
              }
              className="input-field"
              placeholder="candidate@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-900 mb-2">Challenge</label>
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
                        </div>
                        <p className="text-sm text-slate-600 mt-1">{challenge.description}</p>
                        <div className="mt-2 text-xs text-slate-600">
                          {challenge.ecsConfig.cpuCores} CPU{' '}
                          {challenge.ecsConfig.cpuCores === 1 ? 'core' : 'cores'} /{' '}
                          {challenge.ecsConfig.memory / 1024}GB RAM / {challenge.ecsConfig.storage}
                          GB Storage
                        </div>
                      </div>
                    </label>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-900 mb-1">
              Available For (days)
            </label>
            <select
              value={formData.availableDays}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  availableDays: parseInt(e.target.value),
                })
              }
              className="input-field"
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">
              How long the candidate has to activate the take-home
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-900 mb-1">
              Duration (hours)
            </label>
            <select
              value={formData.durationHours}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  durationHours: parseInt(e.target.value),
                })
              }
              className="input-field"
            >
              <option value={1}>1 hour</option>
              <option value={2}>2 hours</option>
              <option value={3}>3 hours</option>
              <option value={4}>4 hours</option>
              <option value={6}>6 hours</option>
              <option value={8}>8 hours</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">Time limit once candidate activates</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-900 mb-1">
              Additional Instructions (optional)
            </label>
            <textarea
              value={formData.additionalInstructions}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  additionalInstructions: e.target.value,
                })
              }
              className="input-field"
              rows={4}
              placeholder="Any specific instructions or requirements for the candidate..."
            />
            <p className="text-xs text-slate-500 mt-1">
              Custom instructions that will be shown to the candidate
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onCreate}
            disabled={!formData.candidateName.trim() || !formData.challenge || loading}
            className="flex-1 btn-primary"
          >
            {loading ? 'Creating...' : 'Create Take-Home'}
          </button>
          <button onClick={onCancel} className="flex-1 btn-outline">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
