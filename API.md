# Prequel API Documentation

Complete API documentation for the Prequel coding interview platform, covering all endpoints for interview management, challenge operations, real-time updates, and file handling.

## Base URL

```
https://your-portal-domain.com/api
```

## Authentication

The portal uses configurable authentication:
- **Development**: Optional passcode authentication (configurable via `ENABLE_AUTH` and `AUTH_PASSCODE`)
- **Production**: Enable authentication by setting `ENABLE_AUTH=true` in environment variables

## Common Response Format

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional success message"
}
```

### Error Response
```json
{
  "error": "User-friendly error message",
  "details": "Technical details (development only)"
}
```

## Interviews API

### Create Interview

Creates a new interview instance with background processing and real-time status updates via SSE.

```http
POST /api/interviews/create
Content-Type: application/json

{
  "candidateName": "John Doe",
  "challenge": "javascript",
  "scheduledAt": "2024-01-15T10:00:00Z",  // Optional: schedule for future
  "autoDestroyMinutes": 60,               // Required: 30-240 minutes
  "saveFiles": false                      // Optional: save candidate files on destruction
}
```

**Response** (200):
```json
{
  "operationId": "op-12345",
  "interviewId": "int-67890", 
  "candidateName": "John Doe",
  "challenge": "javascript",
  "password": "abc123def456",
  "scheduledAt": "2024-01-15T10:00:00Z",
  "autoDestroyAt": "2024-01-15T11:00:00Z",
  "message": "Interview creation started in background"
}
```

**Auto-Destroy Durations:**
- 30, 45, 60, 90, 120, 180, 240 minutes
- Auto-destroy is **mandatory** to prevent resource waste

### List Interviews

Retrieves all interviews with their current status and access information.

```http
GET /api/interviews
```

**Response** (200):
```json
{
  "interviews": [
    {
      "id": "int-67890",
      "candidateName": "John Doe", 
      "challenge": "javascript",
      "status": "active",
      "accessUrl": "https://int-67890.interviews.example.com",
      "password": "abc123def456",
      "createdAt": "2024-01-15T09:00:00Z",
      "scheduledAt": "2024-01-15T10:00:00Z",
      "autoDestroyAt": "2024-01-15T11:00:00Z",
      "saveFiles": false,
      "historyS3Key": null  // Set when files are saved
    }
  ]
}
```

**Interview Status Values:**
- `scheduled` - Waiting for scheduled start time (purple indicator)
- `initializing` - Provisioning AWS infrastructure (blue indicator)  
- `configuring` - Setting up VS Code environment (yellow indicator)
- `active` - Ready for candidate access (green indicator)
- `destroying` - Cleaning up resources (orange indicator)
- `destroyed` - Fully removed (gray indicator)
- `error` - Failed state requiring intervention (red indicator)

### Destroy Interview

Initiates background interview destruction with optional file saving.

```http
POST /api/interviews/{id}/destroy
Content-Type: application/json

{
  "saveFiles": true  // Optional: save candidate files before destruction
}
```

**Response** (200):
```json
{
  "operationId": "op-54321",
  "interviewId": "int-67890",
  "message": "Interview destruction started in background"
}
```

### Delete Interview

Removes interview record from system (does not affect running instances).

```http
DELETE /api/interviews/{id}
```

**Response** (200):
```json
{
  "success": true,
  "message": "Interview deleted successfully"
}
```

### Download Interview Files

Downloads candidate files saved during interview destruction.

```http
GET /api/interviews/{id}/files
```

**Response**:
- **Success (200)**: `tar.gz` file download with filename `interview_{id}_{candidateName}.tar.gz`
- **Content-Type**: `application/gzip`
- **Error (404)**: Interview not found or no saved files
- **Error (500)**: S3 access error

**Requirements:**
- Interview must exist with `historyS3Key` field
- Files must exist in S3 history bucket
- Only available if `saveFiles` was enabled during destruction

**Error Messages:**
- "Interview not found"
- "Files were not saved for this interview"  
- "Failed to access saved files"

## Operations API

Background operations provide detailed tracking of long-running tasks with real-time status updates.

### List Operations

```http
GET /api/operations?interviewId={id}  // Optional filter
```

**Response** (200):
```json
{
  "operations": [
    {
      "id": "op-12345",
      "type": "create",
      "status": "completed", 
      "interviewId": "int-67890",
      "candidateName": "John Doe",
      "challenge": "javascript", 
      "startedAt": "2024-01-15T09:00:00Z",
      "completedAt": "2024-01-15T09:05:00Z",
      "scheduledAt": "2024-01-15T10:00:00Z",
      "autoDestroyAt": "2024-01-15T11:00:00Z",
      "logs": [
        "[2024-01-15T09:00:00Z] Starting interview creation for John Doe",
        "[2024-01-15T09:02:00Z] Terraform applying infrastructure...",
        "[2024-01-15T09:05:00Z] ✅ Interview created successfully!"
      ],
      "result": {
        "success": true,
        "accessUrl": "https://int-67890.interviews.example.com", 
        "password": "abc123def456"
      }
    }
  ]
}
```

**Operation Types:**
- `create` - Interview creation
- `destroy` - Interview destruction

**Operation Status:**
- `pending` - Queued for execution
- `running` - Currently executing
- `completed` - Finished successfully
- `failed` - Failed with error
- `cancelled` - Cancelled by user
- `scheduled` - Waiting for scheduled time

### Cancel Operation

Cancels a running or pending operation.

```http
POST /api/operations/{id}/cancel
```

**Response** (200):
```json
{
  "success": true,
  "message": "Operation cancelled successfully"
}
```

### Get Operation Logs

Retrieves detailed logs for a specific operation.

```http
GET /api/operations/{id}/logs
```

**Response** (200):
```json
{
  "logs": [
    "[2024-01-15T09:00:00Z] Starting interview creation for John Doe",
    "[2024-01-15T09:02:00Z] Terraform applying infrastructure...",
    "[2024-01-15T09:05:00Z] ✅ Interview created successfully!"
  ]
}
```

## Real-time Events API

Server-Sent Events (SSE) provide real-time updates without page refresh.

### Server-Sent Events Connection

```http
GET /api/events
Accept: text/event-stream
```

Establishes persistent SSE connection for real-time updates.

**Event Types:**

#### 1. Connection Event (initial)
```json
{
  "type": "connection",
  "timestamp": "2024-01-15T09:00:00Z"
}
```

#### 2. Heartbeat Event (every 30 seconds)
```json
{
  "type": "heartbeat", 
  "timestamp": "2024-01-15T09:00:30Z"
}
```

#### 3. Operation Status Event (every 5 seconds if active operations)
```json
{
  "type": "operation_status",
  "timestamp": "2024-01-15T09:01:00Z",
  "activeOperations": 2
}
```

#### 4. Operation Update Event (immediate on status change)
```json
{
  "type": "operation_update",
  "timestamp": "2024-01-15T09:02:00Z", 
  "operation": {
    "id": "op-12345",
    "type": "create",
    "status": "running",
    "interviewId": "int-67890",
    "candidateName": "John Doe"
  }
}
```

#### 5. Scheduler Event (when scheduler processes operations)
```json
{
  "type": "scheduler_event",
  "timestamp": "2024-01-15T10:00:00Z",
  "event": {
    "type": "scheduled_start",
    "operationId": "op-12345", 
    "interviewId": "int-67890"
  }
}
```

## Challenges API

### List Available Challenges

```http
GET /api/challenges
```

**Response** (200):
```json
{
  "success": true,
  "challenges": [
    {
      "id": "javascript",
      "name": "Javascript", 
      "configuration": {
        "cpu": 1024,
        "memory": 2048,
        "storage": 20
      }
    },
    {
      "id": "python", 
      "name": "Python",
      "configuration": {
        "cpu": 2048,
        "memory": 4096, 
        "storage": 20
      }
    }
  ]
}
```

### Create New Challenge

```http
POST /api/challenges/manage/create
Content-Type: application/json

{
  "challengeName": "New Challenge",
  "configuration": {
    "cpu": 1024,      // CPU units (256-4096)
    "memory": 2048,   // Memory in MB (512-8192) 
    "storage": 20     // Storage in GB (20-100)
  }
}
```

**Response** (200):
```json
{
  "success": true,
  "challengeId": "new-challenge",
  "message": "Challenge created successfully"
}
```

### Upload Challenge Files

Advanced file upload system supporting complex project structures with folder hierarchies.

```http
POST /api/challenges/manage/upload
Content-Type: multipart/form-data

FormData:
- challengeId: string (challenge ID)
- files: File[] (multiple files and folders)
- filePaths: string[] (preserve folder structure via webkitRelativePath)
```

**Features:**
- **Folder Support** - Upload entire directory structures including `.vscode` configuration folders
- **Mixed Upload** - Upload files and folders simultaneously via drag-and-drop
- **Path Preservation** - Maintains folder hierarchy using `webkitRelativePath` 
- **User Guidelines** - Provides project structure examples and dependency installation info

**Upload Guidelines for Users:**

Upload files/folders to the **PROJECT ROOT** (not the project folder itself):

```
✅ Correct Structure:
project-root/
├── src/
│   ├── main.js
│   └── utils.js  
├── .vscode/
│   └── settings.json
├── package.json         # Auto-installs dependencies
├── pyproject.toml       # Auto-creates .venv
└── README.md

❌ Incorrect (don't upload the project folder):
my-project/
└── project-root/
    ├── src/
    └── package.json

🔧 Automatic Dependency Installation:
When uploading package.json, pyproject.toml, uv.lock, or requirements.txt 
to the project root, dependencies will be installed automatically before 
candidate access.
```

**Response** (200):
```json
{
  "success": true,
  "message": "Files uploaded successfully",
  "fileCount": 15,
  "challengeId": "javascript"
}
```

### Delete Challenge

```http
DELETE /api/challenges/manage/delete
Content-Type: application/json

{
  "challengeId": "challenge-to-delete"
}
```

**Response** (200):
```json
{
  "success": true,
  "message": "Challenge deleted successfully"
}
```

## Error Codes

### HTTP Status Codes

- **200 OK** - Request successful
- **400 Bad Request** - Invalid request parameters
- **401 Unauthorized** - Authentication required
- **403 Forbidden** - Access denied
- **404 Not Found** - Resource not found
- **429 Too Many Requests** - Rate limit exceeded
- **500 Internal Server Error** - Server error

### Common Error Messages

**Authentication Errors:**
- "Authentication required"
- "Invalid passcode"

**Interview Errors:**
- "Interview not found" 
- "Invalid auto-destroy duration"
- "Challenge not found"

**File Operation Errors:**
- "Files were not saved for this interview"
- "Failed to access saved files"
- "Upload failed - invalid file type"

**Operation Errors:**
- "Operation not found"
- "Cannot cancel completed operation"

## Rate Limiting

- **General API**: 100 requests per minute per IP
- **File Uploads**: 10 uploads per minute per IP
- **SSE Connections**: 5 concurrent connections per IP

Rate limits are automatically enforced and return HTTP 429 when exceeded.

## Real-time Architecture

The API is built around real-time updates using Server-Sent Events (SSE):

1. **Background Operations** - All long-running tasks (interview creation/destruction) run in background
2. **SSE Events** - Status changes trigger immediate SSE events to connected clients  
3. **Non-blocking UI** - Users can continue working while operations run in background
4. **Auto-reconnection** - SSE connections automatically reconnect on interruption

This architecture provides a responsive user experience with live status updates and detailed operation logging.