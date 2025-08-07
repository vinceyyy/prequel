'use client'

import { useState, useEffect, useCallback } from 'react'

interface FileInfo {
  name: string
  path: string
  size: number
  lastModified: string
  isDirectory: boolean
  mimeType?: string
}

interface FileContent {
  content: string
  size: number
  mimeType: string
  lastModified?: string
}

interface FileBrowserProps {
  challengeId: string
  challengeName: string
  onBack: () => void
}

export default function FileBrowser({
  challengeId,
  challengeName,
  onBack,
}: FileBrowserProps) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [currentPath, setCurrentPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<FileContent | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load files for current path
  const loadFiles = useCallback(
    async (path: string = '') => {
      try {
        setLoading(true)
        setError(null)

        const queryParams = path ? `?path=${encodeURIComponent(path)}` : ''
        const response = await fetch(
          `/api/challenges/manage/${challengeId}/files${queryParams}`
        )

        if (response.ok) {
          const data = await response.json()
          if (data.success) {
            setFiles(data.files)
            setCurrentPath(path)
          } else {
            setError(data.error || 'Failed to load files')
          }
        } else {
          setError('Failed to load files')
        }
      } catch (error) {
        console.error('Error loading files:', error)
        setError('Error loading files')
      } finally {
        setLoading(false)
      }
    },
    [challengeId]
  )

  // Load file content
  const loadFileContent = async (filePath: string) => {
    try {
      setLoadingContent(true)
      setError(null)

      const response = await fetch(
        `/api/challenges/manage/${challengeId}/files/${filePath}`
      )

      if (response.ok) {
        const data = await response.json()
        if (data.success) {
          setFileContent({
            content: data.content,
            size: data.size,
            mimeType: data.mimeType,
            lastModified: data.lastModified,
          })
          setSelectedFile(filePath)
        } else {
          setError(data.error || 'Failed to load file content')
        }
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to load file content')
      }
    } catch (error) {
      console.error('Error loading file content:', error)
      setError('Error loading file content')
    } finally {
      setLoadingContent(false)
    }
  }

  // Initial load
  useEffect(() => {
    loadFiles()
  }, [challengeId, loadFiles])

  // Navigate to directory
  const navigateToDirectory = (dirPath: string) => {
    loadFiles(dirPath)
    setSelectedFile(null)
    setFileContent(null)
  }

  // Navigate up one level
  const navigateUp = () => {
    const pathParts = currentPath.split('/').filter(part => part.length > 0)
    if (pathParts.length > 0) {
      pathParts.pop()
      const newPath = pathParts.join('/')
      navigateToDirectory(newPath)
    }
  }

  // Get breadcrumb navigation
  const getBreadcrumbs = () => {
    if (!currentPath) return [{ name: challengeName, path: '' }]

    const parts = currentPath.split('/').filter(part => part.length > 0)
    const breadcrumbs = [{ name: challengeName, path: '' }]

    let accumulatedPath = ''
    for (const part of parts) {
      accumulatedPath += (accumulatedPath ? '/' : '') + part
      breadcrumbs.push({ name: part, path: accumulatedPath })
    }

    return breadcrumbs
  }

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  // Format date
  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown'
    const date = new Date(dateString)
    return (
      date.toLocaleDateString() +
      ' ' +
      date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    )
  }

  // Get file icon
  const getFileIcon = (file: FileInfo) => {
    if (file.isDirectory) {
      return '📁'
    }

    const extension = file.name.toLowerCase().split('.').pop()
    const iconMap: Record<string, string> = {
      js: '🟨',
      ts: '🔷',
      jsx: '⚛️',
      tsx: '⚛️',
      py: '🐍',
      java: '☕',
      cpp: '⚙️',
      c: '⚙️',
      html: '🌐',
      css: '🎨',
      sql: '🗄️',
      md: '📝',
      txt: '📄',
      json: '📋',
      yml: '⚙️',
      yaml: '⚙️',
      xml: '📄',
      sh: '🖥️',
      bat: '🖥️',
    }

    return iconMap[extension || ''] || '📄'
  }

  // Syntax highlighting class for code content
  const getCodeLanguage = (mimeType: string, fileName: string) => {
    const extension = fileName.toLowerCase().split('.').pop()
    const languageMap: Record<string, string> = {
      js: 'javascript',
      ts: 'typescript',
      jsx: 'javascript',
      tsx: 'typescript',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      html: 'html',
      css: 'css',
      sql: 'sql',
      md: 'markdown',
      json: 'json',
      xml: 'xml',
      yml: 'yaml',
      yaml: 'yaml',
      sh: 'bash',
    }

    return languageMap[extension || ''] || 'text'
  }

  return (
    <div className="max-w-7xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold">File Browser</h2>
          {/* Breadcrumb Navigation */}
          <nav className="flex items-center space-x-2 text-sm text-gray-400 mt-2">
            {getBreadcrumbs().map((crumb, index) => (
              <span key={index} className="flex items-center">
                {index > 0 && <span className="mx-2">/</span>}
                <button
                  onClick={() => navigateToDirectory(crumb.path)}
                  className={`hover:text-white transition-colors ${
                    index === getBreadcrumbs().length - 1
                      ? 'text-white font-semibold'
                      : ''
                  }`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        </div>
        <button
          onClick={onBack}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
        >
          ← Back to Challenges
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/50 border border-red-500 rounded-lg">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* File List */}
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Files</h3>
            {currentPath && (
              <button
                onClick={navigateUp}
                className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                ← Up
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <p className="mt-2 text-sm text-gray-400">Loading files...</p>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p>No files found in this directory</p>
            </div>
          ) : (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {files.map(file => (
                <div
                  key={file.path}
                  className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                    selectedFile === file.path
                      ? 'bg-blue-600'
                      : 'hover:bg-gray-700'
                  }`}
                  onClick={() => {
                    if (file.isDirectory) {
                      navigateToDirectory(file.path)
                    } else {
                      loadFileContent(file.path)
                    }
                  }}
                >
                  <div className="flex items-center min-w-0 flex-1">
                    <span className="text-lg mr-2">{getFileIcon(file)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{file.name}</p>
                      {!file.isDirectory && (
                        <p className="text-sm text-gray-400">
                          {formatFileSize(file.size)}
                          {file.lastModified &&
                            ` • ${formatDate(file.lastModified)}`}
                        </p>
                      )}
                    </div>
                  </div>
                  {file.isDirectory && (
                    <span className="text-gray-400 ml-2">→</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* File Content */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-4">
            {selectedFile
              ? `Content: ${selectedFile.split('/').pop()}`
              : 'File Content'}
          </h3>

          {loadingContent ? (
            <div className="text-center py-8">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
              <p className="mt-2 text-sm text-gray-400">
                Loading file content...
              </p>
            </div>
          ) : !selectedFile ? (
            <div className="text-center py-8 text-gray-400">
              <p>Select a file to view its content</p>
            </div>
          ) : !fileContent ? (
            <div className="text-center py-8 text-gray-400">
              <p>Unable to load file content</p>
            </div>
          ) : (
            <div>
              {/* File Info */}
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-700">
                <div className="text-sm text-gray-400">
                  <span>{formatFileSize(fileContent.size)}</span>
                  {fileContent.lastModified && (
                    <span>
                      {' '}
                      • Modified: {formatDate(fileContent.lastModified)}
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-400">
                  {fileContent.mimeType}
                </div>
              </div>

              {/* File Content */}
              <div className="relative">
                <pre className="bg-gray-900 rounded p-4 overflow-auto max-h-96 text-sm">
                  <code
                    className={`language-${getCodeLanguage(fileContent.mimeType, selectedFile)}`}
                  >
                    {fileContent.content}
                  </code>
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
