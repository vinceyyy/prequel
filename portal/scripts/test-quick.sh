#!/bin/bash

# Quick Local Testing Script
# Run essential tests for fast feedback during development

set -e

echo "⚡ Quick Test Suite"
echo "=================="

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the portal directory"
    exit 1
fi

echo
echo "📋 Code Quality"
echo "--------------"
npm run format:check && echo "✅ Format check passed"
npm run lint && echo "✅ Linting passed"

echo
echo "🧪 Unit Tests"
echo "------------"
npm run test && echo "✅ Unit tests passed"

echo
echo "🏗️  Build Check"
echo "-------------"
npm run build && echo "✅ Build successful"

echo
echo "✨ Quick tests completed!"