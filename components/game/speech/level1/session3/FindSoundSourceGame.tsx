import { SparkleBurst } from '@/components/game/FX';
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

const ITEM_SIZE = 140;
const DEFAULT_TTS_RATE = 0.75;

let scheduledSpeechTimers: ReturnType<typeof setTimeout>[] = [];

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

const SOUND_SOURCES = [
  { emoji: '🐶', name: 'dog', sound: 'bark', color: ['#F59E0B', '#D97706'], soundKey: 'bark' as const },
  { emoji: '🚗', name: 'car', sound: 'beep', color: ['#3B82F6', '#2563EB'], soundKey: 'car-beep' as const },
  { emoji: '💧', name: 'water', sound: 'splash', color: ['#06B6D4', '#0891B2'], soundKey: 'water-splash' as const },
  { emoji: '🔔', name: 'bell', sound: 'ding', color: ['#FBBF24', '#F59E0B'], soundKey: 'bell' as const },
  { emoji: '🥁', name: 'drum', sound: 'boom', color: ['#EF4444', '#DC2626'], soundKey: 'drum' as const },
  { emoji: '👏', name: 'clap', sound: 'clap', color: ['#8B5CF6', '#7C3AED'], soundKey: 'clap' as const },
];

export const FindSoundSourceGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredTrials = 5,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [trials, setTrials] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [currentCorrect, setCurrentCorrect] = useState(0);
  const [currentOptions, setCurrentOptions] = useState<number[]>([]);
  const [phase, setPhase] = useState<'sound' | 'choice' | 'feedback'>('sound');
  const [canTap, setCanTap] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<{ emoji: string; text: string; isCorrect: boolean } | null>(null);
  const [gameFinished, setGameFinished] = useState(false);
  const [showSparkles, setShowSparkles] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalTrials: number;
    correctTrials: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const itemScales = useRef(SOUND_SOURCES.map(() => new Animated.Value(1))).current;
  const itemGlows = useRef(SOUND_SOURCES.map(() => new Animated.Value(0.5))).current;
  const itemRotations = useRef(SOUND_SOURCES.map(() => new Animated.Value(0))).current;
  const feedbackScale = useRef(new Animated.Value(0)).current;
  const feedbackOpacity = useRef(new Animated.Value(0)).current;
  const feedbackRotation = useRef(new Animated.Value(0)).current;
  const soundEmojiScale = useRef(new Animated.Value(1)).current;
  const soundEmojiRotation = useRef(new Animated.Value(0)).current;
  const backgroundPulse = useRef(new Animated.Value(1)).current;

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
    speak('Amazing! You found all the sound sources!');

    try {
      const xpAwarded = correct * 10;
      const result = await logGameAndAward({
        type: 'find-the-sound-source',
        correct: correct,
        total: requiredTrials,
        accuracy: stats.accuracy,
        xpAwarded,
        skillTags: ['sound-object-linking', 'auditory-reasoning', 'attention'],
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
    setShowSparkles(false);
    itemScales.forEach(scale => scale.setValue(1));
    itemRotations.forEach(rot => rot.setValue(0));
    feedbackScale.setValue(0);
    feedbackOpacity.setValue(0);
    feedbackRotation.setValue(0);
    soundEmojiScale.setValue(1);
    soundEmojiRotation.setValue(0);
    backgroundPulse.setValue(1);

    // Random correct answer
    const correctIndex = Math.floor(Math.random() * SOUND_SOURCES.length);
    setCurrentCorrect(correctIndex);

    // Select 2 options: one correct + one random wrong
    const wrongOptions = SOUND_SOURCES.filter((_, idx) => idx !== correctIndex);
    const randomWrong = wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
    const wrongIndex = SOUND_SOURCES.findIndex(s => s.soundKey === randomWrong.soundKey);
    const options = [correctIndex, wrongIndex].sort(() => Math.random() - 0.5); // Shuffle
    setCurrentOptions(options);

    // Speak instruction
    speak('Listen carefully, which one made the sound?');

    // Animate sound emoji
    Animated.sequence([
      Animated.parallel([
        Animated.spring(soundEmojiScale, {
          toValue: 1.3,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(soundEmojiRotation, {
          toValue: 360,
          duration: 1000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
      Animated.spring(soundEmojiScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    // Play sound after a short delay
    setTimeout(() => {
      const source = SOUND_SOURCES[correctIndex];
      playSound(source.soundKey, 1.0, 1.0);
      
      // Show choices after sound
      setTimeout(() => {
        setPhase('choice');
        setCanTap(true);
        startGlowAnimation();
      }, 2000);
    }, 2000);
  }, []);

  const startGlowAnimation = () => {
    itemGlows.forEach(glow => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, {
            toValue: 1,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(glow, {
            toValue: 0.5,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      ).start();
    });
  };

  const handleTap = useCallback((index: number) => {
    if (!canTap || phase !== 'choice') return;

    setCanTap(false);
    setPhase('feedback');

    const isCorrect = index === currentCorrect;
    
    // Store the result for feedback display
    const feedbackEmoji = isCorrect ? '🎉' : '😔';
    const feedbackText = isCorrect ? 'Amazing! You got it!' : 'Oops! Try again!';
    setFeedbackResult({ emoji: feedbackEmoji, text: feedbackText, isCorrect });
    
    if (isCorrect) {
      setCorrect(prev => prev + 1);
      setShowSparkles(true);
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      speak(`Yes! It's the ${SOUND_SOURCES[index].name}!`);
      
      // Amazing correct answer animation
      Animated.parallel([
        Animated.sequence([
          Animated.spring(feedbackScale, {
            toValue: 1.5,
            tension: 30,
            friction: 5,
            useNativeDriver: true,
          }),
          Animated.spring(feedbackScale, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(feedbackRotation, {
              toValue: 10,
              duration: 200,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(feedbackRotation, {
              toValue: -10,
              duration: 200,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(feedbackRotation, {
              toValue: 0,
              duration: 200,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          { iterations: 3 }
        ),
      ]).start();

      // Animate correct item with celebration
      Animated.parallel([
        Animated.sequence([
          Animated.spring(itemScales[index], {
            toValue: 1.5,
            tension: 30,
            friction: 5,
            useNativeDriver: true,
          }),
          Animated.spring(itemScales[index], {
            toValue: 1.2,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
        ]),
        Animated.loop(
          Animated.sequence([
            Animated.timing(itemRotations[index], {
              toValue: 15,
              duration: 150,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(itemRotations[index], {
              toValue: -15,
              duration: 150,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(itemRotations[index], {
              toValue: 0,
              duration: 150,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          { iterations: 2 }
        ),
      ]).start();

      // Pulse background
      Animated.sequence([
        Animated.timing(backgroundPulse, {
          toValue: 1.1,
          duration: 300,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(backgroundPulse, {
          toValue: 1,
          duration: 300,
          easing: Easing.in(Easing.ease),
          useNativeDriver: false,
        }),
      ]).start();

    } else {
      speak('Try again!');
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}
      
      // Wrong answer animation - shake effect
      Animated.parallel([
        Animated.sequence([
          Animated.spring(feedbackScale, {
            toValue: 1.2,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.spring(feedbackScale, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(feedbackRotation, {
            toValue: -10,
            duration: 100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(feedbackRotation, {
            toValue: 10,
            duration: 100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(feedbackRotation, {
            toValue: -10,
            duration: 100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(feedbackRotation, {
            toValue: 0,
            duration: 100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Animate wrong item - shake
      Animated.sequence([
        Animated.timing(itemScales[index], {
          toValue: 0.9,
          duration: 100,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(itemRotations[index], {
          toValue: -10,
          duration: 50,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(itemRotations[index], {
          toValue: 10,
          duration: 50,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(itemRotations[index], {
          toValue: -10,
          duration: 50,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.parallel([
          Animated.spring(itemScales[index], {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(itemRotations[index], {
            toValue: 0,
            duration: 100,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    }

    // Move to next trial
    setTimeout(() => {
      setShowRoundSuccess(false);
      setShowSparkles(false);
      const nextTrials = trials + 1;
      setTrials(nextTrials);

      if (nextTrials < requiredTrials) {
        setTimeout(() => {
          startTrial();
        }, 500);
      }
    }, 2500);
  }, [canTap, phase, currentCorrect, currentOptions, trials, requiredTrials, startTrial]);

  const progressDots = Array.from({ length: requiredTrials }, (_, i) => i < trials);

  if (gameFinished && finalStats) {
    const accuracyPct = finalStats.accuracy;
    return (
      <CongratulationsScreen
        message="Great Listening!"
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
            <Text style={styles.headerTitle}>Find the Sound Source</Text>
            <Text style={styles.headerSubtitle}>Listen and match!</Text>
          </View>
          <View style={styles.headerRight} />
        </View>

        <Animated.View 
          style={[
            styles.gameArea,
            {
              transform: [{ scale: backgroundPulse }],
            },
          ]}
        >
          {phase === 'sound' && (
            <View style={styles.soundContainer}>
              <Animated.View
                style={{
                  transform: [
                    { scale: soundEmojiScale },
                    {
                      rotate: soundEmojiRotation.interpolate({
                        inputRange: [0, 360],
                        outputRange: ['0deg', '360deg'],
                      }),
                    },
                  ],
                }}
              >
                <Text style={styles.soundEmoji}>👂</Text>
              </Animated.View>
              <Text style={styles.soundText}>Listen...</Text>
            </View>
          )}

          {phase === 'choice' && (
            <View style={styles.choiceContainer}>
              {currentOptions.map((sourceIndex) => {
                const source = SOUND_SOURCES[sourceIndex];
                return (
                  <Pressable
                    key={sourceIndex}
                    onPress={() => handleTap(sourceIndex)}
                    style={styles.itemPressable}
                    hitSlop={20}
                  >
                    <Animated.View
                      style={[
                        styles.item,
                        {
                          transform: [
                            { scale: itemScales[sourceIndex] },
                            {
                              rotate: itemRotations[sourceIndex].interpolate({
                                inputRange: [-15, 15],
                                outputRange: ['-15deg', '15deg'],
                              }),
                            },
                          ],
                          shadowColor: source.color[0],
                          shadowOpacity: itemGlows[sourceIndex].interpolate({
                            inputRange: [0.5, 1],
                            outputRange: [0.4, 0.9],
                          }),
                          shadowRadius: 40,
                          shadowOffset: { width: 0, height: 0 },
                          elevation: 20,
                        },
                      ]}
                    >
                      <LinearGradient
                        colors={source.color as [string, string, ...string[]]}
                        style={styles.itemGradient}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                      >
                        <Text style={styles.itemEmoji}>{source.emoji}</Text>
                      </LinearGradient>
                    </Animated.View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {phase === 'feedback' && feedbackResult && (
            <Animated.View
              style={[
                styles.feedbackContainer,
                {
                  transform: [
                    { scale: feedbackScale },
                    {
                      rotate: feedbackRotation.interpolate({
                        inputRange: [-10, 10],
                        outputRange: ['-10deg', '10deg'],
                      }),
                    },
                  ],
                  opacity: feedbackOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={feedbackResult.isCorrect 
                  ? ['#22C55E', '#16A34A', '#15803D'] 
                  : ['#EF4444', '#DC2626', '#B91C1C']}
                style={styles.feedbackGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Text style={styles.feedbackEmoji}>{feedbackResult.emoji}</Text>
                <Text style={styles.feedbackText}>{feedbackResult.text}</Text>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Sparkle effect for correct answers */}
          {showSparkles && feedbackResult?.isCorrect && (
            <SparkleBurst visible={true} color="#22C55E" count={20} size={8} />
          )}
        </Animated.View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            🔗 Sound → Object Linking • 🧠 Auditory Reasoning • 👁️ Attention
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
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
    gap: 40,
  },
  itemPressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    width: ITEM_SIZE + 20,
    height: ITEM_SIZE + 20,
    borderRadius: (ITEM_SIZE + 20) / 2,
    overflow: 'hidden',
    borderWidth: 5,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  itemGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemEmoji: {
    fontSize: 80,
  },
  feedbackContainer: {
    alignItems: 'center',
    position: 'absolute',
    top: '35%',
    zIndex: 1000,
  },
  feedbackGradient: {
    paddingHorizontal: 40,
    paddingVertical: 30,
    borderRadius: 30,
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },
  feedbackEmoji: {
    fontSize: 120,
    marginBottom: 15,
  },
  feedbackText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 1,
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
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

