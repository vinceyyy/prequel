#!/bin/bash
#
# Gitleaks Setup Script
# Installs gitleaks and sets up the pre-commit hook
#

set -e

echo "🔐 Gitleaks Security Setup"
echo "=========================="
echo ""

# Check if gitleaks is already installed
if command -v gitleaks &> /dev/null; then
    INSTALLED_VERSION=$(gitleaks version)
    echo "✅ Gitleaks is already installed (version $INSTALLED_VERSION)"
else
    echo "📦 Installing gitleaks..."

    # Detect OS and install accordingly
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install gitleaks
            echo "✅ Gitleaks installed via Homebrew"
        else
            echo "❌ Homebrew not found. Please install Homebrew first:"
            echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        echo "📥 Downloading gitleaks for Linux..."
        GITLEAKS_VERSION="8.29.0"
        wget "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
        tar -xzf "gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
        sudo mv gitleaks /usr/local/bin/
        rm "gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
        echo "✅ Gitleaks installed to /usr/local/bin/"
    else
        echo "❌ Unsupported operating system: $OSTYPE"
        echo "Please install gitleaks manually:"
        echo "  https://github.com/gitleaks/gitleaks#installation"
        exit 1
    fi
fi

# Verify installation
if ! command -v gitleaks &> /dev/null; then
    echo "❌ Gitleaks installation failed"
    exit 1
fi

echo ""
echo "📋 Verifying configuration..."

# Check if .gitleaks.toml exists
if [ -f ".gitleaks.toml" ]; then
    echo "✅ Gitleaks configuration found (.gitleaks.toml)"
else
    echo "❌ .gitleaks.toml not found in repository root"
    exit 1
fi

# Check if pre-commit hook exists, if not install it
if [ -f ".git/hooks/pre-commit" ]; then
    echo "✅ Pre-commit hook already installed"
else
    echo "📦 Installing pre-commit hook..."
    if [ -f "scripts/pre-commit.template" ]; then
        cp scripts/pre-commit.template .git/hooks/pre-commit
        chmod +x .git/hooks/pre-commit
        echo "✅ Pre-commit hook installed from template"
    else
        echo "❌ Hook template not found (scripts/pre-commit.template)"
        exit 1
    fi
fi

# Ensure hook is executable
chmod +x .git/hooks/pre-commit

echo ""
echo "🧪 Testing configuration..."

# Test gitleaks with current repository
gitleaks detect --config .gitleaks.toml --no-git > /dev/null 2>&1
TEST_EXIT_CODE=$?

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo "✅ Gitleaks test passed - no secrets detected in current files"
elif [ $TEST_EXIT_CODE -eq 1 ]; then
    echo "⚠️  Gitleaks detected potential secrets in current files"
    echo "Run 'gitleaks detect --config .gitleaks.toml' to see details"
else
    echo "⚠️  Gitleaks test returned unexpected exit code: $TEST_EXIT_CODE"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📖 Next steps:"
echo "  1. Read SECURITY.md for credential management guidelines"
echo "  2. Copy .env.example to .env.local and add your credentials"
echo "  3. Copy terraform.tfvars.example to terraform.tfvars (if using infrastructure)"
echo ""
echo "🔍 Testing the hook:"
echo "  Try committing a file with a fake secret to verify the hook works"
echo ""
echo "💡 Remember:"
echo "  - Test credentials should use 'sk-test*' or 'sk-admin-test*' prefix"
echo "  - Never commit .env.local, terraform.tfvars, or backend.config files"
echo "  - The pre-commit hook will scan staged files before each commit"
echo ""
