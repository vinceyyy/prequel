#!/bin/bash

# Local Testing Script for Prequel Portal
# Run all tests locally before committing

set -e

echo "🧪 Running Prequel Portal Test Suite"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the portal directory"
    exit 1
fi

echo
echo "📋 Step 1: Code Quality Checks"
echo "------------------------------"
echo "Running Prettier format check..."
npm run format:check
echo "✅ Format check passed"

echo "Running ESLint..."
npm run lint
echo "✅ Linting passed"

echo
echo "🏗️  Step 2: Build Check"
echo "---------------------"
echo "Building application..."
npm run build
echo "✅ Build successful"

echo
echo "🧪 Step 3: Unit Tests"
echo "-------------------"
echo "Running Jest unit tests..."
npm run test
echo "✅ Unit tests passed"

echo
echo "🎭 Step 4: E2E Tests"
echo "------------------"
echo "Installing Playwright browsers (if needed)..."
npx playwright install --with-deps chromium

echo "Running Playwright E2E tests..."
npm run test:e2e
echo "✅ E2E tests passed"

echo
echo "🎉 All tests passed! Ready to commit."
echo "====================================="