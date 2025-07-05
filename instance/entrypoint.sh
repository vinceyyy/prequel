#!/bin/bash

# Set default scenario based on environment variable
SCENARIO=${SCENARIO:-python}
WORKSPACE_PATH="/workspaces/${SCENARIO}"

# Ensure the workspace exists
if [ ! -d "$WORKSPACE_PATH" ]; then
    echo "Warning: Scenario '${SCENARIO}' not found, defaulting to python"
    WORKSPACE_PATH="/workspaces/python"
fi

echo "Starting code-server for scenario: ${SCENARIO}"
echo "Workspace path: ${WORKSPACE_PATH}"
echo "Access URL will be available on port 8443"

# Start code-server with the selected workspace
exec /usr/bin/entrypoint.sh \
    --bind-addr 0.0.0.0:8443 \
    --auth password \
    --disable-telemetry \
    --disable-update-check \
    "$WORKSPACE_PATH"