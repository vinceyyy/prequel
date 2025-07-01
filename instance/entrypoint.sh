#!/bin/bash

# Set default scenario based on environment variable
SCENARIO=${SCENARIO:-javascript}
WORKSPACE_PATH="/workspaces/${SCENARIO}"

# Ensure the workspace exists
if [ ! -d "$WORKSPACE_PATH" ]; then
    echo "Warning: Scenario '${SCENARIO}' not found, defaulting to javascript"
    WORKSPACE_PATH="/workspaces/javascript"
fi

echo "Starting code-server for scenario: ${SCENARIO}"
echo "Workspace path: ${WORKSPACE_PATH}"
echo "Access URL will be available on port 8080"

# Start code-server with the selected workspace
exec /usr/bin/entrypoint.sh \
    --bind-addr 0.0.0.0:8080 \
    --auth password \
    --disable-telemetry \
    --disable-update-check \
    "$WORKSPACE_PATH"