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

# Install Python if python scenario and not already installed
if [ "$SCENARIO" = "python" ] && ! command -v python3 &> /dev/null; then
    echo "Installing Python and dependencies..."
    sudo apt-get update && sudo apt-get install -y python3 python3-pip
    cd /workspaces/python && python3 -m pip install -r requirements.txt --break-system-packages
fi

# Install Node.js dependencies if not already installed
if [ "$SCENARIO" = "javascript" ] && [ ! -d "/workspaces/javascript/node_modules" ]; then
    echo "Installing JavaScript dependencies..."
    cd /workspaces/javascript && npm install
fi

if [ "$SCENARIO" = "fullstack" ] && [ -f "/workspaces/fullstack/package.json" ] && [ ! -d "/workspaces/fullstack/node_modules" ]; then
    echo "Installing fullstack dependencies..."
    cd /workspaces/fullstack && npm install
fi

echo "Access URL will be available on port 8443"

# Start code-server with the selected workspace
exec /usr/bin/entrypoint.sh \
    --bind-addr 0.0.0.0:8443 \
    --auth password \
    --disable-telemetry \
    --disable-update-check \
    "$WORKSPACE_PATH"