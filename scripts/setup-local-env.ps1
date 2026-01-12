# PowerShell script for Windows
# Setup script for local development environment

Write-Host "🔧 Setting up local development environment..." -ForegroundColor Cyan

# Create .env.local file
$envContent = @"
# Local Development Environment Variables
# This file is for local testing only - DO NOT commit to git

# Use localhost for local backend testing
EXPO_PUBLIC_API_BASE_URL=http://localhost:4000

# For testing on physical devices, use your computer's local IP:
# EXPO_PUBLIC_API_BASE_URL=http://192.168.1.3:4000
# (Replace 192.168.1.3 with your actual local IP address)
"@

$envContent | Out-File -FilePath ".env.local" -Encoding utf8

Write-Host "✅ Created .env.local file" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Current configuration:" -ForegroundColor Yellow
Write-Host "   EXPO_PUBLIC_API_BASE_URL=http://localhost:4000"
Write-Host ""
Write-Host "🚀 To start local development:" -ForegroundColor Cyan
Write-Host "   1. Make sure your backend is running on http://localhost:4000"
Write-Host "   2. Run: npm start"
Write-Host ""
Write-Host "💡 To switch to production, set EXPO_PUBLIC_API_BASE_URL in your deployment platform" -ForegroundColor Yellow




