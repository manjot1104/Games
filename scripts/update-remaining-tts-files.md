# Remaining TTS Files Update Guide

Due to the large number of files (100+), here's a systematic approach to update them all.

## Pattern to Apply

For each file:

1. **Replace import:**
   ```typescript
   // OLD:
   import * as Speech from 'expo-speech';
   
   // NEW:
   import { speak as speakTTS, clearScheduledSpeech, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
   ```

2. **Replace Speech.speak calls:**
   ```typescript
   // OLD:
   Speech.speak('text', { rate: 0.75 });
   Speech.speak('text');
   
   // NEW:
   speakTTS('text', 0.75);
   speakTTS('text');
   ```

3. **Replace Speech.stop calls:**
   ```typescript
   // OLD:
   Speech.stop();
   
   // NEW:
   stopTTS();
   ```

4. **Remove old TTS helper functions** if they exist and replace with:
   ```typescript
   // Use shared TTS utility (speech-to-speech on web, expo-speech on native)
   // Imported from @/utils/tts
   ```

## Files Already Updated:
- ✅ All core app files
- ✅ Speech therapy level 1 games
- ✅ BeatMatchTapGame, BigPathTraceGame, BigSwipeVsSmallSwipeGame, BigTapVsSmallTapGame
- ✅ InstrumentChoiceGame, LightTheLaserGame, RainDropSlideGame, RoadRollerGame, StartStopLineGame, TrainTrackLineGame

## Remaining Files (100+):
All files in `components/game/occupational/` and `components/game/speech/` that still use `Speech.speak` or `import * as Speech from 'expo-speech'`.
