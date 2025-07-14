#!/bin/bash

set -e

# Set default challenge based on environment variable
S3_BUCKET=${S3_CHALLENGE_BUCKET:-${PROJECT_PREFIX}-challenge}
AWS_REGION=${AWS_REGION:-"us-east-1"}
WORKSPACE_PATH="/workspaces/${CHALLENGE}"

echo "Starting code-server for challenge: ${CHALLENGE}"
echo "S3 bucket: ${S3_BUCKET}"
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
	if aws s3 sync "s3://${S3_BUCKET}/${challenge_name}/" "$workspace_dir/" --region "$AWS_REGION"; then
		echo "✅ Successfully downloaded challenge: ${challenge_name}"
	else
		echo "❌ Failed to download challenge: ${challenge_name}"
		echo "Available challenges in S3:"
		aws s3 ls "s3://${S3_BUCKET}/" --region "$AWS_REGION" || echo "Could not list S3 contents"
		return 1
	fi

	# Install dependencies based on challenge type
	if [ -f "${workspace_dir}/requirements.txt" ]; then
		echo "Installing Python dependencies..."
		cat "${workspace_dir}/requirements.txt"
		cd "${workspace_dir}"
		# python3 -m pip install --upgrade pip --break-system-packages --user
		# python3 -m pip install -r requirements.txt --break-system-packages --user
		python3 -m venv .venv
		source .venv/bin/activate
		python3 -m pip install -r requirements.txt
		echo "✅ Python dependencies installed"
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
if ! setup_challenge "$CHALLENGE"; then
	echo "Failed to setup challenge: ${CHALLENGE}"
	echo "Falling back to default python challenge..."
	if ! setup_challenge "python"; then
		echo "Failed to setup fallback challenge. Creating empty workspace..."
		mkdir -p "$WORKSPACE_PATH"
		chown -R coder:coder "$WORKSPACE_PATH"
	else
		CHALLENGE="python"
		WORKSPACE_PATH="/workspaces/python"
	fi
fi

echo "🚀 Starting code-server..."
echo "Challenge: ${CHALLENGE}"
echo "Workspace: ${WORKSPACE_PATH}"
echo "Access URL will be available on port 8443"

# Start code-server with the selected workspace
exec /usr/bin/entrypoint.sh \
	--bind-addr 0.0.0.0:8443 \
	--auth password \
	--disable-telemetry \
	--disable-update-check \
	"$WORKSPACE_PATH"
