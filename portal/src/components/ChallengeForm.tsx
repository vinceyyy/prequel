'use client'

import { useState, useEffect } from 'react'
import { Challenge, ECS_CONFIG_LIMITS } from '@/lib/challenges'

// CPU units to vCPU cores mapping
const CPU_UNITS_TO_CORES = {
  256: 0.25, // 0.25 vCPU
  512: 0.5, // 0.5 vCPU
  1024: 1, // 1 vCPU
  2048: 2, // 2 vCPU
  4096: 4, // 4 vCPU
} as const

function getCpuCores(cpuUnits: number): number {
  return CPU_UNITS_TO_CORES[cpuUnits as keyof typeof CPU_UNITS_TO_CORES] || 0
}

interface ChallengeFormProps {
  challenge?: Challenge | null
  onSuccess: (challenge: Challenge) => void
  onCancel: () => void
}

export default function ChallengeForm({
  challenge,
  onSuccess,
  onCancel,
}: ChallengeFormProps) {
  const [formData, setFormData] = useState({
    name: challenge?.name || '',
    description: challenge?.description || '',
    ecsConfig: challenge?.ecsConfig || {
      cpu: 512,
      memory: 1024,
      storage: 20,
    },
  })

  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [dragActive, setDragActive] = useState(false)

  const isEditing = !!challenge

  // Reset form when challenge changes
  useEffect(() => {
    if (challenge) {
      setFormData({
        name: challenge.name,
        description: challenge.description,
        ecsConfig: challenge.ecsConfig,
      })
    } else {
      setFormData({
        name: '',
        description: '',
        ecsConfig: {
          cpu: 512,
          memory: 1024,
          storage: 20,
        },
      })
    }
    setFiles([])
    setErrors([])
  }, [challenge])

  // Get valid memory options for selected CPU
  const getMemoryOptions = (cpu: number) => {
    return (
      ECS_CONFIG_LIMITS.cpu[cpu as keyof typeof ECS_CONFIG_LIMITS.cpu] || []
    )
  }

  // Handle CPU change - update memory if current value is invalid
  const handleCpuChange = (newCpu: number) => {
    const validMemoryOptions = getMemoryOptions(newCpu)
    const currentMemory = formData.ecsConfig.memory

    setFormData(prev => ({
      ...prev,
      ecsConfig: {
        ...prev.ecsConfig,
        cpu: newCpu,
        memory: (validMemoryOptions as readonly number[]).includes(
          currentMemory
        )
          ? currentMemory
          : (validMemoryOptions[0] as number),
      },
    }))
  }

  // Handle file selection (both individual files and folders)
  const handleFileChange = (selectedFiles: FileList | null) => {
    if (!selectedFiles) return

    console.log(`[ChallengeForm] Selected ${selectedFiles.length} files`)

    const fileArray = Array.from(selectedFiles)
    fileArray.forEach(file => {
      const filePath =
        (file as { webkitRelativePath?: string }).webkitRelativePath ||
        file.name
      console.log(`[ChallengeForm] File: ${file.name}, path: ${filePath}`)
    })

    const validFiles = fileArray.filter(file => {
      // Check file size (max 10MB per file)
      if (file.size > 10 * 1024 * 1024) {
        const filePath =
          (file as { webkitRelativePath?: string }).webkitRelativePath ||
          file.name
        setErrors(prev => [
          ...prev,
          `${filePath} is too large (max 10MB per file)`,
        ])
        return false
      }
      return true
    })

    console.log(`[ChallengeForm] Adding ${validFiles.length} valid files`)
    setFiles(prev => [...prev, ...validFiles])
  }

  // Handle drag and drop - supports both files and folders
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const droppedItems = e.dataTransfer.items
    if (droppedItems) {
      // Handle both files and folders using DataTransferItem API
      processDroppedItems(droppedItems)
    } else {
      // Fallback to files API
      const droppedFiles = e.dataTransfer.files
      handleFileChange(droppedFiles)
    }
  }

  // Process dropped items (handles both files and folders)
  const processDroppedItems = async (items: DataTransferItemList) => {
    const allFiles: File[] = []
    const promises: Promise<void>[] = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry()
        if (entry) {
          promises.push(processEntry(entry, '', allFiles))
        }
      }
    }

    try {
      await Promise.all(promises)
      console.log(
        `[ChallengeForm] Processed ${allFiles.length} files from drag and drop`
      )

      // Filter and add files using the same validation logic
      const validFiles = allFiles.filter(file => {
        if (file.size > 10 * 1024 * 1024) {
          const filePath =
            (file as { webkitRelativePath?: string }).webkitRelativePath ||
            file.name
          setErrors(prev => [
            ...prev,
            `${filePath} is too large (max 10MB per file)`,
          ])
          return false
        }
        return true
      })

      console.log(
        `[ChallengeForm] Adding ${validFiles.length} valid files from drag and drop`
      )
      setFiles(prev => [...prev, ...validFiles])
    } catch (error) {
      console.error('[ChallengeForm] Error processing dropped items:', error)
      setErrors(prev => [...prev, 'Error processing dropped files/folders'])
    }
  }

  // Recursively process file system entries
  const processEntry = (
    entry: FileSystemEntry,
    path: string,
    allFiles: File[]
  ): Promise<void> => {
    return new Promise(resolve => {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry
        fileEntry.file((file: File) => {
          // Set the webkitRelativePath to preserve folder structure
          const fullPath = path + file.name
          Object.defineProperty(file, 'webkitRelativePath', {
            value: fullPath,
            writable: false,
          })
          allFiles.push(file)
          resolve()
        })
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry
        const reader = dirEntry.createReader()
        reader.readEntries((entries: FileSystemEntry[]) => {
          const promises = entries.map(subEntry =>
            processEntry(subEntry, path + entry.name + '/', allFiles)
          )
          Promise.all(promises).then(() => resolve())
        })
      } else {
        resolve()
      }
    })
  }

  // Remove file from selection
  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Validate form
  const validateForm = () => {
    const newErrors: string[] = []

    if (!formData.name.trim()) {
      newErrors.push('Challenge name is required')
    }

    if (!formData.description.trim()) {
      newErrors.push('Challenge description is required')
    }

    if (!isEditing && files.length === 0) {
      newErrors.push('At least one file is required for new challenges')
    }

    // Validate ECS config
    const { cpu, memory, storage } = formData.ecsConfig
    const validMemoryOptions = getMemoryOptions(cpu)

    if (!(validMemoryOptions as readonly number[]).includes(memory)) {
      newErrors.push(`Invalid memory ${memory}MB for CPU ${cpu}`)
    }

    if (
      storage < ECS_CONFIG_LIMITS.storage.min ||
      storage > ECS_CONFIG_LIMITS.storage.max
    ) {
      newErrors.push(
        `Storage must be between ${ECS_CONFIG_LIMITS.storage.min} and ${ECS_CONFIG_LIMITS.storage.max} GB`
      )
    }

    setErrors(newErrors)
    return newErrors.length === 0
  }

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    setUploading(true)
    setUploadProgress('Validating...')

    try {
      let challengeId = challenge?.id

      // Step 1: Upload files if any are selected
      if (files.length > 0) {
        setUploadProgress('Uploading files...')

        // Generate challenge ID for new challenges
        if (!challengeId) {
          challengeId = `challenge-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`
        }

        const uploadFormData = new FormData()
        files.forEach(file => {
          uploadFormData.append('files', file)
          // Preserve the relative path information if available
          const relativePath =
            (file as { webkitRelativePath?: string }).webkitRelativePath ||
            file.name
          uploadFormData.append('filePaths', relativePath)
        })
        uploadFormData.append('challengeId', challengeId)
        uploadFormData.append('overwrite', isEditing ? 'true' : 'false')

        const uploadResponse = await fetch('/api/challenges/manage/upload', {
          method: 'POST',
          body: uploadFormData,
        })

        const uploadResult = await uploadResponse.json()
        if (!uploadResult.success) {
          throw new Error(uploadResult.error || 'File upload failed')
        }

        // Update files list for database
        const uploadedFiles = uploadResult.uploadedFiles || []

        // Step 2: Create or update challenge in database
        setUploadProgress('Saving challenge...')

        if (isEditing) {
          // Update existing challenge
          const updatePayload = {
            ...formData,
            ...(uploadedFiles.length > 0 && {
              files: [...(challenge.files || []), ...uploadedFiles],
            }),
          }

          const response = await fetch(
            `/api/challenges/manage/${challenge.id}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatePayload),
            }
          )

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to update challenge')
          }

          const result = await response.json()
          onSuccess(result.challenge)
        } else {
          // Create new challenge with the same ID used for file upload
          const createPayload = {
            id: challengeId, // Use the same ID that was used for file upload
            ...formData,
            files: uploadedFiles,
            createdBy: 'admin', // TODO: Get from auth context
          }

          const response = await fetch('/api/challenges/manage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createPayload),
          })

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to create challenge')
          }

          const result = await response.json()
          onSuccess(result.challenge)
        }
      } else {
        // No files to upload, just update metadata
        if (isEditing) {
          setUploadProgress('Updating challenge...')

          const response = await fetch(
            `/api/challenges/manage/${challenge.id}`,
            {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(formData),
            }
          )

          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to update challenge')
          }

          const result = await response.json()
          onSuccess(result.challenge)
        } else {
          throw new Error('Files are required for new challenges')
        }
      }
    } catch (error) {
      console.error('Error saving challenge:', error)
      setErrors([
        error instanceof Error ? error.message : 'Unknown error occurred',
      ])
    } finally {
      setUploading(false)
      setUploadProgress('')
    }
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-bold mb-6">
        {isEditing
          ? `Edit Challenge: ${challenge.name}`
          : 'Create New Challenge'}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">
              Challenge Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={e =>
                setFormData(prev => ({ ...prev, name: e.target.value }))
              }
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Python Data Processing"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Description *
          </label>
          <textarea
            value={formData.description}
            onChange={e =>
              setFormData(prev => ({ ...prev, description: e.target.value }))
            }
            rows={3}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Describe what this challenge tests and any special instructions..."
          />
        </div>

        {/* ECS Configuration */}
        <div>
          <h3 className="text-lg font-semibold mb-4">
            Container Configuration
          </h3>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                CPU (units) *
              </label>
              <select
                value={formData.ecsConfig.cpu}
                onChange={e => handleCpuChange(Number(e.target.value))}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.keys(ECS_CONFIG_LIMITS.cpu).map(cpu => {
                  const cpuNum = Number(cpu)
                  const cores = getCpuCores(cpuNum)
                  return (
                    <option key={cpu} value={cpu}>
                      {cpu} units ({cores} {cores === 1 ? 'core' : 'cores'})
                    </option>
                  )
                })}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Memory (MB) *
              </label>
              <select
                value={formData.ecsConfig.memory}
                onChange={e =>
                  setFormData(prev => ({
                    ...prev,
                    ecsConfig: {
                      ...prev.ecsConfig,
                      memory: Number(e.target.value),
                    },
                  }))
                }
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {getMemoryOptions(formData.ecsConfig.cpu).map(memory => (
                  <option key={memory} value={memory}>
                    {memory} MB
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Storage (GB) *
              </label>
              <input
                type="number"
                min={ECS_CONFIG_LIMITS.storage.min}
                max={ECS_CONFIG_LIMITS.storage.max}
                value={formData.ecsConfig.storage}
                onChange={e =>
                  setFormData(prev => ({
                    ...prev,
                    ecsConfig: {
                      ...prev.ecsConfig,
                      storage: Number(e.target.value),
                    },
                  }))
                }
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            Configure the ECS container resources for this challenge. Higher
            resources cost more but provide better performance.
          </p>
        </div>

        {/* File Upload */}
        <div>
          <h3 className="text-lg font-semibold mb-4">
            Challenge Files {!isEditing && '*'}
          </h3>

          {/* Upload Guidelines */}
          <div className="bg-blue-900/20 border border-blue-600 rounded-lg p-4 mb-6">
            <h4 className="font-semibold text-blue-400 mb-3">
              📁 Challenge Structure Guidelines
            </h4>
            <div className="space-y-3 text-sm text-gray-300">
              <div>
                <p className="mb-2">
                  <strong>
                    Upload the contents, not the challenge folder itself:
                  </strong>
                </p>
                <div className="bg-gray-800/50 p-3 rounded font-mono text-xs">
                  <div className="text-green-400">
                    ✓ Correct files to upload:
                  </div>
                  <div className="ml-2">
                    ├── main.py
                    <br />
                    └── requirements.txt
                  </div>
                  <div className="mt-2 text-red-400">
                    ✗ Avoid uploading the challenge folder itself:
                  </div>
                  <div className="ml-2">
                    └── my-challenge/
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;├── main.py
                    <br />
                    &nbsp;&nbsp;&nbsp;&nbsp;└── requirements.txt
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2">
                  <strong>🔧 Automatic Dependency Installation:</strong>
                </p>
                <p>
                  If you include dependency files in the project root, they will
                  be automatically installed before the candidate logs in:
                </p>
                <ul className="list-disc list-inside ml-4 mt-2 space-y-1">
                  <li>
                    <code>pyproject.toml</code> or <code>requirements.txt</code>{' '}
                    → Python dependencies installed via uv/pip (creates{' '}
                    <code>.venv</code>)
                  </li>
                  <li>
                    <code>package.json</code> → Node.js dependencies installed
                    via npm
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragActive
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-600 hover:border-gray-500'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <div className="text-gray-400">
              <div className="mb-4">
                <svg
                  className="mx-auto h-20 w-20 mb-4"
                  stroke="currentColor"
                  fill="none"
                  viewBox="0 0 48 48"
                >
                  <path
                    d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="text-xl font-semibold mb-3 text-blue-400">
                  📁 Drag & Drop Your Challenge Files Here
                </div>
                <div className="bg-gray-800/50 rounded-lg p-3 text-xs text-gray-400">
                  <p>
                    💡 This includes complete folder structures with all
                    subfolders preserved.
                  </p>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-700">
                <p className="text-xs text-red-400 mt-1">
                  Max 10MB per file, 100MB total
                </p>
              </div>
            </div>
          </div>

          {/* Selected Files */}
          {files.length > 0 && (
            <div className="mt-4">
              <h4 className="font-medium mb-2">
                Selected Files ({files.length}):
              </h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between bg-gray-800 px-3 py-2 rounded-lg"
                  >
                    <div className="flex items-center min-w-0 flex-1">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {file.webkitRelativePath || file.name}
                        </div>
                        {file.webkitRelativePath && (
                          <div className="text-xs text-gray-500">
                            File: {file.name}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                        ({(file.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="text-red-400 hover:text-red-300 text-sm ml-2 flex-shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {files.some(file => file.webkitRelativePath) && (
                <div className="mt-2 text-sm text-gray-500">
                  Folder structure will be preserved when uploaded to challenge.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-4">
            <h4 className="font-semibold text-red-400 mb-2">
              Please fix the following errors:
            </h4>
            <ul className="list-disc list-inside space-y-1 text-red-300">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Upload Progress */}
        {uploading && (
          <div className="bg-blue-900/50 border border-blue-500 rounded-lg p-4">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-3"></div>
              <span>{uploadProgress}</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-4">
          <button
            type="submit"
            disabled={uploading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {uploading
              ? 'Processing...'
              : isEditing
                ? 'Update Challenge'
                : 'Create Challenge'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={uploading}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
