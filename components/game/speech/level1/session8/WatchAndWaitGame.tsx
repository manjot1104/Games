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

const OBJECT_SIZE = 120;
const RING_SIZE = 200;
const DEFAULT_TTS_RATE = 0.75;
const MOVEMENT_DURATION_MS = 5500; // 5.5 seconds to reach target (slightly longer for better anticipation)
const WAIT_DURATION_MS = 600; // Brief pause before ring appears
const RING_DURATION_MS = 3500; // How long ring is available (increased for better response time)

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

const MOVING_OBJECTS = [
  { emoji: '🎈', name: 'balloon', color: ['#EF4444', '#DC2626'], trailColor: '#FEE2E2' },
  { emoji: '🚀', name: 'rocket', color: ['#3B82F6', '#2563EB'], trailColor: '#DBEAFE' },
  { emoji: '🦋', name: 'butterfly', color: ['#EC4899', '#DB2777'], trailColor: '#FCE7F3' },
  { emoji: '⭐', name: 'star', color: ['#FCD34D', '#FBBF24'], trailColor: '#FEF3C7' },
  { emoji: '🎈', name: 'balloon2', color: ['#8B5CF6', '#7C3AED'], trailColor: '#EDE9FE' },
  { emoji: '🌙', name: 'moon', color: ['#6366F1', '#4F46E5'], trailColor: '#E0E7FF' },
];

export const WatchAndWaitGame: React.FC<Props> = ({
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
  const [currentObject, setCurrentObject] = useState<number>(0);
  const [phase, setPhase] = useState<'waiting' | 'moving' | 'ready' | 'completed'>('waiting');
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [movementProgress, setMovementProgress] = useState(0);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [earlyTaps, setEarlyTaps] = useState(0);
  const [missedTaps, setMissedTaps] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const objectX = useRef(new Animated.Value(0)).current;
  const objectY = useRef(new Animated.Value(0)).current;
  const objectScale = useRef(new Animated.Value(1)).current;
  const objectRotation = useRef(new Animated.Value(0)).current;
  const objectOpacity = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const ringPulse = useRef(new Animated.Value(1)).current;
  const statusCircleScale = useRef(new Animated.Value(0)).current;
  const statusCircleOpacity = useRef(new Animated.Value(0)).current;
  const statusTextOpacity = useRef(new Animated.Value(0)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;
  const trailOpacity = useRef(new Animated.Value(0)).current;
  const celebrationScale = useRef(new Animated.Value(0)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  
  // Timeouts and intervals
  const movementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ringTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const rotationAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);

  const finishGame = useCallback(async () => {
    // Clear all timeouts and animations
    if (movementTimeoutRef.current) {
      clearTimeout(movementTimeoutRef.current);
      movementTimeoutRef.current = null;
    }
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
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

    const totalAttempts = correctTaps + earlyTaps + missedTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 28;

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
        type: 'watch-and-wait',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['sustained-attention', 'visual-tracking', 'timing', 'impulse-control'],
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
    }, 900);
  }, [requiredRounds]);

  const startRound = useCallback(() => {
    // Clear all timeouts and animations
    if (movementTimeoutRef.current) {
      clearTimeout(movementTimeoutRef.current);
      movementTimeoutRef.current = null;
    }
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (rotationAnimationRef.current) {
      rotationAnimationRef.current.stop();
      rotationAnimationRef.current = null;
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
    setPhase('waiting');
    setMovementProgress(0);
    
    // Reset animations - position object at start (left side, center vertically)
    // Use absolute positioning - account for object size to center it
    const startX = SCREEN_WIDTH * 0.1 - OBJECT_SIZE / 2;
    const startY = SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2;
    objectX.setValue(startX);
    objectY.setValue(startY);
    objectScale.setValue(1);
    objectRotation.setValue(0);
    objectOpacity.setValue(0);
    ringScale.setValue(0);
    ringOpacity.setValue(0);
    ringPulse.setValue(1);
    statusCircleScale.setValue(0);
    statusCircleOpacity.setValue(0);
    statusTextOpacity.setValue(0);
    progressBarWidth.setValue(0);
    trailOpacity.setValue(0);
    celebrationScale.setValue(0);
    celebrationOpacity.setValue(0);

    // Select random object
    const objIndex = Math.floor(Math.random() * MOVING_OBJECTS.length);
    setCurrentObject(objIndex);

    // Show WAIT indicator
    Animated.parallel([
      Animated.spring(statusCircleScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(statusCircleOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(statusTextOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    speak('Wait...');

    // Animate object appearance
    Animated.parallel([
      Animated.timing(objectOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(objectScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    // Start gentle rotation animation
    rotationAnimationRef.current = Animated.loop(
      Animated.timing(objectRotation, {
        toValue: 1,
        duration: 2500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    rotationAnimationRef.current.start();

    // Start movement after brief delay
    setTimeout(() => {
      setPhase('moving');
      
      // Hide WAIT indicator
      Animated.parallel([
        Animated.timing(statusCircleOpacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(statusTextOpacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();

      // Show trail effect
      Animated.timing(trailOpacity, {
        toValue: 0.4,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Move object slowly to target position (right side, center vertically)
      const targetX = SCREEN_WIDTH * 0.7 - OBJECT_SIZE / 2;
      const targetY = SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2;
      
      // Animate progress bar
      Animated.timing(progressBarWidth, {
        toValue: SCREEN_WIDTH * 0.6,
        duration: MOVEMENT_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: false,
      }).start();

      // Update progress percentage
      const startTime = Date.now();
      progressIntervalRef.current = (setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / MOVEMENT_DURATION_MS, 1);
        setMovementProgress(progress);
      }, 100)) as unknown as NodeJS.Timeout;
      
      Animated.parallel([
        Animated.timing(objectX, {
          toValue: targetX,
          duration: MOVEMENT_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false, // Must be false for left/top positioning
        }),
        Animated.timing(objectY, {
          toValue: targetY,
          duration: MOVEMENT_DURATION_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false, // Must be false for left/top positioning
        }),
      ]).start();

      // After movement completes, show ring
      movementTimeoutRef.current = (setTimeout(() => {
        // Stop rotation
        if (rotationAnimationRef.current) {
          rotationAnimationRef.current.stop();
          rotationAnimationRef.current = null;
        }
        objectRotation.setValue(0);

        // Clear progress interval
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current);
          progressIntervalRef.current = null;
        }
        setMovementProgress(1);

        // Hide progress bar
        Animated.timing(progressBarWidth, {
          toValue: 0,
          duration: 300,
          useNativeDriver: false,
        }).start();

        setPhase('ready');
        
        // Show TAP NOW indicator
        Animated.parallel([
          Animated.spring(statusCircleScale, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(statusCircleOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(statusTextOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();

        // Show glowing ring with bounce
        Animated.parallel([
          Animated.spring(ringScale, {
            toValue: 1,
            tension: 40,
            friction: 6,
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0.95,
            duration: 500,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        // Pulse animation for ring
        pulseAnimationRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(ringPulse, {
              toValue: 1.2,
              duration: 700,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(ringPulse, {
              toValue: 1,
              duration: 700,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        );
        pulseAnimationRef.current.start();

        setCanTap(true);
        speak('Tap now!');

        // Ring expires after duration - use ref to avoid stale closure
        ringTimeoutRef.current = (setTimeout(() => {
          // Check current state, not closure state
          setCanTap(currentCanTap => {
            setIsProcessing(currentIsProcessing => {
              if (currentCanTap && !currentIsProcessing) {
                setMissedTaps(prev => prev + 1);
                speak('Time\'s up!');
              }
              return currentIsProcessing;
            });
            return currentCanTap;
          });
          
          // Hide ring and advance
          Animated.parallel([
            Animated.timing(ringOpacity, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(objectOpacity, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(statusCircleOpacity, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(statusTextOpacity, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(trailOpacity, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }),
          ]).start(() => {
            setRounds(prev => {
              const nextRound = prev + 1;
              advanceToNextRoundRef.current?.(nextRound);
              return nextRound;
            });
          });
          
          ringTimeoutRef.current = null;
        }, RING_DURATION_MS)) as unknown as NodeJS.Timeout;
        
        movementTimeoutRef.current = null;
      }, MOVEMENT_DURATION_MS + WAIT_DURATION_MS)) as unknown as NodeJS.Timeout;
    }, 600);
  }, [rounds, requiredRounds, SCREEN_WIDTH, SCREEN_HEIGHT]);

  const handleTap = useCallback(() => {
    if (isProcessing) return;

    // Clear timeouts
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }

    // Stop animations
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }

    setIsProcessing(true);

    if (phase === 'ready' && canTap) {
      // Correct tap
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);
      setPhase('completed');

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Celebration animation
      Animated.parallel([
        Animated.sequence([
          Animated.parallel([
            Animated.timing(objectScale, {
              toValue: 1.5,
              duration: 250,
              useNativeDriver: true,
            }),
            Animated.timing(ringScale, {
              toValue: 1.4,
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
            Animated.timing(ringScale, {
              toValue: 1,
              duration: 250,
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.parallel([
          Animated.spring(celebrationScale, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(celebrationOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Hide celebration after delay
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(celebrationScale, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(celebrationOpacity, {
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
        Animated.timing(ringOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(objectOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(statusCircleOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(statusTextOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(trailOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setRounds(prev => {
          const nextRound = prev + 1;
          advanceToNextRoundRef.current?.(nextRound);
          return nextRound;
        });
      });
    } else if (phase === 'moving' || phase === 'waiting') {
      // Early tap
      setEarlyTaps(prev => prev + 1);

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      // More pronounced feedback for early tap
      Animated.sequence([
        Animated.parallel([
          Animated.timing(objectScale, {
            toValue: 0.85,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(objectRotation, {
            toValue: 0.1,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(objectScale, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(objectRotation, {
            toValue: 0,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      speak('Wait for the signal!');
      setIsProcessing(false);
    } else {
      setIsProcessing(false);
    }
  }, [phase, canTap, isProcessing]);

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
      speak('Watch and wait for the ring, then tap!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (movementTimeoutRef.current) {
        clearTimeout(movementTimeoutRef.current);
      }
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      if (rotationAnimationRef.current) {
        rotationAnimationRef.current.stop();
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

  const rotation = objectRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const ringPulseScale = Animated.multiply(ringScale, ringPulse);
  const object = MOVING_OBJECTS[currentObject];
  const isWaitPhase = phase === 'waiting' || phase === 'moving';

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
            <Text style={styles.title}>Watch and Wait</Text>
            <Text style={styles.subtitle}>
              {isWaitPhase ? `Watch the object move... ${Math.round(movementProgress * 100)}%` : phase === 'ready' ? 'Tap now when you see the ring!' : 'Get ready...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Status Indicator */}
          <View style={styles.statusContainer}>
            <Animated.View
              style={[
                styles.statusCircle,
                {
                  backgroundColor: isWaitPhase ? '#FCD34D' : '#22C55E',
                  transform: [{ scale: statusCircleScale }],
                  opacity: statusCircleOpacity,
                },
              ]}
            />
            <Animated.Text
              style={[
                styles.statusText,
                {
                  opacity: statusTextOpacity,
                  color: isWaitPhase ? '#D97706' : '#16A34A',
                },
              ]}
            >
              {isWaitPhase ? 'WAIT...' : phase === 'ready' ? 'TAP NOW!' : ''}
            </Animated.Text>
          </View>

          {/* Progress Bar */}
          {phase === 'moving' && (
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBackground}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      width: progressBarWidth,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          {/* Glowing Ring - Make it clickable */}
          {phase === 'ready' && (
            <Pressable
              onPress={handleTap}
              disabled={!canTap || isProcessing}
              style={[
                styles.ringContainer,
                {
                  left: SCREEN_WIDTH * 0.7 - (RING_SIZE + 60) / 2,
                  top: SCREEN_HEIGHT * 0.5 - (RING_SIZE + 60) / 2,
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.ring,
                  {
                    transform: [{ scale: ringPulseScale }],
                    opacity: ringOpacity,
                  },
                ]}
              >
                <LinearGradient
                  colors={['#22C55E', '#16A34A', '#22C55E']}
                  style={styles.ringGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                />
              </Animated.View>
            </Pressable>
          )}

          {/* Trail Effect */}
          {phase === 'moving' && (
            <Animated.View
              style={[
                styles.trail,
                {
                  left: SCREEN_WIDTH * 0.7 - 30,
                  top: SCREEN_HEIGHT * 0.5 - 30,
                  backgroundColor: object.trailColor,
                  opacity: trailOpacity,
                },
              ]}
            />
          )}

          {/* Moving Object */}
          <Animated.View
            style={[
              styles.objectContainer,
              {
                left: objectX,
                top: objectY,
                opacity: objectOpacity,
              },
            ]}
          >
            <Pressable
              onPress={handleTap}
              disabled={isProcessing && phase !== 'ready'}
              style={styles.objectPressable}
            >
              <Animated.View
                style={[
                  styles.object,
                  {
                    transform: [
                      { scale: objectScale },
                      { rotate: rotation },
                    ],
                  },
                ]}
              >
                <LinearGradient
                  colors={object.color as [string, string, ...string[]]}
                  style={styles.objectGradient}
                >
                  <Text style={styles.objectEmoji}>{object.emoji}</Text>
                </LinearGradient>
              </Animated.View>
            </Pressable>
          </Animated.View>

          {/* Celebration Effect */}
          <Animated.View
            style={[
              styles.celebration,
              {
                left: SCREEN_WIDTH * 0.7 - 50,
                top: SCREEN_HEIGHT * 0.5 - 50,
                transform: [{ scale: celebrationScale }],
                opacity: celebrationOpacity,
              },
            ]}
          >
            {['⭐', '✨', '🌟'].map((star, i) => (
              <Text
                key={i}
                style={[
                  styles.celebrationStar,
                  {
                    transform: [
                      { rotate: `${i * 120}deg` },
                      { translateY: -40 },
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
            <Text style={styles.progressText}>
              Round {rounds + 1} / {requiredRounds}
            </Text>
            <Text style={styles.statsText}>
              ✓ Perfect: {correctTaps} • ⏱ Early: {earlyTaps} • ✗ Missed: {missedTaps}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="eye" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Sustained Attention</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="move" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Visual Tracking</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="hand-left" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Impulse Control</Text>
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
    position: 'relative',
  },
  statusContainer: {
    position: 'absolute',
    top: 40,
    alignItems: 'center',
    justifyContent: 'center',
    width: 200,
    height: 80,
  },
  statusCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    position: 'absolute',
  },
  statusText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 70,
    textAlign: 'center',
  },
  progressBarContainer: {
    position: 'absolute',
    top: 120,
    width: '80%',
    alignItems: 'center',
  },
  progressBarBackground: {
    width: '100%',
    height: 10,
    backgroundColor: '#E5E7EB',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#FCD34D',
    borderRadius: 5,
  },
  ring: {
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
  },
  ringGradient: {
    width: '100%',
    height: '100%',
    borderRadius: RING_SIZE / 2,
    borderWidth: 10,
    borderColor: '#FFFFFF',
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 25,
    elevation: 20,
  },
  trail: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  ringContainer: {
    position: 'absolute',
    width: RING_SIZE + 60,
    height: RING_SIZE + 60,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 15,
  },
  objectContainer: {
    position: 'absolute',
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
  },
  objectPressable: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
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
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  objectEmoji: {
    fontSize: 60,
  },
  celebration: {
    position: 'absolute',
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  celebrationStar: {
    position: 'absolute',
    fontSize: 40,
  },
  statsContainer: {
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
