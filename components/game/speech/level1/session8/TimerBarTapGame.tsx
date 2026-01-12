import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

const BUTTON_SIZE = 140;
const BAR_WIDTH = 280;
const BAR_HEIGHT = 24;
const DEFAULT_TTS_RATE = 0.75;
const FILL_DURATION_MS = 6000; // 6 seconds to fill (randomized between 5-7)
const TAP_DURATION_MS = 3000; // How long button is tappable after fill

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

const BUTTON_STYLES = [
  { emoji: '⭐', color: ['#FCD34D', '#FBBF24'], glow: '#FEF3C7' },
  { emoji: '🎯', color: ['#EF4444', '#DC2626'], glow: '#FEE2E2' },
  { emoji: '🎨', color: ['#8B5CF6', '#7C3AED'], glow: '#EDE9FE' },
  { emoji: '💎', color: ['#06B6D4', '#0891B2'], glow: '#CFFAFE' },
  { emoji: '🌟', color: ['#F59E0B', '#D97706'], glow: '#FEF3C7' },
];

export const TimerBarTapGame: React.FC<Props> = ({
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
    missedTaps: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [currentButton, setCurrentButton] = useState<number>(0);
  const [fillProgress, setFillProgress] = useState(0);
  const [isFilled, setIsFilled] = useState(false);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [earlyTaps, setEarlyTaps] = useState(0);
  const [missedTaps, setMissedTaps] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const barFillWidth = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;
  const buttonPulse = useRef(new Animated.Value(1)).current;
  const starsScale = useRef(new Animated.Value(0)).current;
  const starsOpacity = useRef(new Animated.Value(0)).current;
  const waitIndicatorOpacity = useRef(new Animated.Value(0)).current;
  const waitIndicatorScale = useRef(new Animated.Value(0)).current;
  
  // Timeouts
  const fillTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);

  const finishGame = useCallback(async () => {
    // Clear all timeouts and animations
    if (fillTimeoutRef.current) {
      clearTimeout(fillTimeoutRef.current);
      fillTimeoutRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const totalAttempts = correctTaps + earlyTaps + missedTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 30;

    setFinalStats({
      totalRounds: requiredRounds,
      correctTaps,
      earlyTaps,
      missedTaps,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'timer-bar-tap',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['control', 'time-perception', 'structured-behavior', 'impulse-control'],
        incorrectAttempts: earlyTaps + missedTaps,
        meta: {
          correctTaps,
          earlyTaps,
          missedTaps,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [correctTaps, earlyTaps, missedTaps, requiredRounds, onComplete]);

  const advanceToNextRound = useCallback((nextRound: number) => {
    if (nextRound >= requiredRounds) {
      return;
    }
    setTimeout(() => {
      startRoundRef.current?.();
    }, 800);
  }, [requiredRounds]);

  const startRound = useCallback(() => {
    // Clear all timeouts and animations
    if (fillTimeoutRef.current) {
      clearTimeout(fillTimeoutRef.current);
      fillTimeoutRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }

    if (rounds >= requiredRounds) {
      return;
    }

    // Reset state
    setIsProcessing(false);
    setCanTap(false);
    setIsFilled(false);
    setFillProgress(0);
    
    // Reset animations
    barFillWidth.setValue(0);
    buttonScale.setValue(1);
    buttonOpacity.setValue(0);
    buttonPulse.setValue(1);
    starsScale.setValue(0);
    starsOpacity.setValue(0);
    waitIndicatorOpacity.setValue(0);
    waitIndicatorScale.setValue(0);

    // Select random button
    const buttonIndex = Math.floor(Math.random() * BUTTON_STYLES.length);
    setCurrentButton(buttonIndex);

    // Randomize fill duration (5-7 seconds)
    const duration = 5000 + Math.random() * 2000;

    speak('Watch the bar fill...');

    // Animate button appearance
    Animated.timing(buttonOpacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    // Fill bar animation
    Animated.timing(barFillWidth, {
      toValue: BAR_WIDTH,
      duration: duration,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Update progress
    const startTime = Date.now();
    progressIntervalRef.current = (setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      setFillProgress(progress);
    }, 50)) as unknown as NodeJS.Timeout;

    // After fill completes, button becomes tappable
    fillTimeoutRef.current = (setTimeout(() => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      
      setIsFilled(true);
      setCanTap(true);
      setFillProgress(1);

      // Pulse animation for button
      pulseAnimationRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(buttonPulse, {
            toValue: 1.15,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(buttonPulse, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimationRef.current.start();

      speak('Tap now!');

      // Button expires after duration
      tapTimeoutRef.current = (setTimeout(() => {
        if (canTap && !isProcessing) {
          setMissedTaps(prev => prev + 1);
          speak('Time\'s up!');
        }
        
        // Hide and advance
        Animated.parallel([
          Animated.timing(buttonOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(barFillWidth, {
            toValue: 0,
            duration: 300,
            useNativeDriver: false,
          }),
        ]).start(() => {
          setRounds(prev => {
            const nextRound = prev + 1;
            advanceToNextRoundRef.current?.(nextRound);
            return nextRound;
          });
        });
        
        tapTimeoutRef.current = null;
      }, TAP_DURATION_MS)) as unknown as NodeJS.Timeout;
      
      fillTimeoutRef.current = null;
    }, duration)) as unknown as NodeJS.Timeout;
  }, [rounds, requiredRounds, canTap, isProcessing]);

  const handleButtonTap = useCallback(() => {
    if (isProcessing) return;

    // Clear timeouts
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }

    // Stop animations
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }

    setIsProcessing(true);

    if (isFilled && canTap) {
      // Correct tap
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Celebration animation
      Animated.parallel([
        Animated.sequence([
          Animated.timing(buttonScale, {
            toValue: 1.3,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(buttonScale, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.spring(starsScale, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(starsOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Hide stars after animation
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(starsScale, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(starsOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      }, 1500);

      // Show success animation instead of TTS
      setShowRoundSuccess(true);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);

      // Hide and advance
      Animated.parallel([
        Animated.timing(buttonOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(barFillWidth, {
          toValue: 0,
          duration: 300,
          useNativeDriver: false,
        }),
      ]).start(() => {
        setRounds(prev => {
          const nextRound = prev + 1;
          advanceToNextRoundRef.current?.(nextRound);
          return nextRound;
        });
      });
    } else {
      // Early tap
      setEarlyTaps(prev => prev + 1);

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      // Show wait indicator
      Animated.parallel([
        Animated.spring(waitIndicatorScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(waitIndicatorOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Hide wait indicator
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(waitIndicatorScale, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(waitIndicatorOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
      }, 2000);

      // Gentle button feedback
      Animated.sequence([
        Animated.timing(buttonScale, {
          toValue: 0.95,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(buttonScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      speak('Wait...');
      setIsProcessing(false);
    }
  }, [isFilled, canTap, isProcessing]);

  useLayoutEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  useLayoutEffect(() => {
    advanceToNextRoundRef.current = advanceToNextRound;
  }, [advanceToNextRound]);

  useEffect(() => {
    if (rounds >= requiredRounds && !gameFinished) {
      finishGame();
    }
  }, [rounds, requiredRounds, gameFinished, finishGame]);

  useEffect(() => {
    try {
      speak('Wait for the timer bar to fill, then tap!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (fillTimeoutRef.current) {
        clearTimeout(fillTimeoutRef.current);
      }
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      if (pulseAnimationRef.current) {
        pulseAnimationRef.current.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const buttonPulseScale = Animated.multiply(buttonScale, buttonPulse);
  const button = BUTTON_STYLES[currentButton];

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#EFF6FF', '#DBEAFE']}
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
            <Text style={styles.title}>Timer Bar → Tap</Text>
            <Text style={styles.subtitle}>
              {isFilled ? 'Tap when the bar is full!' : `Watch the bar fill... ${Math.round(fillProgress * 100)}%`}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Timer Bar */}
          <View style={styles.barContainer}>
            <View style={styles.barBackground}>
              <Animated.View
                style={[
                  styles.barFill,
                  {
                    width: barFillWidth,
                    backgroundColor: isFilled ? '#22C55E' : '#3B82F6',
                  },
                ]}
              />
            </View>
            <Text style={styles.barLabel}>
              {isFilled ? '✓ Ready!' : `${Math.round(fillProgress * 100)}%`}
            </Text>
          </View>

          {/* Wait Indicator */}
          <Animated.View
            style={[
              styles.waitIndicator,
              {
                transform: [{ scale: waitIndicatorScale }],
                opacity: waitIndicatorOpacity,
              },
            ]}
          >
            <View style={styles.waitCircle}>
              <Text style={styles.waitText}>WAIT...</Text>
            </View>
          </Animated.View>

          {/* Tap Button */}
          <Pressable
            onPress={handleButtonTap}
            disabled={isProcessing && !isFilled}
            style={styles.buttonContainer}
          >
            <Animated.View
              style={[
                styles.button,
                {
                  transform: [{ scale: isFilled ? buttonPulseScale : buttonScale }],
                  opacity: buttonOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={button.color as [string, string, ...string[]]}
                style={styles.buttonGradient}
              >
                <Text style={styles.buttonEmoji}>{button.emoji}</Text>
                {isFilled && (
                  <View style={styles.glowRing} />
                )}
              </LinearGradient>
            </Animated.View>
          </Pressable>

          {/* Stars Celebration */}
          <Animated.View
            style={[
              styles.starsContainer,
              {
                transform: [{ scale: starsScale }],
                opacity: starsOpacity,
              },
            ]}
          >
            {['⭐', '✨', '🌟'].map((star, i) => (
              <Text
                key={i}
                style={[
                  styles.star,
                  {
                    transform: [
                      { rotate: `${i * 120}deg` },
                      { translateY: -60 },
                    ],
                  },
                ]}
              >
                {star}
              </Text>
            ))}
          </Animated.View>

          {/* Progress Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>
              Round {rounds + 1} / {requiredRounds}
            </Text>
            <Text style={styles.statsSubtext}>
              ✓ Perfect: {correctTaps} • ⏱ Early: {earlyTaps} • ✗ Missed: {missedTaps}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="time" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Time Perception</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="hand-left" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Control</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="list" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Structured Behavior</Text>
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
  barContainer: {
    position: 'absolute',
    top: 80,
    alignItems: 'center',
    width: '100%',
  },
  barBackground: {
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    backgroundColor: '#E5E7EB',
    borderRadius: BAR_HEIGHT / 2,
    overflow: 'hidden',
    marginBottom: 12,
  },
  barFill: {
    height: '100%',
    borderRadius: BAR_HEIGHT / 2,
  },
  barLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  waitIndicator: {
    position: 'absolute',
    top: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FCD34D',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  waitText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#D97706',
  },
  buttonContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
  },
  buttonGradient: {
    width: '100%',
    height: '100%',
    borderRadius: BUTTON_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
  buttonEmoji: {
    fontSize: 70,
    zIndex: 2,
  },
  glowRing: {
    position: 'absolute',
    width: BUTTON_SIZE + 20,
    height: BUTTON_SIZE + 20,
    borderRadius: (BUTTON_SIZE + 20) / 2,
    borderWidth: 4,
    borderColor: '#22C55E',
    opacity: 0.6,
  },
  starsContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  star: {
    position: 'absolute',
    fontSize: 50,
  },
  statsContainer: {
    position: 'absolute',
    bottom: 100,
    alignItems: 'center',
  },
  statsText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 4,
  },
  statsSubtext: {
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

