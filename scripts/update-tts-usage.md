# TTS Migration Guide

This guide helps update all game components to use the shared TTS utility.

## Pattern to Replace

### Old Pattern (Remove):
```typescript
import * as Speech from 'expo-speech';
// ... other imports ...

const DEFAULT_TTS_RATE = 0.75;
let scheduledSpeechTimers: ReturnType<typeof setTimeout>[] = [];
let webSpeechSynthesis: SpeechSynthesis | null = null;
let webUtterance: SpeechSynthesisUtterance | null = null;
let webTTSActivated = false;

// Initialize web speech synthesis
if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
  webSpeechSynthesis = window.speechSynthesis;
}

function activateWebTTS(callback?: () => void) {
  // ... activation code ...
}

function clearScheduledSpeech() {
  // ... cleanup code ...
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  // ... TTS implementation ...
}
```

### New Pattern (Add):
```typescript
import { speak as speakTTS, clearScheduledSpeech, DEFAULT_TTS_RATE } from '@/utils/tts';
// Remove: import * as Speech from 'expo-speech';

// Use shared TTS utility (speech-to-speech on web, expo-speech on native)
// Imported from @/utils/tts

// Wrapper function for backward compatibility (if needed)
function speak(text: string, rate = DEFAULT_TTS_RATE) {
  speakTTS(text, rate);
}
```

## Files Already Updated:
- ✅ `app/(tabs)/Games.tsx`
- ✅ `app/(tabs)/AACgrid.tsx`
- ✅ `components/game/speech/level1/session1/FollowTheBall.tsx`
- ✅ `components/game/speech/level1/session1/CatchTheBouncingStar.tsx`

## Files That Need Updates:
All files in `components/game/` that use `Speech.speak` or have local TTS implementations.
