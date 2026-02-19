# Fix speakTTS calls that still use object syntax
$files = Get-ChildItem -Path "components\game" -Recurse -Filter "*.tsx"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $original = $content
    
    # Fix speakTTS(text, { rate }) -> speakTTS(text, rate)
    $content = $content -replace "speakTTS\(([^,]+),\s*\{\s*rate\s*:\s*([^}]+)\s*\}\)", 'speakTTS($1, $2)'
    
    if ($content -ne $original) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "Fixed: $($file.Name)"
    }
}

Write-Host "Done!"
