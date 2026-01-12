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

const SIGNAL_SIZE = 200;
const DEFAULT_TTS_RATE = 0.75;
const GO_DURATION_MS = 2500; // How long GO signal shows (increased for better response time)
const STOP_DURATION_MS = 3000; // How long STOP signal shows (increased for better waiting practice)
const TRANSITION_DELAY_MS = 600; // Delay between rounds

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

export const TapOnlyOnYourTurnGame: React.FC<Props> = ({
  onBack,
  onComplete,
  requiredRounds = 8,
}) => {
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [rounds, setRounds] = useState(0);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    correctTaps: number;
    incorrectTaps: number;
    missedOpportunities: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [currentSignal, setCurrentSignal] = useState<'go' | 'stop' | null>(null);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // Prevent multiple taps
  const [incorrectTaps, setIncorrectTaps] = useState(0);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [missedOpportunities, setMissedOpportunities] = useState(0);
  const [correctWaits, setCorrectWaits] = useState(0); // Track correct waits on STOP
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const signalScale = useRef(new Animated.Value(0)).current;
  const signalOpacity = useRef(new Animated.Value(0)).current;
  const signalPulse = useRef(new Animated.Value(1)).current;
  const shakeAnimation = useRef(new Animated.Value(0)).current;
  const waitIndicatorOpacity = useRef(new Animated.Value(0)).current; // For STOP signal feedback
  
  // Store timeout reference to clear it
  const roundTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  const finishGame = useCallback(async () => {
    // Clear any pending timeouts and animations
    if (roundTimeoutRef.current) {
      clearTimeout(roundTimeoutRef.current);
      roundTimeoutRef.current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const totalAttempts = correctTaps + incorrectTaps + missedOpportunities;
    const accuracy = totalAttempts > 0 ? ((correctTaps + correctWaits) / totalAttempts) * 100 : 100;
    const xp = (correctTaps * 15) + (correctWaits * 10); // Reward waiting too

    setFinalStats({
      totalRounds: requiredRounds,
      correctTaps,
      incorrectTaps,
      missedOpportunities,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'tap-only-on-your-turn',
        correct: correctTaps + correctWaits,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['self-control', 'turn-rules', 'visual-patterns', 'impulse-control'],
        incorrectAttempts: incorrectTaps + missedOpportunities,
        meta: {
          correctTaps,
          incorrectTaps,
          missedOpportunities,
          correctWaits,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [correctTaps, incorrectTaps, missedOpportunities, correctWaits, requiredRounds, onComplete]);

  const advanceToNextRound = useCallback((nextRound: number) => {
    if (nextRound >= requiredRounds) {
      // Game will finish on next render
      return;
    }
    setTimeout(() => {
      startRound();
    }, TRANSITION_DELAY_MS);
  }, [requiredRounds]);

  const startRound = useCallback(() => {
    // Clear any existing timeout and animations
    if (roundTimeoutRef.current) {
      clearTimeout(roundTimeoutRef.current);
      roundTimeoutRef.current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }

    // Check if game should finish
    if (rounds >= requiredRounds) {
      return;
    }

    // Reset state
    setIsProcessing(false);
    setCanTap(false);
    signalScale.setValue(0);
    signalOpacity.setValue(0);
    signalPulse.setValue(1);
    shakeAnimation.setValue(0);
    waitIndicatorOpacity.setValue(0);

    // Alternate between GO and STOP
    const isGo = rounds % 2 === 0;
    const signal = isGo ? 'go' : 'stop';
    setCurrentSignal(signal);
    setCanTap(isGo);

    // Animate signal appearance with bounce
    Animated.parallel([
      Animated.spring(signalScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(signalOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse animation for GO signal only
    if (isGo) {
      pulseAnimationRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(signalPulse, {
            toValue: 1.15,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(signalPulse, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimationRef.current.start();
      
      speak('Go!');
    } else {
      // For STOP, show subtle wait indicator after a moment
      setTimeout(() => {
        Animated.timing(waitIndicatorOpacity, {
          toValue: 0.6,
          duration: 500,
          useNativeDriver: true,
        }).start();
      }, 1000);
      speak('Stop!');
    }

    // Auto-advance after duration
    const duration = isGo ? GO_DURATION_MS : STOP_DURATION_MS;
    roundTimeoutRef.current = (setTimeout(() => {
      if (isGo && canTap && !isProcessing) {
        // GO signal expired without tap - missed opportunity
        setMissedOpportunities(prev => prev + 1);
        speak('Time\'s up!');
      } else if (!isGo) {
        // STOP signal completed without tap - correct wait!
        setCorrectWaits(prev => prev + 1);
        // Show positive feedback
        Animated.sequence([
          Animated.timing(waitIndicatorOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(waitIndicatorOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();
        // Show success animation for correct wait
        setShowRoundSuccess(true);
        setTimeout(() => {
          setShowRoundSuccess(false);
        }, 2500);
      }

      // Hide signal
      Animated.timing(signalOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setRounds(prev => {
          const nextRound = prev + 1;
          advanceToNextRound(nextRound);
          return nextRound;
        });
      });
      
      roundTimeoutRef.current = null;
    }, duration)) as unknown as NodeJS.Timeout;
  }, [rounds, requiredRounds, canTap, isProcessing, advanceToNextRound]);

  const handleSignalTap = useCallback(() => {
    // Prevent multiple taps during processing
    if (isProcessing) return;

    // Clear the auto-advance timeout since user is interacting
    if (roundTimeoutRef.current) {
      clearTimeout(roundTimeoutRef.current);
      roundTimeoutRef.current = null;
    }

    // Stop pulse animation
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }

    setIsProcessing(true);

    if (currentSignal === 'go' && canTap) {
      // Correct tap on GO
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Success animation - bigger bounce
      Animated.sequence([
        Animated.parallel([
          Animated.timing(signalScale, {
            toValue: 1.3,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(signalPulse, {
            toValue: 1.3,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(signalScale, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(signalPulse, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Show success animation instead of TTS
      setShowRoundSuccess(true);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);

      // Hide signal and advance
      Animated.timing(signalOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => {
        setRounds(prev => {
          const nextRound = prev + 1;
          advanceToNextRound(nextRound);
          return nextRound;
        });
      });
    } else if (currentSignal === 'stop') {
      // Incorrect tap on STOP
      setIncorrectTaps(prev => prev + 1);
      setCanTap(false);

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}

      // More pronounced shake animation
      shakeAnimation.setValue(0);
      Animated.sequence([
        Animated.timing(shakeAnimation, {
          toValue: 15,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimation, {
          toValue: -15,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimation, {
          toValue: 15,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimation, {
          toValue: -15,
          duration: 60,
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnimation, {
          toValue: 0,
          duration: 60,
          useNativeDriver: true,
        }),
      ]).start();

      // Flash red briefly
      Animated.sequence([
        Animated.timing(signalScale, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(signalScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      speak('Wait for go!');

      // Don't advance round - let them try again on next STOP
      setIsProcessing(false);
    } else {
      // Edge case: tap when no signal or signal is fading
      setIsProcessing(false);
    }
  }, [currentSignal, canTap, isProcessing, advanceToNextRound]);

  // Check if game should finish when rounds change
  useEffect(() => {
    if (rounds >= requiredRounds && !gameFinished) {
      finishGame();
    }
  }, [rounds, requiredRounds, gameFinished, finishGame]);

  useEffect(() => {
    // Give clear instructions before starting
    speak('Tap only when you see GO! Wait when you see STOP! Don\'t tap during STOP signal!');
    setTimeout(() => {
      startRound();
    }, 4000);
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (roundTimeoutRef.current) {
        clearTimeout(roundTimeoutRef.current);
        roundTimeoutRef.current = null;
      }
      if (pulseAnimationRef.current) {
        pulseAnimationRef.current.stop();
        pulseAnimationRef.current = null;
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
    inputRange: [-15, 15],
    outputRange: [-15, 15],
  });

  // Calculate pulse scale
  const pulseScale = Animated.multiply(signalScale, signalPulse);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={currentSignal === 'go' ? ['#D1FAE5', '#A7F3D0'] : ['#FEE2E2', '#FECACA']}
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
            <Text style={styles.title}>Tap Only On Your Turn</Text>
            <Text style={styles.subtitle}>
              {currentSignal === 'go' ? 'Tap when you see GO!' : currentSignal === 'stop' ? 'Wait when you see STOP!' : 'Get ready...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          <Pressable
            onPress={handleSignalTap}
            disabled={isProcessing && currentSignal === 'stop'}
            style={styles.signalContainer}
          >
            <Animated.View
              style={[
                styles.signal,
                {
                  backgroundColor: currentSignal === 'go' ? '#22C55E' : currentSignal === 'stop' ? '#EF4444' : '#94A3B8',
                  transform: [
                    { scale: currentSignal === 'go' ? pulseScale : signalScale },
                    { translateX: shake },
                  ],
                  opacity: signalOpacity,
                },
              ]}
            >
              <Text style={styles.signalText}>
                {currentSignal === 'go' ? 'GO!' : currentSignal === 'stop' ? 'STOP!' : ''}
              </Text>
            </Animated.View>
          </Pressable>

          {/* Wait Indicator for STOP signal */}
          {currentSignal === 'stop' && (
            <Animated.View
              style={[
                styles.waitIndicator,
                {
                  opacity: waitIndicatorOpacity,
                },
              ]}
            >
              <Ionicons name="hand-left-outline" size={32} color="#FFFFFF" />
              <Text style={styles.waitText}>Good waiting!</Text>
            </Animated.View>
          )}

          {/* Progress */}
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>
              Round {rounds + 1} / {requiredRounds}
            </Text>
            <Text style={styles.statsText}>
              ✓ Correct: {correctTaps} • ⏸ Wait: {correctWaits} • ✗ Errors: {incorrectTaps}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="hand-left" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Self-control</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="repeat" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Turn Rules</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="eye" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Visual Patterns</Text>
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
  signalContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  signal: {
    width: SIGNAL_SIZE,
    height: SIGNAL_SIZE,
    borderRadius: SIGNAL_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
  signalText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  waitIndicator: {
    position: 'absolute',
    top: SIGNAL_SIZE + 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  waitText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#16A34A',
    marginTop: 4,
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
