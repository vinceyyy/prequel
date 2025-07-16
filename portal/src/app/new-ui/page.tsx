'use client'

import { useState, useEffect, useCallback } from 'react'
import OperationDashboard from '@/components/OperationDashboard'
import AuthStatus from '@/components/AuthStatus'
import { useOperations } from '@/hooks/useOperations'
import { useSSE } from '@/hooks/useSSE'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Interview {
  id: string
  candidateName: string
  status:
    | 'scheduled'
    | 'initializing'
    | 'configuring'
    | 'active'
    | 'destroying'
    | 'destroyed'
    | 'error'
  challenge: string
  accessUrl?: string
  password?: string
  createdAt: string
  scheduledAt?: string
  autoDestroyAt?: string
}

export default function NewUIHome() {
  const [interviews, setInterviews] = useState<Interview[]>([])
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [showLogsModal, setShowLogsModal] = useState(false)
  const [selectedInterviewForLogs, setSelectedInterviewForLogs] = useState<
    string | null
  >(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    candidateName: '',
    challenge: 'python',
    scheduledAt: '',
    autoDestroyMinutes: 60,
    enableScheduling: false,
  })

  // Use the operations hook for background operations
  const { destroyInterview } = useOperations()

  // Use SSE for real-time updates
  const { connected: sseConnected, lastEvent } = useSSE('/api/events')

  const [challenges, setChallenges] = useState<
    Array<{ id: string; name: string }>
  >([])

  const loadChallenges = useCallback(async () => {
    try {
      const response = await fetch('/api/challenges')
      if (response.ok) {
        const data = await response.json()
        if (data.success && data.challenges) {
          console.log('[DEBUG] Loaded challenges from API:', data.challenges)
          setChallenges(data.challenges)
        }
      } else {
        console.warn('Failed to load challenges, using fallback')
      }
    } catch (error) {
      console.error('Error loading challenges:', error)
    }
  }, [])

  const loadInterviews = useCallback(async () => {
    try {
      // Add cache busting to ensure fresh data
      const timestamp = new Date().getTime()
      const response = await fetch(`/api/interviews?t=${timestamp}`)
      if (response.ok) {
        const data = await response.json()
        console.log(
          '[DEBUG] Loaded interviews from API:',
          data.interviews?.map((i: Interview) => ({
            id: i.id,
            status: i.status,
            candidateName: i.candidateName,
          }))
        )

        const newInterviews = data.interviews || []
        console.log(
          '[DEBUG] Setting new interviews state:',
          newInterviews.map((i: Interview) => ({
            id: i.id,
            status: i.status,
            candidateName: i.candidateName,
          }))
        )

        setInterviews(newInterviews)
      } else {
        console.error('Failed to load interviews')
      }
    } catch (error) {
      console.error('Error loading interviews:', error)
    } finally {
      // Set initial loading to false after first load
      if (initialLoading) {
        setInitialLoading(false)
      }
    }
  }, [initialLoading])

  // Step 1: One-off request when user first loads the page, blocking until response
  useEffect(() => {
    console.log(
      '[DEBUG] Main page: Step 1 - Initial load, checking existing interviews (one-off request)'
    )
    loadInterviews()
    loadChallenges()
  }, [loadInterviews, loadChallenges])

  // Listen for SSE events to refresh data
  useEffect(() => {
    if (lastEvent) {
      console.log('Received SSE event:', lastEvent)

      // Refresh interviews when operations complete or update
      if (
        lastEvent.type === 'operation_update' ||
        lastEvent.type === 'scheduler_event'
      ) {
        console.log('Refreshing interviews due to SSE event')
        loadInterviews()
      }
    }
  }, [lastEvent, loadInterviews])

  // NO AUTOMATIC POLLING - interviews endpoint is manual refresh only

  // Debug: Monitor when interviews state changes
  useEffect(() => {
    console.log(
      '[DEBUG] Interviews state changed:',
      interviews.map(i => ({
        id: i.id,
        status: i.status,
        candidateName: i.candidateName,
      }))
    )
  }, [interviews])

  // NO AUTOMATIC COMPLETION DETECTION - since interviews endpoint is manual only
  // Users can manually refresh to see completion status

  const handleCreateInterview = async () => {
    if (!formData.candidateName.trim()) return

    setLoading(true)
    try {
      // Prepare the request body
      const requestBody: {
        candidateName: string
        challenge: string
        scheduledAt?: string
        autoDestroyMinutes?: number
      } = {
        candidateName: formData.candidateName.trim(),
        challenge: formData.challenge,
      }

      // Add scheduling if enabled
      if (formData.enableScheduling && formData.scheduledAt) {
        // Convert datetime-local to ISO string to preserve user's timezone
        const localDate = new Date(formData.scheduledAt)
        requestBody.scheduledAt = localDate.toISOString()
      }

      // Auto-destroy is always enabled and required
      requestBody.autoDestroyMinutes = formData.autoDestroyMinutes

      // Make the API call
      const response = await fetch('/api/interviews/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create interview')
      }

      await response.json()

      // Close the modal immediately since operation is now background
      setFormData({
        candidateName: '',
        challenge: 'python',
        scheduledAt: '',
        autoDestroyMinutes: 60,
        enableScheduling: false,
      })
      setShowCreateForm(false)

      // Show notification
      const message = formData.enableScheduling
        ? `Interview scheduled for ${formData.candidateName.trim()}`
        : `Interview creation started for ${formData.candidateName.trim()}`
      setNotification(message)
      setTimeout(() => setNotification(null), 5000) // Clear after 5 seconds

      // Refresh the interview list
      loadInterviews()
    } catch (error) {
      console.error('Error creating interview:', error)
      alert(
        `Failed to start interview creation: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
    } finally {
      setLoading(false)
    }
  }

  const stopInterview = async (id: string) => {
    const interview = interviews.find(i => i.id === id)
    const isErrorState = interview?.status === 'error'

    const message = isErrorState
      ? 'Are you sure you want to retry destroying this interview? This will attempt to clean up any remaining AWS resources and remove the workspace from S3.'
      : 'Are you sure you want to stop and destroy this interview? This action cannot be undone.'

    if (!confirm(message)) {
      return
    }

    try {
      // Use the background destroy API with interview metadata
      await destroyInterview(id, interview?.candidateName, interview?.challenge)

      // Show notification
      const candidateName = interview?.candidateName || 'Unknown'
      const actionText = isErrorState ? 'retry destroy' : 'destroy'
      setNotification(`Interview ${actionText} started for ${candidateName}`)
      setTimeout(() => setNotification(null), 5000) // Clear after 5 seconds

      // NO automatic refresh - user can manually refresh to see latest state
    } catch (error) {
      console.error('Error destroying interview:', error)
      setNotification('❌ Failed to start destroy operation. Please try again.')
      setTimeout(() => setNotification(null), 5000)
    }
  }

  return (
    <div className="min-h-screen bg-background p-4 sm:p-8 w-full overflow-x-hidden">
      {/* Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 text-white px-6 py-3 rounded-lg shadow-lg z-50 ${
            notification.includes('❌') ? 'bg-destructive' : 'bg-green-500'
          }`}
        >
          <div className="flex items-center space-x-2">
            {notification.includes('started') && (
              <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
            )}
            <span>{notification}</span>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto w-full">
        <header className="mb-8">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-3xl">
                    Prequel Portal (New UI)
                  </CardTitle>
                  <p className="text-muted-foreground mt-2">
                    Manage coding interviews and VS Code instances
                  </p>
                </div>
                <AuthStatus />
              </div>
            </CardHeader>
          </Card>
        </header>

        <div className="mb-6 flex flex-wrap gap-3 items-center">
          <Button onClick={() => setShowCreateForm(true)}>
            Create New Interview
          </Button>
          <Button variant="secondary" onClick={loadInterviews}>
            Refresh
          </Button>
          <div className="flex items-center space-x-2">
            <div
              className={`w-2 h-2 rounded-full ${
                sseConnected ? 'bg-green-500' : 'bg-destructive'
              }`}
            ></div>
            <span className="text-sm text-muted-foreground">
              {sseConnected ? 'Live updates' : 'Offline'}
            </span>
          </div>
        </div>

        <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create New Interview</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="candidateName">Candidate Name</Label>
                <Input
                  id="candidateName"
                  type="text"
                  value={formData.candidateName}
                  onChange={e =>
                    setFormData({
                      ...formData,
                      candidateName: e.target.value,
                    })
                  }
                  placeholder="Enter candidate name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="challenge">Interview Challenge</Label>
                <Select
                  value={formData.challenge}
                  onValueChange={value =>
                    setFormData({ ...formData, challenge: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a challenge" />
                  </SelectTrigger>
                  <SelectContent>
                    {challenges.map(challenge => (
                      <SelectItem key={challenge.id} value={challenge.id}>
                        {challenge.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Scheduling Options */}
              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="enableScheduling"
                    checked={formData.enableScheduling}
                    onCheckedChange={checked =>
                      setFormData({
                        ...formData,
                        enableScheduling: !!checked,
                      })
                    }
                  />
                  <Label htmlFor="enableScheduling">Schedule for later</Label>
                </div>

                {formData.enableScheduling && (
                  <div className="space-y-2">
                    <Label htmlFor="scheduledAt">Scheduled Start Time</Label>
                    <Input
                      id="scheduledAt"
                      type="datetime-local"
                      value={formData.scheduledAt}
                      onChange={e =>
                        setFormData({
                          ...formData,
                          scheduledAt: e.target.value,
                        })
                      }
                      min={new Date().toISOString().slice(0, 16)}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="duration">
                    Interview Duration{' '}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={formData.autoDestroyMinutes.toString()}
                    onValueChange={value =>
                      setFormData({
                        ...formData,
                        autoDestroyMinutes: parseInt(value),
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select duration" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="45">45 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="90">1.5 hours</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                      <SelectItem value="180">3 hours</SelectItem>
                      <SelectItem value="240">4 hours</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Required: Interview will auto-destroy after this duration to
                    prevent resource waste
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                onClick={handleCreateInterview}
                disabled={
                  !formData.candidateName.trim() ||
                  loading ||
                  (formData.enableScheduling && !formData.scheduledAt)
                }
                className="flex-1"
              >
                {loading
                  ? 'Creating...'
                  : formData.enableScheduling
                    ? 'Schedule Interview'
                    : 'Create Interview'}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowCreateForm(false)}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Challenge</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Access Details</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initialLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                          <span>Loading interviews...</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : interviews.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-muted-foreground"
                      >
                        No interviews created yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    interviews.map(interview => (
                      <TableRow key={interview.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">
                              {interview.candidateName}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {new Date(
                                interview.createdAt
                              ).toLocaleDateString()}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {
                            challenges.find(c => c.id === interview.challenge)
                              ?.name
                          }
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge
                              variant={
                                interview.status === 'scheduled'
                                  ? 'secondary'
                                  : interview.status === 'initializing'
                                    ? 'secondary'
                                    : interview.status === 'configuring'
                                      ? 'secondary'
                                      : interview.status === 'active'
                                        ? 'default'
                                        : interview.status === 'destroying'
                                          ? 'secondary'
                                          : interview.status === 'error'
                                            ? 'destructive'
                                            : 'outline'
                              }
                            >
                              {interview.status}
                            </Badge>
                            {interview.status === 'error' && (
                              <div className="text-xs text-destructive">
                                Resources may need cleanup
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {interview.status === 'scheduled' &&
                          interview.scheduledAt ? (
                            <div className="space-y-2">
                              <Card className="p-2">
                                <CardHeader>
                                  <CardTitle className="text-xs font-medium text-muted-foreground">
                                    Starts:
                                  </CardTitle>
                                  <CardDescription className="text-sm font-semibold">
                                    {new Date(
                                      interview.scheduledAt
                                    ).toLocaleString()}
                                  </CardDescription>
                                </CardHeader>
                              </Card>
                              {interview.autoDestroyAt && (
                                <Card className="p-2 border-destructive/20">
                                  <CardHeader>
                                    <CardTitle className="text-xs font-medium text-destructive">
                                      Auto-destroy:
                                    </CardTitle>
                                    <CardDescription className="text-sm font-semibold text-destructive">
                                      {new Date(
                                        interview.autoDestroyAt
                                      ).toLocaleString()}
                                    </CardDescription>
                                  </CardHeader>
                                </Card>
                              )}
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {interview.scheduledAt && (
                                <Card className="p-2">
                                  <CardHeader>
                                    <CardTitle className="text-xs text-muted-foreground">
                                      Started:
                                    </CardTitle>
                                    <CardDescription className="text-sm">
                                      {new Date(
                                        interview.scheduledAt
                                      ).toLocaleString()}
                                    </CardDescription>
                                  </CardHeader>
                                </Card>
                              )}
                              {interview.autoDestroyAt && (
                                <Card className="p-1 border-orange-200">
                                  <CardHeader>
                                    <CardTitle className="text-xs text-orange-700">
                                      Auto-destroy:
                                    </CardTitle>
                                    <CardDescription className="text-xs font-medium text-orange-900">
                                      {new Date(
                                        interview.autoDestroyAt
                                      ).toLocaleString()}
                                    </CardDescription>
                                  </CardHeader>
                                </Card>
                              )}
                              {!interview.scheduledAt &&
                                !interview.autoDestroyAt && (
                                  <span className="text-muted-foreground">
                                    Immediate
                                  </span>
                                )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {interview.accessUrl ? (
                            <div className="space-y-1 max-w-xs">
                              <a
                                className="text-primary underline break-all hover:text-primary/80"
                                href={interview.accessUrl}
                                target="_blank"
                              >
                                {interview.accessUrl}
                              </a>
                              <div className="text-muted-foreground text-sm break-all">
                                Password: {interview.password}
                              </div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">
                              Not started
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2 items-center">
                            {interview.status === 'active' && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => stopInterview(interview.id)}
                              >
                                Stop & Destroy
                              </Button>
                            )}
                            {interview.status === 'scheduled' && (
                              <Badge variant="secondary">Scheduled...</Badge>
                            )}
                            {interview.status === 'initializing' && (
                              <Badge variant="secondary">Initializing...</Badge>
                            )}
                            {interview.status === 'configuring' && (
                              <Badge variant="secondary">Configuring...</Badge>
                            )}
                            {interview.status === 'destroying' && (
                              <Badge variant="secondary">Destroying...</Badge>
                            )}
                            {interview.status === 'error' && (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => stopInterview(interview.id)}
                              >
                                Retry Destroy
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedInterviewForLogs(interview.id)
                                setShowLogsModal(true)
                              }}
                            >
                              Logs
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Logs Modal */}
        <Dialog
          open={showLogsModal}
          onOpenChange={open => {
            setShowLogsModal(open)
            if (!open) setSelectedInterviewForLogs(null)
          }}
        >
          <DialogContent className="max-w-6xl h-5/6 max-h-screen">
            <DialogHeader>
              <DialogTitle>
                Operation Logs
                {selectedInterviewForLogs
                  ? ` - Interview ${selectedInterviewForLogs}`
                  : ''}
              </DialogTitle>
            </DialogHeader>

            <div className="overflow-hidden flex-1">
              <OperationDashboard interviewFilter={selectedInterviewForLogs} />
            </div>

            <div className="flex justify-end mt-4">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowLogsModal(false)
                  setSelectedInterviewForLogs(null)
                }}
              >
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
