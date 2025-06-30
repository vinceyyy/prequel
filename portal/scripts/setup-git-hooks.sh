#!/bin/bash

# Setup Git Hooks for Local Testing
# This creates a pre-commit hook that runs quick tests

echo "🔧 Setting up Git hooks for automatic testing"
echo "============================================="

# Check if we're in a git repository
if [ ! -d "../.git" ]; then
    echo "❌ Error: Not in a git repository"
    exit 1
fi

# Create pre-commit hook
cat > ../.git/hooks/pre-commit << 'EOF'
#!/bin/bash

echo "🧪 Running pre-commit tests..."

cd portal

# Run quick tests
npm run test:quick

if [ $? -ne 0 ]; then
    echo "❌ Tests failed! Commit aborted."
    echo "Fix the issues and try again, or use 'git commit --no-verify' to skip tests."
    exit 1
fi

echo "✅ All tests passed! Proceeding with commit."
EOF

# Make the hook executable
chmod +x ../.git/hooks/pre-commit

echo "✅ Pre-commit hook installed!"
echo ""
echo "Now, every time you commit, the quick test suite will run automatically."
echo "To skip tests for a commit, use: git commit --no-verify"
echo ""
echo "To manually run the same tests: npm run test:quick"