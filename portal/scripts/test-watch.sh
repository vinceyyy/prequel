#!/bin/bash

# Development Testing Script
# Watch mode for continuous testing during development

echo "👀 Development Watch Mode"
echo "========================"
echo "This will run tests automatically when files change."
echo "Press Ctrl+C to stop."
echo

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
	echo "❌ Error: Please run this script from the portal directory"
	exit 1
fi

# Run Jest in watch mode
npm run test:watch
