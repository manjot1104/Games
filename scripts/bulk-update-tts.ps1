# PowerShell script to bulk update TTS imports and calls
# Run with: powershell -ExecutionPolicy Bypass -File scripts/bulk-update-tts.ps1

$files = Get-ChildItem -Path "components\game" -Recurse -Filter "*.tsx" | Where-Object {
    $content = Get-Content $_.FullName -Raw
    $content -match "import \* as Speech from 'expo-speech'"
}

$updatedCount = 0
$errorCount = 0

foreach ($file in $files) {
    try {
        $content = Get-Content $file.FullName -Raw
        $originalContent = $content
        $modified = $false

        # 1. Replace import statement
        if ($content -match "import \* as Speech from 'expo-speech'") {
            if ($content -notmatch "from '@/utils/tts'") {
                # Add TTS import if not present
                $content = $content -replace "import \* as Speech from 'expo-speech';", "import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';"
                $modified = $true
            } else {
                # Just remove expo-speech import
                $content = $content -replace "import \* as Speech from 'expo-speech';\s*\r?\n?", ""
                $modified = $true
            }
        }

        # 2. Replace Speech.speak calls with language parameter
        $content = $content -replace "Speech\.speak\(([^,]+),\s*\{\s*rate:\s*([^,}]+),\s*language:\s*([^}]+)\s*\}\)", 'speakTTS($1, $2, $3)'
        
        # 3. Replace Speech.speak calls with just rate
        $content = $content -replace "Speech\.speak\(([^,]+),\s*\{\s*rate:\s*([^}]+)\s*\}\)", 'speakTTS($1, $2)'
        
        # 4. Replace Speech.speak calls without options
        $content = $content -replace "Speech\.speak\(([^)]+)\)", 'speakTTS($1)'

        # 5. Replace Speech.stop() calls
        if ($content -match "Speech\.stop\(\)") {
            $content = $content -replace "Speech\.stop\(\)", "stopTTS()"
            $modified = $true
        }

        # 6. Update local speak functions that use Speech.speak
        if ($content -match "const speak" -and $content -match "Speech\.speak") {
            # Already handled by regex above, but ensure we're using speakTTS
            $content = $content -replace "Speech\.speak\(([^,]+),\s*\{\s*rate\s*:\s*([^}]+)\s*\}\)", 'speakTTS($1, $2)'
            $modified = $true
        }

        # 7. Remove local DEFAULT_TTS_RATE if importing from utils/tts
        if ($content -match "from '@/utils/tts'" -and $content -match "DEFAULT_TTS_RATE") {
            $content = $content -replace "const DEFAULT_TTS_RATE\s*=\s*[\d.]+\s*;\s*\r?\n?", ""
            $modified = $true
        }

        if ($modified) {
            Set-Content -Path $file.FullName -Value $content -NoNewline
            $updatedCount++
            Write-Host "Updated: $($file.FullName)" -ForegroundColor Green
        }
    } catch {
        $errorCount++
        Write-Host "Error updating $($file.FullName): $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Updated $updatedCount files" -ForegroundColor Green
if ($errorCount -gt 0) {
    Write-Host "$errorCount files had errors" -ForegroundColor Yellow
}
