# Fix remaining Speech.stop() calls
$files = Get-ChildItem -Path "components\game" -Recurse -Filter "*.tsx"

foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $original = $content
    
    # Fix Speech.stop() -> stopTTS()
    $content = $content -replace 'Speech\.stop\(\)', 'stopTTS()'
    
    if ($content -ne $original) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "Fixed: $($file.Name)"
    }
}

Write-Host "Done!"
