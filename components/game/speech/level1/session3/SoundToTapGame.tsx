import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, preloadSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View
} from 'react-native';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredTrials?: number;
};

const CIRCLE_SIZE = 200;
const DEFAULT_TTS_RATE = 0.75;

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

const SOUNDS = [
  { name: 'bell', word: 'ding', emoji: '🔔', soundKey: 'bell' as const },
  { name: 'drum', word: 'boom', emoji: '🥁', soundKey: 'drum' as const },
  { name: 'clap', word: 'clap', emoji: '👏', soundKey: 'clap' as const },
  { name: 'beep', word: 'beep', emoji: '📢', soundKey: 'beep' as const },
];

export const SoundToTapGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTrials = 5,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [trials, setTrials] = useState(0);
  const [currentSound, setCurrentSound] = useState(0);
  const [playingSound, setPlayingSound] = useState(0); // Track which sound is currently playing
  const [phase, setPhase] = useState<'waiting' | 'sound' | 'circle' | 'success'>('waiting');
  const [canTap, setCanTap] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState<boolean>(false);
  const [finalStats, setFinalStats] = useState<{
    totalTrials: number;
    successfulTrials: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const circleScale = useRef(new Animated.Value(0)).current;
  const circleOpacity = useRef(new Animated.Value(0)).current;
  const circleGlow = useRef(new Animated.Value(0.5)).current;
  const backgroundPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Preload sounds on mount for instant playback (especially important for mobile browsers)
    preloadSounds();
    startTrial();
    return () => {
      clearScheduledSpeech();
    };
  }, []);

  const finishGame = useCallback(async () => {
    if (gameFinished) return;
    
    // Clear animation when game finishes
    setShowRoundSuccess(false);
    
    const stats = {
      totalTrials: requiredTrials,
      successfulTrials: trials,
      accuracy: Math.round((trials / requiredTrials) * 100),
    };
    setFinalStats(stats);
    setGameFinished(true);
    speak('Amazing! You completed all the sound trials!');

    try {
      const xpAwarded = trials * 10;
      const result = await logGameAndAward({
        type: 'sound-to-tap',
        correct: trials,
        total: requiredTrials,
        accuracy: stats.accuracy,
        xpAwarded,
        skillTags: ['sound-detection', 'auditory-motor-response', 'reaction-timing'],
        meta: {
          totalTrials: requiredTrials,
          successfulTrials: trials,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [trials, requiredTrials, gameFinished]);

  useEffect(() => {
    if (trials >= requiredTrials && !gameFinished) {
      finishGame();
    }
  }, [trials, requiredTrials, gameFinished, finishGame]);

  const startTrial = useCallback(() => {
    setPhase('sound');
    setCanTap(false);
    circleScale.setValue(0);
    circleOpacity.setValue(0);
    circleGlow.setValue(0.5);

    // Set the playing sound to match current sound
    setPlayingSound(currentSound);
    const sound = SOUNDS[currentSound];

    // Speak instruction
    speak('Listen carefully! Tap when you hear the sound!');

    // Play sound after a short delay
    setTimeout(() => {
      // Play actual sound
      playSound(sound.soundKey, 1.0, 1.0);
      
      // After sound, show circle
      setTimeout(() => {
        setPhase('circle');
        setCanTap(true);
        showCircle();
      }, 1500);
    }, 1000);
  }, [currentSound, playSound]);

  const showCircle = () => {
    // Pulse background slightly
    Animated.loop(
      Animated.sequence([
        Animated.timing(backgroundPulse, {
          toValue: 1.02,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(backgroundPulse, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    ).start();

    // Animate circle appearance
    Animated.parallel([
      Animated.spring(circleScale, {
        toValue: 1,
        tension: 30,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(circleOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Glow animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(circleGlow, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(circleGlow, {
          toValue: 0.5,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    ).start();
  };

  const handleTap = useCallback(() => {
    if (!canTap || phase !== 'circle') return;

    setCanTap(false);
    setPhase('success');

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Success animation
    Animated.sequence([
      Animated.parallel([
        Animated.spring(circleScale, {
          toValue: 1.3,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(circleOpacity, {
          toValue: 0.8,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(circleScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(circleOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Show success animation instead of TTS
    setShowRoundSuccess(true);

    // Move to next trial
    setTimeout(() => {
      setShowRoundSuccess(false);
      const nextTrials = trials + 1;
      setTrials(nextTrials);

      if (nextTrials < requiredTrials) {
        const nextSound = (currentSound + 1) % SOUNDS.length;
        setCurrentSound(nextSound);
        setTimeout(() => {
          startTrial();
        }, 500);
      }
    }, 2500);
  }, [canTap, phase, trials, currentSound, requiredTrials, startTrial, setShowRoundSuccess]);

  const progressDots = Array.from({ length: requiredTrials }, (_, i) => i < trials);
  // Use playingSound for display to ensure it matches the sound being played
  const sound = SOUNDS[playingSound];

  // Game finished screen
  if (gameFinished && finalStats) {
    const accuracyPct = finalStats.accuracy;
    return (
      <CongratulationsScreen
        message="Great Listening!"
        showButtons={true}
        correct={finalStats.successfulTrials}
        total={finalStats.totalTrials}
        accuracy={accuracyPct}
        xpAwarded={finalStats.successfulTrials * 10}
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
      <Animated.View
        style={[
          styles.background,
          {
            transform: [{ scale: backgroundPulse }],
          },
        ]}
      >
        <LinearGradient
          colors={['#F8FAFC', '#F1F5F9', '#E2E8F0']}
          style={styles.gradient}
        >
          {/* Header */}
          <View style={styles.header}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              Speech.stop();
              onBack();
            }}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={24} color="#1E293B" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
            <View style={styles.headerCenter}>
              <Text style={styles.headerTitle}>Sound → Tap</Text>
              <Text style={styles.headerSubtitle}>Listen and respond!</Text>
            </View>
            <View style={styles.headerRight} />
          </View>

          {/* Game Area - Neutral Screen */}
          <View style={styles.gameArea}>
            {phase === 'sound' && (
              <View style={styles.soundContainer}>
                <Text style={styles.soundEmoji}>👂</Text>
                <Text style={styles.soundText}>Listen...</Text>
              </View>
            )}

            {phase === 'circle' && (
              <View style={styles.circleContainer}>
                <Text style={styles.circleEmoji}>{sound.emoji}</Text>
                <Pressable
                  onPress={handleTap}
                  style={styles.circlePressable}
                  hitSlop={40}
                >
                  <Animated.View
                    style={[
                      styles.circle,
                      {
                        transform: [{ scale: circleScale }],
                        opacity: circleOpacity,
                        shadowColor: '#3B82F6',
                        shadowOpacity: circleGlow.interpolate({
                          inputRange: [0.5, 1],
                          outputRange: [0.3, 0.7],
                        }),
                        shadowRadius: 40,
                        shadowOffset: { width: 0, height: 0 },
                        elevation: 20,
                      },
                    ]}
                  >
                    <LinearGradient
                      colors={['#3B82F6', '#2563EB', '#1D4ED8']}
                      style={styles.circleGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.tapText}>TAP</Text>
                    </LinearGradient>
                  </Animated.View>
                </Pressable>
              </View>
            )}

            {phase === 'success' && (
              <View style={styles.successContainer}>
                <Text style={styles.successEmoji}>✨</Text>
                <Text style={styles.successText}>Great job!</Text>
              </View>
            )}
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              👂 Sound Detection • 🎯 Auditory → Motor Response • ⚡ Reaction Timing
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
              {trials >= requiredTrials
                ? '🎊 Amazing! You did it! 🎊'
                : `Trials: ${trials} / ${requiredTrials}`}
            </Text>
          </View>
        </LinearGradient>
      </Animated.View>

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
  background: {
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
    borderBottomColor: '#64748B',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E293B',
    marginLeft: 4,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E293B',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  headerRight: {
    width: 80,
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  waitingContainer: {
    alignItems: 'center',
  },
  waitingText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#64748B',
  },
  soundContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  soundEmoji: {
    fontSize: 140,
    marginBottom: 30,
  },
  soundText: {
    fontSize: 42,
    fontWeight: '900',
    color: '#1E293B',
    letterSpacing: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.1)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  circleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleEmoji: {
    fontSize: 80,
    marginBottom: 30,
  },
  circlePressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    overflow: 'hidden',
  },
  circleGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tapText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 4,
  },
  successContainer: {
    alignItems: 'center',
  },
  successEmoji: {
    fontSize: 100,
    marginBottom: 20,
  },
  successText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#22C55E',
  },
  footer: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 2,
    borderTopColor: '#64748B',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 12,
  },
  progressRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
  progressDotFilled: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
    textAlign: 'center',
  },
  completionScroll: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  completionContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  completionEmojiContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    borderWidth: 3,
    borderColor: '#DBEAFE',
  },
  completionEmoji: {
    fontSize: 64,
  },
  completionTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  completionSubtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 32,
    textAlign: 'center',
    fontWeight: '600',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '700',
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
  },
});

