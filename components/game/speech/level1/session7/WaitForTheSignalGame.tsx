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

const OBJECT_SIZE = 150;
const SPINNER_SIZE = 60;
const DEFAULT_TTS_RATE = 0.75;
const SPIN_DURATION_MS = 2500; // How long spinner spins before showing color (increased for anticipation)
const GREEN_DURATION_MS = 3000; // How long green signal shows (increased for better response time)
const RED_DURATION_MS = 2500; // How long red signal shows (increased for better waiting practice)
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

const OBJECTS = [
  { emoji: '🫧', name: 'bubble', color: ['#06B6D4', '#0891B2'] },
  { emoji: '⚽', name: 'ball', color: ['#EF4444', '#DC2626'] },
  { emoji: '🎈', name: 'balloon', color: ['#F59E0B', '#D97706'] },
  { emoji: '⭐', name: 'star', color: ['#FCD34D', '#FBBF24'] },
  { emoji: '🎨', name: 'paint', color: ['#8B5CF6', '#7C3AED'] },
  { emoji: '🌙', name: 'moon', color: ['#6366F1', '#4F46E5'] },
];

export const WaitForTheSignalGame: React.FC<Props> = ({
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
    correctWaits: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [currentObject, setCurrentObject] = useState<number>(0);
  const [spinnerColor, setSpinnerColor] = useState<'spinning' | 'green' | 'red' | null>(null);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); // Prevent multiple taps
  const [correctTaps, setCorrectTaps] = useState(0);
  const [incorrectTaps, setIncorrectTaps] = useState(0);
  const [missedOpportunities, setMissedOpportunities] = useState(0);
  const [correctWaits, setCorrectWaits] = useState(0); // Track correct waits on red
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const objectScale = useRef(new Animated.Value(0)).current;
  const objectOpacity = useRef(new Animated.Value(0)).current;
  const spinnerRotation = useRef(new Animated.Value(0)).current;
  const spinnerScale = useRef(new Animated.Value(1)).current;
  const shakeAnimation = useRef(new Animated.Value(0)).current;
  const waitIndicatorOpacity = useRef(new Animated.Value(0)).current; // For red signal feedback
  
  // Store timeout and animation references
  const spinTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const signalTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const rotationAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);

  const finishGame = useCallback(async () => {
    // Clear all timeouts and animations
    if (spinTimeoutRef.current) {
      clearTimeout(spinTimeoutRef.current);
      spinTimeoutRef.current = null;
    }
    if (signalTimeoutRef.current) {
      clearTimeout(signalTimeoutRef.current);
      signalTimeoutRef.current = null;
    }
    if (rotationAnimationRef.current) {
      rotationAnimationRef.current.stop();
      rotationAnimationRef.current = null;
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
    const xp = (correctTaps * 20) + (correctWaits * 12); // Reward waiting too

    setFinalStats({
      totalRounds: requiredRounds,
      correctTaps,
      incorrectTaps,
      missedOpportunities,
      correctWaits,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'wait-for-the-signal',
        correct: correctTaps + correctWaits,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['waiting', 'inhibition', 'timing', 'impulse-control'],
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
    // Clear any existing timeouts and animations
    if (spinTimeoutRef.current) {
      clearTimeout(spinTimeoutRef.current);
      spinTimeoutRef.current = null;
    }
    if (signalTimeoutRef.current) {
      clearTimeout(signalTimeoutRef.current);
      signalTimeoutRef.current = null;
    }
    if (rotationAnimationRef.current) {
      rotationAnimationRef.current.stop();
      rotationAnimationRef.current = null;
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
    setSpinnerColor('spinning');
    objectScale.setValue(0);
    objectOpacity.setValue(0);
    spinnerScale.setValue(1);
    spinnerRotation.setValue(0);
    shakeAnimation.setValue(0);
    waitIndicatorOpacity.setValue(0);

    // Select random object
    const objIndex = Math.floor(Math.random() * OBJECTS.length);
    setCurrentObject(objIndex);

    // Animate object appearance with bounce
    Animated.parallel([
      Animated.spring(objectScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(objectOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Start spinner rotation animation
    rotationAnimationRef.current = Animated.loop(
      Animated.timing(spinnerRotation, {
        toValue: 1,
        duration: 600,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    rotationAnimationRef.current.start();

    speak('Wait for the signal...');

    // After spinning, show color (randomly green or red)
    spinTimeoutRef.current = (setTimeout(() => {
      const isGreen = Math.random() > 0.35; // 65% chance green (more opportunities)
      const color = isGreen ? 'green' : 'red';
      setSpinnerColor(color);
      setCanTap(isGreen);

      // Stop rotation animation
      if (rotationAnimationRef.current) {
        rotationAnimationRef.current.stop();
        rotationAnimationRef.current = null;
      }
      spinnerRotation.setValue(0);

      // Pulse animation for green signal
      if (isGreen) {
        pulseAnimationRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(spinnerScale, {
              toValue: 1.25,
              duration: 500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(spinnerScale, {
              toValue: 1,
              duration: 500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        );
        pulseAnimationRef.current.start();
        speak('Tap now!');
      } else {
        // For red, show subtle wait indicator after a moment
        setTimeout(() => {
          Animated.timing(waitIndicatorOpacity, {
            toValue: 0.7,
            duration: 500,
            useNativeDriver: true,
          }).start();
        }, 800);
        speak('Wait!');
      }

      // Auto-advance after duration
      const duration = isGreen ? GREEN_DURATION_MS : RED_DURATION_MS;
      signalTimeoutRef.current = (setTimeout(() => {
        if (isGreen && canTap && !isProcessing) {
          // Green signal expired without tap - missed opportunity
          setMissedOpportunities(prev => prev + 1);
          speak('Time\'s up!');
        } else if (!isGreen && !isProcessing) {
          // Red signal completed without tap - correct wait!
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

        // Hide object and advance
        Animated.timing(objectOpacity, {
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
        
        signalTimeoutRef.current = null;
      }, duration)) as unknown as NodeJS.Timeout;
      
      spinTimeoutRef.current = null;
    }, SPIN_DURATION_MS)) as unknown as NodeJS.Timeout;
  }, [rounds, requiredRounds, canTap, isProcessing, advanceToNextRound]);

  const handleObjectTap = useCallback(() => {
    // Prevent multiple taps during processing
    if (isProcessing) return;

    // Clear the auto-advance timeout since user is interacting
    if (signalTimeoutRef.current) {
      clearTimeout(signalTimeoutRef.current);
      signalTimeoutRef.current = null;
    }

    // Stop pulse animation if running
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }

    setIsProcessing(true);

    if (spinnerColor === 'green' && canTap) {
      // Correct tap on green
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Success animation - bigger celebration
      Animated.sequence([
        Animated.parallel([
          Animated.timing(objectScale, {
            toValue: 1.4,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.timing(spinnerScale, {
            toValue: 1.6,
            duration: 250,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(objectScale, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.timing(spinnerScale, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Show success animation instead of TTS
      setShowRoundSuccess(true);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);

      // Hide object and advance
      Animated.timing(objectOpacity, {
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
    } else if (spinnerColor === 'red') {
      // Incorrect tap on red
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
        Animated.timing(spinnerScale, {
          toValue: 0.85,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(spinnerScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      speak('Wait for green!');

      // Don't advance - let them see the error and continue
      setTimeout(() => {
        setIsProcessing(false);
      }, 1000);
    } else if (spinnerColor === 'spinning') {
      // Tap during spinning - gentle feedback
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
      speak('Wait for the signal...');
      setIsProcessing(false);
    } else {
      setIsProcessing(false);
    }
  }, [spinnerColor, canTap, isProcessing, advanceToNextRound]);

  // Check if game should finish when rounds change
  useEffect(() => {
    if (rounds >= requiredRounds && !gameFinished) {
      finishGame();
    }
  }, [rounds, requiredRounds, gameFinished, finishGame]);

  useEffect(() => {
    // Give clear instructions before starting
    speak('Watch the spinner! Tap when it turns green! Wait when it turns red! Don\'t tap during red!');
    setTimeout(() => {
      startRound();
    }, 4000);
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current);
        spinTimeoutRef.current = null;
      }
      if (signalTimeoutRef.current) {
        clearTimeout(signalTimeoutRef.current);
        signalTimeoutRef.current = null;
      }
      if (rotationAnimationRef.current) {
        rotationAnimationRef.current.stop();
        rotationAnimationRef.current = null;
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

  const rotation = spinnerRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const shake = shakeAnimation.interpolate({
    inputRange: [-15, 15],
    outputRange: [-15, 15],
  });

  const object = OBJECTS[currentObject];
  const spinnerBgColor = spinnerColor === 'green' ? '#22C55E' : spinnerColor === 'red' ? '#EF4444' : '#94A3B8';

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0F9FF', '#E0F2FE']}
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
            <Text style={styles.title}>Wait for the Signal</Text>
            <Text style={styles.subtitle}>
              {spinnerColor === 'green' ? 'Tap now! Green signal!' : spinnerColor === 'red' ? 'Wait! Red signal!' : 'Watch the spinner...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          <Pressable
            onPress={handleObjectTap}
            disabled={isProcessing && spinnerColor === 'red'}
            style={styles.objectContainer}
          >
            <Animated.View
              style={[
                styles.object,
                {
                  transform: [
                    { scale: objectScale },
                    { translateX: shake },
                  ],
                  opacity: objectOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={object.color as [string, string, ...string[]]}
                style={styles.objectGradient}
              >
                <Text style={styles.objectEmoji}>{object.emoji}</Text>
                
                {/* Spinner */}
                <Animated.View
                  style={[
                    styles.spinner,
                    {
                      backgroundColor: spinnerBgColor,
                      transform: [
                        { rotate: rotation },
                        { scale: spinnerScale },
                      ],
                    },
                  ]}
                >
                  {spinnerColor === 'spinning' && (
                    <Text style={styles.spinnerText}>⏳</Text>
                  )}
                  {spinnerColor === 'green' && (
                    <Text style={styles.spinnerText}>✓</Text>
                  )}
                  {spinnerColor === 'red' && (
                    <Text style={styles.spinnerText}>✗</Text>
                  )}
                </Animated.View>
              </LinearGradient>
            </Animated.View>
          </Pressable>

          {/* Wait Indicator for RED signal */}
          {spinnerColor === 'red' && (
            <Animated.View
              style={[
                styles.waitIndicator,
                {
                  opacity: waitIndicatorOpacity,
                },
              ]}
            >
              <Ionicons name="hand-left-outline" size={28} color="#FFFFFF" />
              <Text style={styles.waitText}>Good waiting!</Text>
            </Animated.View>
          )}

          {/* Progress */}
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>
              Round {rounds + 1} / {requiredRounds}
            </Text>
            <Text style={styles.statsText}>
              ✓ Correct: {correctTaps} • ⏸ Waited: {correctWaits} • ✗ Errors: {incorrectTaps}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="hourglass" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Waiting</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="hand-left" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Inhibition</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="time" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Timing</Text>
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
  objectContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  object: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
  },
  objectGradient: {
    width: '100%',
    height: '100%',
    borderRadius: OBJECT_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 12,
  },
  objectEmoji: {
    fontSize: 70,
  },
  spinner: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: SPINNER_SIZE,
    height: SPINNER_SIZE,
    borderRadius: SPINNER_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  spinnerText: {
    fontSize: 24,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  waitIndicator: {
    position: 'absolute',
    top: OBJECT_SIZE + 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.25)',
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
