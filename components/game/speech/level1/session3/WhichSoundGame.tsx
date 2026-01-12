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

const INSTRUMENT_SIZE = 160;
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
  { emoji: '🔔', name: 'bell', word: 'ding', color: ['#FBBF24', '#F59E0B'], soundKey: 'bell' as const },
  { emoji: '🥁', name: 'drum', word: 'boom', color: ['#EF4444', '#DC2626'], soundKey: 'drum' as const },
];

export const WhichSoundGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTrials = 5,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [trials, setTrials] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [currentCorrect, setCurrentCorrect] = useState(0);
  const [phase, setPhase] = useState<'sound' | 'choice' | 'feedback'>('sound');
  const [canTap, setCanTap] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<{ emoji: string; text: string } | null>(null);
  const [gameFinished, setGameFinished] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalTrials: number;
    correctTrials: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const leftScale = useRef(new Animated.Value(1)).current;
  const rightScale = useRef(new Animated.Value(1)).current;
  const leftGlow = useRef(new Animated.Value(0.5)).current;
  const rightGlow = useRef(new Animated.Value(0.5)).current;
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
    speak('Amazing! You completed all the sound trials!');

    try {
      const xpAwarded = correct * 10;
      const result = await logGameAndAward({
        type: 'which-sound',
        correct: correct,
        total: requiredTrials,
        accuracy: stats.accuracy,
        xpAwarded,
        skillTags: ['sound-discrimination', 'receptive-vocabulary'],
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
    setFeedbackResult(null);
    leftScale.setValue(1);
    rightScale.setValue(1);
    feedbackScale.setValue(0);
    feedbackOpacity.setValue(0);

    // Random correct answer
    const correctIndex = Math.floor(Math.random() * INSTRUMENTS.length);
    setCurrentCorrect(correctIndex);

    // Speak instruction
    speak('Listen carefully, which one made the sound?');

    // Play sound after a short delay
    setTimeout(() => {
      const sound = INSTRUMENTS[correctIndex];
      
      // Play actual sound
      playSound(sound.soundKey, 1.0, 1.0);
      
      // Show choices after sound
      setTimeout(() => {
        setPhase('choice');
        setCanTap(true);
        startGlowAnimation();
      }, 1500);
    }, 1000);
  }, []);

  const startGlowAnimation = () => {
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(leftGlow, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(rightGlow, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
        Animated.parallel([
          Animated.timing(leftGlow, {
            toValue: 0.5,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(rightGlow, {
            toValue: 0.5,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      ])
    ).start();
  };

  const handleTap = useCallback((index: number) => {
    if (!canTap || phase !== 'choice') return;

    setCanTap(false);
    setPhase('feedback');

    const isCorrect = index === currentCorrect;
    
    // Store the result for feedback display
    const feedbackEmoji = isCorrect ? '✅' : '❌';
    const feedbackText = isCorrect ? 'Great job!' : 'Try again!';
    setFeedbackResult({ emoji: feedbackEmoji, text: feedbackText });
    
    if (isCorrect) {
      setCorrect(prev => prev + 1);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      // Show success animation instead of TTS
      setShowRoundSuccess(true);
    } else {
      speak('Try again!');
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}
    }
    
    // Store feedback for display
    setFeedbackResult({ emoji: feedbackEmoji, text: feedbackText });

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

    // Animate tapped instrument
    const tappedScale = index === 0 ? leftScale : rightScale;
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
  }, [canTap, phase, currentCorrect, trials, requiredTrials, startTrial]);

  const progressDots = Array.from({ length: requiredTrials }, (_, i) => i < trials);

  if (gameFinished && finalStats) {
    const accuracyPct = finalStats.accuracy;
    return (
      <CongratulationsScreen
        message="Great Sound Recognition!"
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
            <Text style={styles.headerTitle}>Which Sound?</Text>
            <Text style={styles.headerSubtitle}>Listen and choose!</Text>
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
              {INSTRUMENTS.map((instrument, index) => (
                <Pressable
                  key={index}
                  onPress={() => handleTap(index)}
                  style={styles.instrumentPressable}
                  hitSlop={20}
                >
                  <Animated.View
                    style={[
                      styles.instrument,
                      {
                        transform: [{ scale: index === 0 ? leftScale : rightScale }],
                        shadowColor: instrument.color[0],
                        shadowOpacity: (index === 0 ? leftGlow : rightGlow).interpolate({
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
                      style={styles.instrumentGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.instrumentEmoji}>{instrument.emoji}</Text>
                    </LinearGradient>
                  </Animated.View>
                </Pressable>
              ))}
            </View>
          )}

          {phase === 'feedback' && feedbackResult && (
            <Animated.View
              style={[
                styles.feedbackContainer,
                {
                  transform: [{ scale: feedbackScale }],
                  opacity: feedbackOpacity,
                },
              ]}
            >
              <Text style={styles.feedbackEmoji}>{feedbackResult.emoji}</Text>
              <Text style={styles.feedbackText}>{feedbackResult.text}</Text>
            </Animated.View>
          )}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            👂 Sound Discrimination • 📚 Receptive Vocabulary
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
  },
  instrumentPressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  instrument: {
    width: INSTRUMENT_SIZE,
    height: INSTRUMENT_SIZE,
    borderRadius: INSTRUMENT_SIZE / 2,
    overflow: 'hidden',
  },
  instrumentGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  instrumentEmoji: {
    fontSize: 80,
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

