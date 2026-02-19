# Fix remaining speakTTS calls with object syntax
$files = Get-ChildItem -Path "components\game" -Recurse -Filter "*.tsx"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $original = $content
    
    # Fix speakTTS(text, { rate }) -> speakTTS(text, rate)
    $content = $content -replace 'speakTTS\(([^,]+),\s*\{\s*rate\s*\}\)', 'speakTTS($1, rate)'
    
    if ($content -ne $original) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "Fixed: $($file.Name)"
    }
}

Write-Host "Done!"
