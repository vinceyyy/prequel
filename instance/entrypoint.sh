#!/bin/bash

set -e

# Set default challenge based on environment variable
AWS_REGION=${AWS_REGION:-"us-east-1"}
WORKSPACE_PATH="/workspaces/${CHALLENGE_KEY}"

echo "Starting code-server for challenge: ${CHALLENGE_KEY}"
echo "S3 bucket: ${CHALLENGE_BUCKET}"
echo "Workspace path: ${WORKSPACE_PATH}"

# Function to download and setup challenge
setup_challenge() {
	local challenge_name=$1
	local workspace_dir="/workspaces/${challenge_name}"

	echo "Setting up challenge: ${challenge_name}"

	# Create workspace directory
	mkdir -p "$workspace_dir"

	# Download challenge files from S3
	echo "Downloading challenge files from S3..."
	if aws s3 sync "s3://${CHALLENGE_BUCKET}/${challenge_name}/" "$workspace_dir/" --region "$AWS_REGION"; then
		echo "✅ Successfully downloaded challenge: ${challenge_name}"
	else
		echo "❌ Failed to download challenge: ${challenge_name}"
		echo "Available challenges in S3:"
		aws s3 ls "s3://${CHALLENGE_BUCKET}/" --region "$AWS_REGION" || echo "Could not list S3 contents"
		return 1
	fi

	# Install dependencies based on challenge type
	if [ -f "${workspace_dir}/requirements.txt" ]; then
		echo "Installing Python dependencies..."
		cat "${workspace_dir}/requirements.txt"
		cd "${workspace_dir}"
		python3 -m venv .venv
		source .venv/bin/activate
		python3 -m pip install -r requirements.txt
		echo "✅ Python dependencies installed via pip"
	fi
	if [ -f "${workspace_dir}/pyproject.toml" ]; then
		echo "Installing Python dependencies..."
		cat "${workspace_dir}/pyproject.toml"
		cd "${workspace_dir}"
		uv sync --all-groups
		echo "✅ Python dependencies installed via uv"
	fi
	if [ -f "$workspace_dir/package.json" ]; then
		echo "Installing Node.js dependencies..."
		cd "$workspace_dir"
		npm install
		echo "✅ Node.js dependencies installed"
	fi

	# Set proper ownership
	chown -R coder:coder "$workspace_dir"

	return 0
}

# Download and setup the selected challenge
if ! setup_challenge "$CHALLENGE_KEY"; then
	echo "Failed to setup challenge: ${CHALLENGE_KEY}"
	echo "Falling back to default empty workspace..."
	CHALLENGE_KEY="default"
	WORKSPACE_PATH="/workspaces/default"
fi

echo "🚀 Starting code-server..."
echo "Challenge: ${CHALLENGE_KEY}"
echo "Workspace: ${WORKSPACE_PATH}"
echo "Access URL will be available on port 8443"

# Start code-server with the selected workspace
exec /usr/bin/entrypoint.sh \
	--bind-addr 0.0.0.0:8443 \
	--auth password \
	--disable-telemetry \
	--disable-update-check \
	"$WORKSPACE_PATH"
