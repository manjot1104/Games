#!/bin/bash
# Setup script for local development environment

echo "🔧 Setting up local development environment..."

# Create .env.local file
cat > .env.local << EOF
# Local Development Environment Variables
# This file is for local testing only - DO NOT commit to git

# Use localhost for local backend testing
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000

# For testing on physical devices, use your computer's local IP:
# EXPO_PUBLIC_API_BASE_URL=http://192.168.1.3:4000
# (Replace 192.168.1.3 with your actual local IP address)
EOF

echo "✅ Created .env.local file"
echo ""
echo "📝 Current configuration:"
echo "   EXPO_PUBLIC_API_BASE_URL=http://localhost:4000"
echo ""
echo "🚀 To start local development:"
echo "   1. Make sure your backend is running on http://localhost:4000"
echo "   2. Run: npm start"
echo ""
echo "💡 To switch to production, set EXPO_PUBLIC_API_BASE_URL in your deployment platform"




