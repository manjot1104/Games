import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Ionicons } from '@expo/vector-icons';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import CongratulationsScreen from '@/components/game/CongratulationsScreen';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredTaps?: number;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const INSTRUMENT_SIZE = 160;
const DEFAULT_TTS_RATE = 0.75;

type InstrumentType = 'drum' | 'bell' | 'horn' | 'tambourine' | 'piano';

let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    Speech.stop();
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    Speech.speak(text, { rate });
  } catch (e) {
    console.warn('speak error', e);
  }
}

const useSoundEffect = (uri: string | number) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);
  const webAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const ensureSound = useCallback(async () => {
    // Skip if no sound URL provided (will use TTS instead)
    if (!uri || (typeof uri === 'string' && uri.trim() === '')) {
      return;
    }
    
    if (soundRef.current || isLoaded) return;
    
    if (Platform.OS === 'web') {
      // Use HTML5 Audio API for web
      // For local assets (require()), we need to get the actual URL
      try {
        let audioUrl = '';
        if (typeof uri === 'string') {
          audioUrl = uri;
        } else if (typeof uri === 'number') {
          // For require() on web, Metro bundler should provide a URL
          // Try to resolve it - this may need adjustment based on your setup
          // For now, we'll skip web loading of local files and use TTS fallback
          console.log('Local sound file on web - will use TTS fallback');
          return;
        }
        
        if (audioUrl) {
          const audio = new Audio(audioUrl);
          audio.volume = 0.9;
          audio.preload = 'auto';
          webAudioRef.current = audio;
          setIsLoaded(true);
          console.log('Web sound loaded successfully:', uri);
        }
      } catch (e) {
        console.warn('Failed to load web sound:', uri, e);
      }
    } else {
      // Use expo-av for native platforms
      try {
        const soundSource = typeof uri === 'string' ? { uri } : uri;
        const { sound } = await ExpoAudio.Sound.createAsync(
          soundSource,
          { 
            volume: 0.9, 
            shouldPlay: false,
            isLooping: false,
          },
        );
        soundRef.current = sound;
        setIsLoaded(true);
        console.log('Native sound loaded successfully:', uri);
      } catch (e) {
        console.warn('Failed to load native sound:', uri, e);
      }
    }
  }, [uri, isLoaded]);

  // Preload sound on mount
  useEffect(() => {
    ensureSound();
    return () => {
      if (Platform.OS === 'web') {
        if (webAudioRef.current) {
          webAudioRef.current.pause();
          webAudioRef.current = null;
        }
      } else {
        if (soundRef.current) {
          soundRef.current.unloadAsync().catch(() => {});
        }
      }
    };
  }, [ensureSound]);

  const play = useCallback(async () => {
    try {
      let played = false;
      
      if (Platform.OS === 'web') {
        // Play using HTML5 Audio API
        try {
          let audioUrl = '';
          if (typeof uri === 'string') {
            audioUrl = uri;
          } else if (typeof uri === 'number') {
            // Local file on web - skip and return false to use TTS fallback
            console.log('Local sound file on web - using TTS fallback');
            return false;
          }
          
          if (!audioUrl) {
            return false;
          }
          
          // Always create a new Audio instance for web to avoid autoplay issues
          const audio = new Audio(audioUrl);
          audio.volume = 0.9;
          
          // Set up error handler
          audio.onerror = (e) => {
            console.error('Audio error:', e, audio.error);
          };
          
          // Play immediately - user interaction should allow this
          try {
            const playPromise = audio.play();
            if (playPromise !== undefined) {
              await playPromise;
              played = true;
              console.log('Web sound played successfully:', uri);
            } else {
              // No promise returned, assume it's playing
              played = true;
              console.log('Web sound started (no promise):', uri);
            }
          } catch (playError: any) {
            console.error('Error calling audio.play():', playError);
            // Try using preloaded audio as fallback
            if (webAudioRef.current) {
              try {
                webAudioRef.current.currentTime = 0;
                await webAudioRef.current.play();
                played = true;
                console.log('Web sound played using preloaded audio:', uri);
              } catch (e2) {
                console.error('Preloaded audio play also failed:', e2);
              }
            }
          }
        } catch (e) {
          console.error('Web audio creation failed:', e, 'URI:', uri);
        }
      } else {
        // Play using expo-av
        try {
          await ensureSound();
          if (soundRef.current) {
            await soundRef.current.replayAsync();
            played = true;
          } else {
            console.warn('Sound not loaded yet:', uri);
          }
        } catch (e) {
          console.warn('Native audio play failed:', e);
        }
      }
      
      return played;
    } catch (e) {
      console.warn('Failed to play sound:', uri, e);
      return false;
    }
  }, [ensureSound, uri]);

  return play;
};

// Sound configuration
// Using local sound files from assets
const INSTRUMENTS = [
  {
    type: 'drum' as InstrumentType,
    emoji: '🥁',
    name: 'drum',
    color: ['#EF4444', '#DC2626'],
    glow: '#FCA5A5',
    soundUrl: require('@/assets/sounds/session3/drum.mp3'),
    soundWord: 'Boom!',
  },
  {
    type: 'bell' as InstrumentType,
    emoji: '🔔',
    name: 'bell',
    color: ['#FBBF24', '#F59E0B'],
    glow: '#FDE68A',
    soundUrl: require('@/assets/sounds/session3/bell.mp3.mp3'),
    soundWord: 'Ding!',
  },
  {
    type: 'horn' as InstrumentType,
    emoji: '📯',
    name: 'horn',
    color: ['#3B82F6', '#2563EB'],
    glow: '#93C5FD',
    // Using beep sound as horn sound if available, otherwise keep empty for TTS fallback
    soundUrl: require('@/assets/sounds/session3/beep.mp3.mp3'),
    soundWord: 'Toot!',
  },
];

export const TapToMakeSoundGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTaps = 5,
}) => {
  const [hits, setHits] = useState(0);
  const [currentInstrument, setCurrentInstrument] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSoundWord, setShowSoundWord] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);

  const instrumentScale = useRef(new Animated.Value(1)).current;
  const instrumentRotation = useRef(new Animated.Value(0)).current;
  const instrumentGlow = useRef(new Animated.Value(0.5)).current;
  const soundWaveScale = useRef(new Animated.Value(0)).current;
  const soundWaveOpacity = useRef(new Animated.Value(0)).current;

  // Use only 2-3 instruments in rotation
  const activeInstruments = INSTRUMENTS.slice(0, 3);
  
  // Create sound effects for each instrument
  const playDrum = useSoundEffect(activeInstruments[0].soundUrl);
  const playBell = useSoundEffect(activeInstruments[1].soundUrl);
  const playHorn = useSoundEffect(activeInstruments[2].soundUrl);

  useEffect(() => {
    startGlowAnimation();
    const instrument = activeInstruments[currentInstrument];
    speak(`Tap the ${instrument.name}!`);
    return () => {
      clearScheduledSpeech();
    };
  }, []);

  const startGlowAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(instrumentGlow, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(instrumentGlow, {
          toValue: 0.5,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    ).start();
  };

  const playSound = useCallback(async (instrumentIndex: number) => {
    if (isPlaying) return;
    
    setIsPlaying(true);
    const instrument = activeInstruments[instrumentIndex];
    
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Play sound FIRST, then visual feedback
    // Play sound based on instrument type
    let soundPlayed = false;
    if (instrument.soundUrl && instrument.soundUrl.trim() !== '') {
      try {
        if (instrument.type === 'drum') {
          soundPlayed = await playDrum();
        } else if (instrument.type === 'bell') {
          soundPlayed = await playBell();
        } else if (instrument.type === 'horn') {
          soundPlayed = await playHorn();
        }
      } catch (e) {
        console.warn('Error playing sound:', e);
      }
    }

    // Only use TTS as fallback if sound file failed to play
    // The actual sound should play via playDrum/playBell/playHorn above
    if (!soundPlayed) {
      // Fallback to TTS only if sound file didn't play
      speak(instrument.soundWord);
    }

    // Visual feedback
    setShowSoundWord(true);
    
    // Instrument animation
    Animated.sequence([
      Animated.parallel([
        Animated.timing(instrumentScale, {
          toValue: 1.2,
          duration: 150,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(instrumentRotation, {
          toValue: 10,
          duration: 100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(instrumentScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(instrumentRotation, {
          toValue: -10,
          duration: 100,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(instrumentRotation, {
        toValue: 0,
        duration: 100,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Sound wave animation
    soundWaveScale.setValue(0);
    soundWaveOpacity.setValue(0.8);
    Animated.parallel([
      Animated.timing(soundWaveScale, {
        toValue: 2.5,
        duration: 800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(soundWaveOpacity, {
        toValue: 0,
        duration: 800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Don't speak the sound word - let the actual sound play!
    // The actual sound should play via playDrum/playBell/playHorn above

    const nextHits = hits + 1;
    setHits(nextHits);
    // Show success animation
    setShowRoundSuccess(true);

    setTimeout(() => {
      setShowRoundSuccess(false);
      setShowSoundWord(false);
      setIsPlaying(false);
    }, 2500);

    // Rotate to next instrument after 2 taps
    if (nextHits > 0 && nextHits % 2 === 0) {
      setTimeout(() => {
        const nextInstrument = (currentInstrument + 1) % activeInstruments.length;
        setCurrentInstrument(nextInstrument);
        const newInstrument = activeInstruments[nextInstrument];
        speak(`Tap the ${newInstrument.name}!`);
      }, 2000);
    }

    if (nextHits >= requiredTaps) {
      setGameFinished(true);
      setShowRoundSuccess(false);
    }
  }, [isPlaying, currentInstrument, hits, requiredTaps, activeInstruments, playDrum, playBell, playHorn, onComplete, onBack]);

  const handleInstrumentTap = () => {
    playSound(currentInstrument);
  };

  const progressDots = Array.from({ length: requiredTaps }, (_, i) => i < hits);
  const instrument = activeInstruments[currentInstrument];

  // Show completion screen with stats when game finishes
  if (gameFinished) {
    const accuracyPct = hits >= requiredTaps ? 100 : Math.round((hits / requiredTaps) * 100);
    const xpAwarded = hits * 10;
    return (
      <CongratulationsScreen
        message="Great Sounds!"
        showButtons={true}
        correct={hits}
        total={requiredTaps}
        accuracy={accuracyPct}
        xpAwarded={xpAwarded}
        onContinue={() => {
          clearScheduledSpeech();
          Speech.stop();
          onComplete?.();
        }}
        onHome={() => {
          clearScheduledSpeech();
          Speech.stop();
          stopAllSpeech();
          cleanupSounds();
          onBack();
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              stopAllSpeech();
              cleanupSounds();
              onBack();
            }}
            style={styles.backButton}
            hitSlop={10}
          >
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Tap to Make Sound</Text>
            <Text style={styles.subtitle}>
              Tap the {instrument.name} to hear it play! {instrument.emoji}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Sound Wave Rings */}
          <Animated.View
            style={[
              styles.soundWave,
              {
                transform: [{ scale: soundWaveScale }],
                opacity: soundWaveOpacity,
                borderColor: instrument.glow,
              },
            ]}
          />
          <Animated.View
            style={[
              styles.soundWave,
              {
                transform: [{ scale: Animated.multiply(soundWaveScale, 0.8) }],
                opacity: Animated.multiply(soundWaveOpacity, 0.6),
                borderColor: instrument.glow,
              },
            ]}
          />

          {/* Musical Instrument */}
          <Animated.View
            style={[
              styles.instrumentContainer,
              {
                transform: [
                  { scale: instrumentScale },
                  {
                    rotate: instrumentRotation.interpolate({
                      inputRange: [-10, 10],
                      outputRange: ['-10deg', '10deg'],
                    }),
                  },
                ],
              },
            ]}
          >
            <Pressable onPress={handleInstrumentTap} hitSlop={40} style={styles.instrumentPressable}>
              <LinearGradient
                colors={instrument.color}
                style={[
                  styles.instrument,
                  {
                    shadowColor: instrument.glow,
                    shadowOpacity: instrumentGlow.interpolate({
                      inputRange: [0.5, 1],
                      outputRange: [0.4, 0.8],
                    }),
                    shadowRadius: 30,
                    shadowOffset: { width: 0, height: 0 },
                    elevation: 15,
                  },
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Text style={styles.instrumentEmoji}>{instrument.emoji}</Text>
                {showSoundWord && (
                  <View style={styles.soundWordBadge}>
                    <Text style={styles.soundWordText}>{instrument.soundWord}</Text>
                  </View>
                )}
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* Instruction */}
          {hits === 0 && !isPlaying && (
            <View style={styles.instructionBadge}>
              <Text style={styles.instructionText}>👆 Tap the {instrument.name}!</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            🔊 Sound Association • 🎵 Cause–Sound Mapping • 👂 Listening + Initiation
          </Text>
          <View style={styles.progressRow}>
            {progressDots.map((filled, idx) => (
              <View
                key={idx}
                style={[styles.progressDot, filled && styles.progressDotFilled]}
              />
            ))}
          </View>
          <Text style={styles.progressText}>
            {hits >= requiredTaps ? '🎊 Amazing! You did it! 🎊' : `Taps: ${hits} / ${requiredTaps}`}
          </Text>
        </View>
      </LinearGradient>

      {/* Round Success Animation */}
      <RoundSuccessAnimation
        visible={showRoundSuccess}
        stars={3}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomWidth: 2,
    borderBottomColor: '#FCD34D',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
  },
  backText: {
    marginLeft: 6,
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerText: {
    marginLeft: 12,
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 15,
    color: '#475569',
    fontWeight: '600',
  },
  playArea: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  soundWave: {
    position: 'absolute',
    width: INSTRUMENT_SIZE,
    height: INSTRUMENT_SIZE,
    borderRadius: INSTRUMENT_SIZE / 2,
    borderWidth: 3,
    zIndex: 1,
  },
  instrumentContainer: {
    zIndex: 100,
    elevation: 10,
  },
  instrumentPressable: {
    width: INSTRUMENT_SIZE,
    height: INSTRUMENT_SIZE,
  },
  instrument: {
    width: INSTRUMENT_SIZE,
    height: INSTRUMENT_SIZE,
    borderRadius: INSTRUMENT_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  instrumentEmoji: {
    fontSize: 90,
  },
  soundWordBadge: {
    position: 'absolute',
    bottom: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F59E0B',
  },
  soundWordText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#92400E',
    letterSpacing: 1,
  },
  instructionBadge: {
    position: 'absolute',
    bottom: 200,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 2,
    borderColor: '#F59E0B',
  },
  instructionText: {
    color: '#92400E',
    fontWeight: '800',
    fontSize: 18,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 2,
    borderTopColor: '#FCD34D',
  },
  footerText: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 12,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 10,
  },
  progressDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E2E8F0',
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
  progressDotFilled: {
    backgroundColor: '#F59E0B',
    borderColor: '#D97706',
    transform: [{ scale: 1.2 }],
  },
  progressText: {
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
});

