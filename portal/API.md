# Prequel Portal API Documentation

This document describes the API endpoints for the Prequel Portal, including real-time features and background operations.

## Overview

The API supports:
- **RESTful operations** for interview and operation management
- **Server-Sent Events (SSE)** for real-time updates
- **Background operations** with detailed logging
- **Scheduling system** with auto-destroy capabilities

## Base URL

- **Development**: `http://localhost:3000`
- **Production**: Deployed on AWS ECS with ALB

## Authentication

- **Development**: AWS SSO profile-based authentication
- **Production**: ECS task role authentication (automatic)

---

## Interviews API

### Create Interview

**Endpoint:** `POST /api/interviews/create`

Creates a new interview with optional scheduling and mandatory auto-destroy.

**Request Body:**
```json
{
  "candidateName": "John Doe",
  "challenge": "javascript",
  "scheduledAt": "2024-01-15T10:00:00Z", // Optional: schedule for future
  "autoDestroyMinutes": 60 // Required: 30-240 minutes
}
```

**Response:**
```json
{
  "operationId": "op-12345",
  "interviewId": "int-67890",
  "candidateName": "John Doe",
  "challenge": "javascript",
  "password": "abc123def456",
  "scheduledAt": "2024-01-15T10:00:00Z", // If scheduled
  "autoDestroyAt": "2024-01-15T11:00:00Z",
  "message": "Interview creation started in background"
}
```

**Status Codes:**
- `200` - Interview creation started
- `400` - Invalid request (missing required fields)
- `500` - Server error

### List Interviews

**Endpoint:** `GET /api/interviews`

Returns all interviews with current status from operations and Terraform state.

**Response:**
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
      "autoDestroyAt": "2024-01-15T11:00:00Z"
    }
  ]
}
```

**Status Values:**
- `scheduled` - Waiting for scheduled start time
- `initializing` - Provisioning AWS infrastructure
- `configuring` - Setting up VS Code environment
- `active` - Ready for candidate access
- `destroying` - Cleaning up resources
- `destroyed` - Fully removed
- `error` - Failed state requiring manual intervention

### Destroy Interview

**Endpoint:** `POST /api/interviews/{id}/destroy`

Starts background destruction of interview infrastructure.

**Response:**
```json
{
  "operationId": "op-54321",
  "interviewId": "int-67890",
  "message": "Interview destruction started in background"
}
```

---

## Operations API

### List Operations

**Endpoint:** `GET /api/operations`

Returns all background operations with their current status and logs.

**Query Parameters:**
- `interviewId` (optional) - Filter operations for specific interview

**Response:**
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

### Get Operation Details

**Endpoint:** `GET /api/operations/{id}`

Returns detailed information about a specific operation.

### Cancel Operation

**Endpoint:** `POST /api/operations/{id}/cancel`

Cancels a running operation (only pending/running operations can be cancelled).

**Response:**
```json
{
  "success": true,
  "message": "Operation cancelled successfully"
}
```

### Get Operation Logs

**Endpoint:** `GET /api/operations/{id}/logs`

Returns real-time logs for an operation.

**Response:**
```json
{
  "logs": [
    "[2024-01-15T09:00:00Z] Starting interview creation for John Doe",
    "[2024-01-15T09:02:00Z] Terraform applying infrastructure...",
    "[2024-01-15T09:05:00Z] ✅ Interview created successfully!"
  ]
}
```

---

## Real-time Events API

### Server-Sent Events

**Endpoint:** `GET /api/events`

Establishes persistent SSE connection for real-time updates.

**Response Headers:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**Event Types:**

1. **Connection Event** (initial):
```json
{
  "type": "connection",
  "timestamp": "2024-01-15T09:00:00Z"
}
```

2. **Heartbeat Event** (every 30 seconds):
```json
{
  "type": "heartbeat",
  "timestamp": "2024-01-15T09:00:30Z"
}
```

3. **Operation Status Event** (every 5 seconds if active operations):
```json
{
  "type": "operation_status",
  "timestamp": "2024-01-15T09:00:05Z",
  "operations": [
    {
      "id": "op-12345",
      "type": "create",
      "status": "running",
      "interviewId": "int-67890",
      "candidateName": "John Doe",
      "scheduledAt": "2024-01-15T10:00:00Z",
      "autoDestroyAt": "2024-01-15T11:00:00Z"
    }
  ]
}
```

4. **Operation Update Event** (immediate on status change):
```json
{
  "type": "operation_update",
  "timestamp": "2024-01-15T09:02:00Z",
  "operation": {
    "id": "op-12345",
    "type": "create",
    "status": "running",
    "interviewId": "int-67890",
    "candidateName": "John Doe",
    "challenge": "javascript",
    "startedAt": "2024-01-15T09:00:00Z",
    "result": null
  }
}
```

5. **Scheduler Event** (when scheduler processes operations):
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

---

## Challenges API

### List Available Challenges

**Endpoint:** `GET /api/challenges`

Returns challenges available from S3 storage.

**Response:**
```json
{
  "success": true,
  "challenges": [
    {
      "id": "javascript",
      "name": "Javascript"
    },
    {
      "id": "python", 
      "name": "Python"
    },
    {
      "id": "sql",
      "name": "Sql"
    },
    {
      "id": "data-science",
      "name": "Data Science"
    }
  ]
}
```

---

## Error Handling

### Standard Error Response

```json
{
  "error": "Error message describing what went wrong",
  "details": "Additional technical details (development only)"
}
```

### Common Error Scenarios

1. **AWS Authentication Failure**:
   - Development: Run `aws sso login --profile <AWS_PROFILE>`
   - Production: Check ECS task role permissions

2. **Terraform Execution Failure**:
   - Check operation logs for detailed error information
   - May require manual resource cleanup

3. **SSE Connection Issues**:
   - Network interruptions cause automatic reconnection (5-second retry)
   - Check browser Developer Tools > Network tab for connection status

---

## Rate Limiting

Currently no rate limiting is implemented. In production, consider:
- Interview creation: Max 10 per minute per user
- Operation queries: Max 100 per minute per user
- SSE connections: Max 5 concurrent per user

---

## Examples

### Creating a Scheduled Interview

```bash
curl -X POST http://localhost:3000/api/interviews/create \
  -H "Content-Type: application/json" \
  -d '{
    "candidateName": "Jane Smith",
    "challenge": "python",
    "scheduledAt": "2024-01-15T14:00:00Z",
    "autoDestroyMinutes": 90
  }'
```

### Monitoring via SSE

```javascript
const eventSource = new EventSource('/api/events');

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
  
  if (data.type === 'operation_update') {
    // Update UI with new operation status
    updateInterviewStatus(data.operation);
  }
};

eventSource.onerror = function(error) {
  console.error('SSE connection error:', error);
};
```

### Getting Operation Logs

```bash
curl http://localhost:3000/api/operations/op-12345/logs
```

This API supports the real-time, scheduling-enabled interview management system with comprehensive monitoring and logging capabilities.