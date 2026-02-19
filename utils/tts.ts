/**
 * Shared TTS utility for the entire app
 * Uses speech-to-speech TTS on web, falls back to expo-speech for native or on failure
 */

import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

// TTS state (singleton pattern)
let ttsLogic: any = null;
let sharedAudioPlayer: any = null;
let ttsReady = false;
let isInitializing = false;
let initPromise: Promise<void> | null = null;

// Default TTS rate
export const DEFAULT_TTS_RATE = 0.75;

// Scheduled speech timers (for sequence support)
let scheduledSpeechTimers: ReturnType<typeof setTimeout>[] = [];

/**
 * Wait for onnxruntime-web to be loaded from CDN
 */
function waitForONNXRuntime(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }

    // Check if already loaded
    if ((window as any).ort) {
      console.log('[TTS] onnxruntime-web already loaded');
      resolve();
      return;
    }

    // Wait for it to load
    const checkOrt = () => {
      if ((window as any).ort) {
        console.log('[TTS] onnxruntime-web loaded from CDN');
        resolve();
      } else {
        setTimeout(checkOrt, 100);
      }
    };

    // Also listen for the ready event
    if (typeof window !== 'undefined') {
      const onOrtReady = () => {
        window.removeEventListener('ortReady', onOrtReady);
        resolve();
      };
      window.addEventListener('ortReady', onOrtReady);
    }

    checkOrt();
  });
}

/**
 * Initialize speech-to-speech TTS (web only)
 * This is called automatically on first use
 */
async function initializeTTS(): Promise<void> {
  // Only initialize once
  if (isInitializing && initPromise) {
    return initPromise;
  }

  if (ttsReady || ttsLogic) {
    return;
  }

  // Only run in browser
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof navigator === 'undefined') {
    return;
  }

  isInitializing = true;

  initPromise = (async () => {
    try {
      // Wait for onnxruntime-web to be available
      await waitForONNXRuntime();

      // Import speech-to-speech
      const { TTSLogic, sharedAudioPlayer: audioPlayer } = await import('speech-to-speech');

      // Configure shared audio player with auto-play
      audioPlayer.configure({
        autoPlay: true,
        sampleRate: 22050,
        volume: 1.0,
      });

      // Initialize TTS with a voice
      const tts = new TTSLogic({
        voiceId: 'en_US-hfc_female-medium',
        warmUp: true,
      });

      await tts.initialize();

      // Store references
      ttsLogic = tts;
      sharedAudioPlayer = audioPlayer;
      ttsReady = true;

      console.log('[TTS] speech-to-speech TTS initialized successfully');
    } catch (err) {
      console.warn('[TTS] Failed to initialize speech-to-speech TTS:', err);
      ttsReady = false;
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
}

/**
 * Stop all current TTS playback
 */
export function stopTTS(): void {
  try {
    // Clear scheduled timers
    scheduledSpeechTimers.forEach(t => clearTimeout(t));
    scheduledSpeechTimers = [];

    if (Platform.OS === 'web' && sharedAudioPlayer && ttsReady) {
      // Stop speech-to-speech audio
      sharedAudioPlayer.stopAndClearQueue().catch((err: any) => {
        console.warn('[TTS] Error stopping audio player:', err);
      });
    }

    // Stop expo-speech (works on both web and native)
    Speech.stop();
  } catch (e) {
    console.warn('[TTS] Error stopping TTS:', e);
  }
}

/**
 * Clear scheduled speech timers
 */
export function clearScheduledSpeech(): void {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  stopTTS();
}

/**
 * Speak text using the best available TTS
 * @param text - Text to speak
 * @param rate - Speech rate (0.4-1.5, default 0.75)
 * @param language - Language code (optional, for expo-speech fallback)
 */
export async function speak(text: string, rate: number = DEFAULT_TTS_RATE, language?: string): Promise<void> {
  if (!text || text.trim().length === 0) {
    return;
  }

  try {
    // Stop any current playback
    stopTTS();

    // Try to use speech-to-speech TTS on web
    if (Platform.OS === 'web') {
      // Initialize if not already initialized
      if (!ttsReady && !isInitializing) {
        await initializeTTS();
      }

      // If TTS is ready, use it
      if (ttsLogic && sharedAudioPlayer && ttsReady) {
        try {
          const result = await ttsLogic.synthesize(text);
          sharedAudioPlayer.addAudioIntoQueue(result.audio, result.sampleRate);
          return;
        } catch (error) {
          console.warn('[TTS] speech-to-speech TTS failed, falling back to expo-speech:', error);
          // Fall through to expo-speech
        }
      }
    }

    // Fallback to expo-speech (native platforms or if speech-to-speech fails)
    Speech.speak(text, {
      language: language,
      rate: rate,
      pitch: 1.02,
    });
  } catch (e) {
    console.warn('[TTS] speak error:', e);
  }
}

/**
 * Speak a sequence of texts with gaps between them
 * @param texts - Array of texts to speak
 * @param rate - Speech rate (default 0.75)
 * @param gapMs - Gap between texts in milliseconds (default 450)
 */
export function speakSequence(texts: string[], rate: number = DEFAULT_TTS_RATE, gapMs: number = 450): void {
  try {
    clearScheduledSpeech();
    if (!texts || texts.length === 0) return;

    // Speak first immediately
    speak(texts[0], rate);

    // Schedule subsequent items
    for (let i = 1; i < texts.length; i++) {
      const delay = gapMs * i;
      const timer = setTimeout(() => {
        speak(texts[i], rate);
      }, delay);
      scheduledSpeechTimers.push(timer);
    }
  } catch (e) {
    console.warn('[TTS] speakSequence error:', e);
  }
}

/**
 * Cleanup TTS resources (call on app unmount)
 */
export async function cleanupTTS(): Promise<void> {
  try {
    stopTTS();

    if (ttsLogic) {
      await ttsLogic.dispose().catch((err: any) => {
        console.warn('[TTS] Error disposing TTS:', err);
      });
      ttsLogic = null;
    }

    if (sharedAudioPlayer) {
      await sharedAudioPlayer.stopAndClearQueue().catch((err: any) => {
        console.warn('[TTS] Error stopping audio player:', err);
      });
      sharedAudioPlayer = null;
    }

    ttsReady = false;
    isInitializing = false;
    initPromise = null;
  } catch (e) {
    console.warn('[TTS] cleanup error:', e);
  }
}

/**
 * Pre-initialize TTS (optional, for faster first use)
 * Call this early in the app lifecycle if you want TTS ready immediately
 */
export async function preInitializeTTS(): Promise<void> {
  if (Platform.OS === 'web' && !ttsReady && !isInitializing) {
    await initializeTTS();
  }
}
