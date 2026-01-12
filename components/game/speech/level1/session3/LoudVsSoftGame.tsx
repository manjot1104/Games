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
    View,
} from 'react-native';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredTrials?: number;
};

const BIG_SIZE = 180;
const SMALL_SIZE = 120;
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

const INSTRUMENTS = [
  { emoji: '🔔', name: 'bell', color: ['#FBBF24', '#F59E0B'], soundKey: 'bell' as const },
  { emoji: '🥁', name: 'drum', color: ['#EF4444', '#DC2626'], soundKey: 'drum' as const },
];

export const LoudVsSoftGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTrials = 5,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [trials, setTrials] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [currentVolume, setCurrentVolume] = useState<'loud' | 'soft'>('loud');
  const [currentInstrument, setCurrentInstrument] = useState(0);
  const [phase, setPhase] = useState<'sound' | 'choice' | 'feedback'>('sound');
  const [canTap, setCanTap] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [currentTrialResult, setCurrentTrialResult] = useState<'correct' | 'incorrect' | null>(null);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalTrials: number;
    correctTrials: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const bigScale = useRef(new Animated.Value(1)).current;
  const smallScale = useRef(new Animated.Value(1)).current;
  const bigGlow = useRef(new Animated.Value(0.5)).current;
  const smallGlow = useRef(new Animated.Value(0.5)).current;
  const feedbackScale = useRef(new Animated.Value(0)).current;
  const feedbackOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Preload sounds on mount for instant playback (especially important for mobile browsers)
    preloadSounds();
    startTrial();
    return () => {
      clearScheduledSpeech();
    };
  }, []);

  useEffect(() => {
    if (trials >= requiredTrials && !gameFinished) {
      finishGame();
    }
  }, [trials, requiredTrials, gameFinished]);

  const finishGame = useCallback(async () => {
    if (gameFinished) return;
    
    const stats = {
      totalTrials: requiredTrials,
      correctTrials: correct,
      accuracy: Math.round((correct / requiredTrials) * 100),
    };
    setFinalStats(stats);
    setGameFinished(true);
    speak('Amazing! You completed all the volume trials!');

    try {
      const xpAwarded = correct * 10;
      const result = await logGameAndAward({
        type: 'loud-vs-soft',
        correct: correct,
        total: requiredTrials,
        accuracy: stats.accuracy,
        xpAwarded,
        skillTags: ['auditory-discrimination', 'volume-differences', 'sensory-tolerance'],
        meta: {
          totalTrials: requiredTrials,
          correctTrials: correct,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [correct, requiredTrials, gameFinished]);

  const startTrial = useCallback(() => {
    setPhase('sound');
    setCanTap(false);
    setCurrentTrialResult(null); // Reset trial result
    bigScale.setValue(1);
    smallScale.setValue(1);
    feedbackScale.setValue(0);
    feedbackOpacity.setValue(0);

    // Random volume and instrument
    const volume: 'loud' | 'soft' = Math.random() > 0.5 ? 'loud' : 'soft';
    const instrumentIndex = Math.floor(Math.random() * INSTRUMENTS.length);
    setCurrentVolume(volume);
    setCurrentInstrument(instrumentIndex);

    // Speak instruction
    speak('Listen carefully! Loud sound? Tap big! Soft sound? Tap small!');

    // Play sound after a short delay
    setTimeout(() => {
      const instrument = INSTRUMENTS[instrumentIndex];
      
      // Play actual sound with adjusted volume and pitch
      // Loud: volume 1.0, rate 1.4-1.5 (much higher pitch - bright and sharp)
      // Soft: volume 0.3, rate 0.5-0.6 (much lower pitch - deep and mellow)
      // HUGE pitch difference to make it very obvious
      const soundVolume = volume === 'loud' ? 1.0 : 0.3;
      const soundRate = volume === 'loud' 
        ? 1.4 + Math.random() * 0.1  // 1.4-1.5 (high pitch)
        : 0.5 + Math.random() * 0.1;  // 0.5-0.6 (low pitch)
      playSound(instrument.soundKey, soundVolume, soundRate);
      
      // Show choices after sound
      setTimeout(() => {
        setPhase('choice');
        setCanTap(true);
        startGlowAnimation();
      }, 2000);
    }, 1000);
  }, []);

  const startGlowAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(bigGlow, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(smallGlow, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
        Animated.parallel([
          Animated.timing(bigGlow, {
            toValue: 0.5,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(smallGlow, {
            toValue: 0.5,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      ])
    ).start();
  };

  const handleTap = useCallback((size: 'big' | 'small') => {
    if (!canTap || phase !== 'choice') return;

    setCanTap(false);
    setPhase('feedback');

    const isCorrect = (size === 'big' && currentVolume === 'loud') || 
                     (size === 'small' && currentVolume === 'soft');
    
    // Set trial result for accurate feedback display
    setCurrentTrialResult(isCorrect ? 'correct' : 'incorrect');
    
    if (isCorrect) {
      setCorrect(prev => prev + 1);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      // Show success animation instead of TTS
      setShowRoundSuccess(true);
    } else {
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}
      speak('Try again!');
    }

    // Animate feedback
    Animated.parallel([
      Animated.spring(feedbackScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(feedbackOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // Animate tapped item
    const tappedScale = size === 'big' ? bigScale : smallScale;
    Animated.sequence([
      Animated.spring(tappedScale, {
        toValue: 1.3,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.spring(tappedScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    // Move to next trial
    setTimeout(() => {
      setShowRoundSuccess(false);
      const nextTrials = trials + 1;
      setTrials(nextTrials);

      if (nextTrials < requiredTrials) {
        setTimeout(() => {
          startTrial();
        }, 500);
      }
    }, 2500);
  }, [canTap, phase, currentVolume, trials, requiredTrials, startTrial]);

  const progressDots = Array.from({ length: requiredTrials }, (_, i) => i < trials);
  const instrument = INSTRUMENTS[currentInstrument];

  if (gameFinished && finalStats) {
    const accuracyPct = finalStats.accuracy;
    return (
      <CongratulationsScreen
        message="Great Volume Recognition!"
        showButtons={true}
        correct={finalStats.correctTrials}
        total={finalStats.totalTrials}
        accuracy={accuracyPct}
        xpAwarded={finalStats.correctTrials * 10}
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
        colors={['#F8FAFC', '#F1F5F9', '#E2E8F0']}
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
          >
            <Ionicons name="arrow-back" size={24} color="#1E293B" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Loud vs Soft</Text>
            <Text style={styles.headerSubtitle}>Listen to the volume!</Text>
          </View>
          <View style={styles.headerRight} />
        </View>

        <View style={styles.gameArea}>
          {phase === 'sound' && (
            <View style={styles.soundContainer}>
              <Text style={styles.soundEmoji}>👂</Text>
              <Text style={styles.soundText}>Listen...</Text>
            </View>
          )}

          {phase === 'choice' && (
            <View style={styles.choiceContainer}>
              <Pressable
                onPress={() => handleTap('big')}
                style={styles.itemPressable}
                hitSlop={20}
              >
                <Animated.View
                  style={[
                    styles.bigItem,
                    {
                      transform: [{ scale: bigScale }],
                      shadowColor: instrument.color[0],
                      shadowOpacity: bigGlow.interpolate({
                        inputRange: [0.5, 1],
                        outputRange: [0.3, 0.7],
                      }),
                      shadowRadius: 30,
                      shadowOffset: { width: 0, height: 0 },
                      elevation: 15,
                    },
                  ]}
                >
                  <LinearGradient
                    colors={instrument.color}
                    style={styles.itemGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.bigEmoji}>{instrument.emoji}</Text>
                    <Text style={styles.sizeLabel}>BIG</Text>
                  </LinearGradient>
                </Animated.View>
              </Pressable>

              <Pressable
                onPress={() => handleTap('small')}
                style={styles.itemPressable}
                hitSlop={20}
              >
                <Animated.View
                  style={[
                    styles.smallItem,
                    {
                      transform: [{ scale: smallScale }],
                      shadowColor: instrument.color[0],
                      shadowOpacity: smallGlow.interpolate({
                        inputRange: [0.5, 1],
                        outputRange: [0.3, 0.7],
                      }),
                      shadowRadius: 30,
                      shadowOffset: { width: 0, height: 0 },
                      elevation: 15,
                    },
                  ]}
                >
                  <LinearGradient
                    colors={instrument.color}
                    style={styles.itemGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text style={styles.smallEmoji}>{instrument.emoji}</Text>
                    <Text style={styles.sizeLabel}>SMALL</Text>
                  </LinearGradient>
                </Animated.View>
              </Pressable>
            </View>
          )}

          {phase === 'feedback' && currentTrialResult && (
            <Animated.View
              style={[
                styles.feedbackContainer,
                {
                  transform: [{ scale: feedbackScale }],
                  opacity: feedbackOpacity,
                },
              ]}
            >
              <Text style={styles.feedbackEmoji}>
                {currentTrialResult === 'correct' ? '✅' : '❌'}
              </Text>
              <Text style={[
                styles.feedbackText,
                currentTrialResult === 'incorrect' && styles.feedbackTextError
              ]}>
                {currentTrialResult === 'correct' ? 'Great job!' : 'Try again!'}
              </Text>
            </Animated.View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            🔊 Auditory Discrimination • 📊 Volume Differences • 🎚️ Sensory Tolerance
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
  choiceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  itemPressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigItem: {
    width: BIG_SIZE,
    height: BIG_SIZE,
    borderRadius: BIG_SIZE / 2,
    overflow: 'hidden',
  },
  smallItem: {
    width: SMALL_SIZE,
    height: SMALL_SIZE,
    borderRadius: SMALL_SIZE / 2,
    overflow: 'hidden',
  },
  itemGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigEmoji: {
    fontSize: 90,
  },
  smallEmoji: {
    fontSize: 60,
  },
  sizeLabel: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
    marginTop: 4,
    letterSpacing: 2,
  },
  feedbackContainer: {
    alignItems: 'center',
    position: 'absolute',
    top: '40%',
  },
  feedbackEmoji: {
    fontSize: 100,
    marginBottom: 20,
  },
  feedbackText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#22C55E',
  },
  feedbackTextError: {
    color: '#EF4444',
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
});

