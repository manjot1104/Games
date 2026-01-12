import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
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
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

const TIMER_DURATION_MS = 3000; // 3 seconds
const TAP_WINDOW_MS = 1000; // 1 second window after timer fills
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

export const TurnTimerGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredRounds = 6,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [rounds, setRounds] = useState(0);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    correctTaps: number;
    earlyTaps: number;
    lateTaps: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [timerProgress, setTimerProgress] = useState(0);
  const [canTap, setCanTap] = useState(false);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [earlyTaps, setEarlyTaps] = useState(0);
  const [lateTaps, setLateTaps] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const timerBarWidth = useRef(new Animated.Value(0)).current;
  const tapButtonScale = useRef(new Animated.Value(1)).current;
  const tapButtonOpacity = useRef(new Animated.Value(0.5)).current;
  const shakeAnimation = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const tapWindowRef = useRef<NodeJS.Timeout | null>(null);

  const startRound = useCallback(() => {
    if (rounds >= requiredRounds) {
      finishGame();
      return;
    }

    // Reset
    setCanTap(false);
    setIsTimerRunning(true);
    setTimerProgress(0);
    timerBarWidth.setValue(0);
    tapButtonScale.setValue(1);
    tapButtonOpacity.setValue(0.5);
    shakeAnimation.setValue(0);

    speak('Wait for the timer...');

    // Animate timer bar
    Animated.timing(timerBarWidth, {
      toValue: SCREEN_WIDTH * 0.8,
      duration: TIMER_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Update progress
    const startTime = Date.now();
    timerRef.current = (setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / TIMER_DURATION_MS, 1);
      setTimerProgress(progress);

      if (progress >= 1) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setIsTimerRunning(false);
        setCanTap(true);

        // Show tap button
        Animated.parallel([
          Animated.spring(tapButtonScale, {
            toValue: 1.1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(tapButtonOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();

        speak('Tap now!');

        // Close tap window after delay
        tapWindowRef.current = (setTimeout(() => {
          setCanTap(false);
          setLateTaps(prev => prev + 1);
          Animated.parallel([
            Animated.timing(tapButtonOpacity, {
              toValue: 0.5,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(tapButtonScale, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start();

          speak('Too late!');

          setTimeout(() => {
            setRounds(prev => prev + 1);
            setTimeout(() => {
              startRound();
            }, 1000);
          }, 1000);
        }, TAP_WINDOW_MS)) as unknown as NodeJS.Timeout;
      }
    }, 50)) as unknown as NodeJS.Timeout;
  }, [rounds, requiredRounds, SCREEN_WIDTH]);

  const handleTap = useCallback(() => {
    if (isTimerRunning) {
      // Early tap
      setEarlyTaps(prev => prev + 1);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsTimerRunning(false);
      timerBarWidth.stopAnimation();

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      // Shake animation
      shakeAnimation.setValue(0);
      Animated.sequence([
        Animated.timing(shakeAnimation, {
          toValue: 10,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimation, {
          toValue: -10,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimation, {
          toValue: 10,
          duration: 50,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimation, {
          toValue: 0,
          duration: 50,
          useNativeDriver: true,
        }),
      ]).start();

      speak('Wait for the timer!');

      setTimeout(() => {
        setRounds(prev => prev + 1);
        setTimeout(() => {
          startRound();
        }, 1000);
      }, 1500);
    } else if (canTap) {
      // Correct tap
      setCorrectTaps(prev => prev + 1);
      setRounds(prev => prev + 1);
      setCanTap(false);
      setIsTimerRunning(false);

      if (tapWindowRef.current) {
        clearTimeout(tapWindowRef.current);
        tapWindowRef.current = null;
      }

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Success animation
      Animated.sequence([
        Animated.timing(tapButtonScale, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(tapButtonScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Show success animation instead of TTS
      setShowRoundSuccess(true);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);

      setTimeout(() => {
        startRound();
      }, 1000);
    }
  }, [isTimerRunning, canTap, startRound]);

  const finishGame = useCallback(async () => {
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (tapWindowRef.current) {
      clearTimeout(tapWindowRef.current);
      tapWindowRef.current = null;
    }

    const totalAttempts = correctTaps + earlyTaps + lateTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 22;

    setFinalStats({
      totalRounds: requiredRounds,
      correctTaps,
      earlyTaps,
      lateTaps,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'turn-timer',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['timed-waiting', 'temporal-awareness', 'timing', 'patience'],
        incorrectAttempts: earlyTaps + lateTaps,
        meta: {
          correctTaps,
          earlyTaps,
          lateTaps,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [correctTaps, earlyTaps, lateTaps, requiredRounds, onComplete]);

  useEffect(() => {
    // Give clear instructions before starting
    speak('Wait for the timer to fill up completely! Then tap the button quickly! Don\'t tap too early or too late!');
    setTimeout(() => {
      startRound();
    }, 4000);
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (tapWindowRef.current) {
        clearTimeout(tapWindowRef.current);
      }
    };
  }, []);

  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.correctTaps}
        total={finalStats.totalRounds}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.xpAwarded}
        onContinue={() => {
          clearScheduledSpeech();
          stopAllSpeech();
          cleanupSounds();
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  const shake = shakeAnimation.interpolate({
    inputRange: [-10, 10],
    outputRange: [-10, 10],
  });

  const progressPercent = Math.round(timerProgress * 100);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              clearScheduledSpeech();
              onBack();
            }}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color="#0F172A" />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Turn Timer</Text>
            <Text style={styles.subtitle}>
              {isTimerRunning ? `Wait... ${progressPercent}%` : canTap ? 'Tap Now!' : 'Get ready!'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Timer Bar */}
          <View style={styles.timerContainer}>
            <View style={styles.timerBarBackground}>
              <Animated.View
                style={[
                  styles.timerBarFill,
                  {
                    width: timerBarWidth,
                    transform: [{ translateX: shake }],
                  },
                ]}
              />
            </View>
            <Text style={styles.timerText}>{progressPercent}%</Text>
          </View>

          {/* Tap Button */}
          <Pressable
            onPress={handleTap}
            style={styles.tapButtonContainer}
          >
            <Animated.View
              style={[
                styles.tapButton,
                {
                  transform: [{ scale: tapButtonScale }],
                  opacity: tapButtonOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={canTap ? ['#22C55E', '#16A34A'] : ['#94A3B8', '#64748B']}
                style={styles.tapButtonGradient}
              >
                <Text style={styles.tapButtonText}>
                  {isTimerRunning ? 'Wait...' : canTap ? 'TAP NOW!' : 'Ready'}
                </Text>
              </LinearGradient>
            </Animated.View>
          </Pressable>

          {/* Progress */}
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>
              Round {rounds + 1} / {requiredRounds}
            </Text>
            <Text style={styles.statsText}>
              Perfect: {correctTaps} • Early: {earlyTaps} • Late: {lateTaps}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="hourglass" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Timed Waiting</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="time" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Temporal Awareness</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="hand-left" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Patience</Text>
          </View>
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
    paddingTop: 8,
    paddingBottom: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    marginRight: 12,
  },
  backText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginLeft: 4,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
    marginTop: 2,
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  timerContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 60,
  },
  timerBarBackground: {
    width: '80%',
    height: 30,
    backgroundColor: '#E2E8F0',
    borderRadius: 15,
    overflow: 'hidden',
  },
  timerBarFill: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 15,
  },
  timerText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
    marginTop: 12,
  },
  tapButtonContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  tapButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
  },
  tapButtonGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 100,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
  tapButtonText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  progressContainer: {
    position: 'absolute',
    bottom: 100,
    alignItems: 'center',
  },
  progressText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 4,
  },
  statsText: {
    fontSize: 14,
    color: '#475569',
  },
  skillsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 12,
  },
  skillItem: {
    alignItems: 'center',
    flex: 1,
  },
  skillText: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
    textAlign: 'center',
  },
});

