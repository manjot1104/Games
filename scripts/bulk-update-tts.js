/**
 * Bulk update script to replace expo-speech with shared TTS utility
 * Run with: node scripts/bulk-update-tts.js
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

// Find all .tsx files in components/game that import expo-speech
const files = glob.sync('components/game/**/*.tsx', { cwd: __dirname + '/..' });

let updatedCount = 0;
let errorCount = 0;

files.forEach(filePath => {
  try {
    const fullPath = path.join(__dirname, '..', filePath);
    let content = fs.readFileSync(fullPath, 'utf8');
    let modified = false;

    // Check if file imports expo-speech
    if (!content.includes("import * as Speech from 'expo-speech'")) {
      return; // Skip files that don't use expo-speech
    }

    // 1. Replace import statement
    if (content.includes("import * as Speech from 'expo-speech'")) {
      // Check if already has TTS import
      if (!content.includes("from '@/utils/tts'")) {
        // Find the import line and replace it
        content = content.replace(
          /import \* as Speech from 'expo-speech';/g,
          "import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';"
        );
        modified = true;
      } else {
        // Just remove the expo-speech import
        content = content.replace(/import \* as Speech from 'expo-speech';\n?/g, '');
        modified = true;
      }
    }

    // 2. Replace Speech.speak calls
    // Pattern: Speech.speak('text', { rate: 0.75, language: 'en-US' })
    content = content.replace(
      /Speech\.speak\(([^,]+),\s*\{\s*rate:\s*([^,}]+)(?:,\s*language:\s*([^}]+))?\s*\}\)/g,
      (match, text, rate, lang) => {
        const langParam = lang ? `, ${lang.trim()}` : '';
        return `speakTTS(${text.trim()}, ${rate.trim()}${langParam})`;
      }
    );

    // Pattern: Speech.speak('text', { rate: 0.75 })
    content = content.replace(
      /Speech\.speak\(([^,]+),\s*\{\s*rate:\s*([^}]+)\s*\}\)/g,
      (match, text, rate) => {
        return `speakTTS(${text.trim()}, ${rate.trim()})`;
      }
    );

    // Pattern: Speech.speak('text')
    content = content.replace(
      /Speech\.speak\(([^)]+)\)/g,
      (match, text) => {
        return `speakTTS(${text.trim()})`;
      }
    );

    // 3. Replace Speech.stop() calls
    if (content.includes('Speech.stop()')) {
      content = content.replace(/Speech\.stop\(\)/g, 'stopTTS()');
      modified = true;
    }

    // 4. Update local speak functions that use Speech.speak
    // Pattern: const speak = (text: string, rate = DEFAULT_TTS_RATE) => { ... Speech.speak(...) ... }
    if (content.includes('const speak') && content.includes('Speech.speak')) {
      // Replace Speech.speak with speakTTS in local speak functions
      content = content.replace(
        /Speech\.speak\(([^,]+),\s*\{\s*rate\s*:\s*([^}]+)\s*\}\)/g,
        (match, text, rate) => {
          return `speakTTS(${text.trim()}, ${rate.trim()})`;
        }
      );
      modified = true;
    }

    // 5. Remove local DEFAULT_TTS_RATE if it's defined and we're importing it
    if (content.includes("from '@/utils/tts'") && content.includes('DEFAULT_TTS_RATE')) {
      // Remove const DEFAULT_TTS_RATE = 0.75; if it exists
      content = content.replace(/const DEFAULT_TTS_RATE\s*=\s*[\d.]+;\s*\n?/g, '');
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(fullPath, content, 'utf8');
      updatedCount++;
      console.log(`✓ Updated: ${filePath}`);
    }
  } catch (error) {
    console.error(`✗ Error updating ${filePath}:`, error.message);
    errorCount++;
  }
});

console.log(`\n✅ Updated ${updatedCount} files`);
if (errorCount > 0) {
  console.log(`⚠️  ${errorCount} files had errors`);
}
