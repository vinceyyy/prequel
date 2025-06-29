#!/bin/sh

# EFS Initialization Script
# Copies scenario files from the container to the EFS volume

set -e

echo "Starting EFS initialization for scenario: $SCENARIO"

# Check if scenario is provided
if [ -z "$SCENARIO" ]; then
    echo "Error: SCENARIO environment variable not set"
    exit 1
fi

# Check if scenario directory exists
if [ ! -d "/app/src/scenarios/$SCENARIO" ]; then
    echo "Error: Scenario directory /app/src/scenarios/$SCENARIO not found"
    echo "Available scenarios:"
    ls -la /app/src/scenarios/
    exit 1
fi

# Create workspace directory if it doesn't exist
mkdir -p /workspace

# Copy scenario files to EFS
echo "Copying scenario files from /app/src/scenarios/$SCENARIO to /workspace"
cp -r /app/src/scenarios/$SCENARIO/* /workspace/

# Set proper ownership
chown -R 1000:1000 /workspace/
chmod -R 755 /workspace/

echo "EFS initialization completed successfully"
echo "Files in workspace:"
ls -la /workspace/

# Exit successfully to mark the task as completed
exit 0