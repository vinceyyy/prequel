#!/bin/bash

set -e

# Set default scenario based on environment variable
SCENARIO=${SCENARIO:-python}
S3_BUCKET=${S3_SCENARIO_BUCKET:-prequel-scenario}
AWS_REGION=${AWS_REGION:-your-aws-region}
WORKSPACE_PATH="/workspaces/${SCENARIO}"

echo "Starting code-server for scenario: ${SCENARIO}"
echo "S3 bucket: ${S3_BUCKET}"
echo "Workspace path: ${WORKSPACE_PATH}"

# Function to download and setup scenario
setup_scenario() {
    local scenario_name=$1
    local workspace_dir="/workspaces/${scenario_name}"
    
    echo "Setting up scenario: ${scenario_name}"
    
    # Create workspace directory
    mkdir -p "$workspace_dir"
    
    # Download scenario files from S3
    echo "Downloading scenario files from S3..."
    if aws s3 sync "s3://${S3_BUCKET}/${scenario_name}/" "$workspace_dir/" --region "$AWS_REGION"; then
        echo "✅ Successfully downloaded scenario: ${scenario_name}"
    else
        echo "❌ Failed to download scenario: ${scenario_name}"
        echo "Available scenarios in S3:"
        aws s3 ls "s3://${S3_BUCKET}/" --region "$AWS_REGION" || echo "Could not list S3 contents"
        return 1
    fi
    
    # Install dependencies based on scenario type
    case "$scenario_name" in
        "python")
            if [ -f "$workspace_dir/requirements.txt" ]; then
                echo "Installing Python dependencies..."
                cd "$workspace_dir"
                python3 -m pip install --upgrade pip --break-system-packages --user
                python3 -m pip install -r requirements.txt --break-system-packages --user
                echo "✅ Python dependencies installed"
            fi
            ;;
        "javascript")
            if [ -f "$workspace_dir/package.json" ]; then
                echo "Installing Node.js dependencies..."
                cd "$workspace_dir"
                npm install
                echo "✅ Node.js dependencies installed"
            fi
            ;;
        "sql")
            echo "✅ SQL scenario ready (no dependencies needed)"
            ;;
        *)
            echo "⚠️  Unknown scenario type: ${scenario_name}"
            ;;
    esac
    
    # Set proper ownership
    chown -R coder:coder "$workspace_dir"
    
    return 0
}

# Download and setup the selected scenario
if ! setup_scenario "$SCENARIO"; then
    echo "Failed to setup scenario: ${SCENARIO}"
    echo "Falling back to default python scenario..."
    if ! setup_scenario "python"; then
        echo "Failed to setup fallback scenario. Creating empty workspace..."
        mkdir -p "$WORKSPACE_PATH"
        chown -R coder:coder "$WORKSPACE_PATH"
    else
        SCENARIO="python"
        WORKSPACE_PATH="/workspaces/python"
    fi
fi

echo "🚀 Starting code-server..."
echo "Scenario: ${SCENARIO}"
echo "Workspace: ${WORKSPACE_PATH}"
echo "Access URL will be available on port 8443"

# Start code-server with the selected workspace
exec /usr/bin/entrypoint.sh \
    --bind-addr 0.0.0.0:8443 \
    --auth password \
    --disable-telemetry \
    --disable-update-check \
    "$WORKSPACE_PATH"