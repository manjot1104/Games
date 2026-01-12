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

const FLOWER_SIZE = 200;
const DEFAULT_TTS_RATE = 0.75;
const GROWTH_DURATION_MS = 5500; // 5.5 seconds to fully bloom (slightly longer for better patience practice)
const BLOOM_DURATION_MS = 4500; // How long bloomed flower is available (increased for better response time)

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

const FLOWER_COLORS = [
  { petal: ['#EC4899', '#DB2777'], center: ['#FCD34D', '#FBBF24'], stem: '#22C55E', name: 'Pink Rose' },
  { petal: ['#3B82F6', '#2563EB'], center: ['#FCD34D', '#FBBF24'], stem: '#16A34A', name: 'Blue Flower' },
  { petal: ['#8B5CF6', '#7C3AED'], center: ['#FCD34D', '#FBBF24'], stem: '#22C55E', name: 'Purple Bloom' },
  { petal: ['#F59E0B', '#D97706'], center: ['#FCD34D', '#FBBF24'], stem: '#16A34A', name: 'Orange Blossom' },
  { petal: ['#EC4899', '#F472B6'], center: ['#FCD34D', '#FBBF24'], stem: '#22C55E', name: 'Cherry Blossom' },
  { petal: ['#10B981', '#059669'], center: ['#FCD34D', '#FBBF24'], stem: '#16A34A', name: 'Green Flower' },
];

export const GrowingFlowerGame: React.FC<Props> = ({
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
  const [currentFlower, setCurrentFlower] = useState<number>(0);
  const [growthProgress, setGrowthProgress] = useState(0);
  const [isBloomed, setIsBloomed] = useState(false);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [earlyTaps, setEarlyTaps] = useState(0);
  const [missedTaps, setMissedTaps] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const flowerScale = useRef(new Animated.Value(0)).current;
  const petalRotation = useRef(new Animated.Value(0)).current;
  const petalScale = useRef(new Animated.Value(0)).current;
  const centerScale = useRef(new Animated.Value(0)).current;
  const stemHeight = useRef(new Animated.Value(0)).current;
  const flowerOpacity = useRef(new Animated.Value(0)).current;
  const bloomPulse = useRef(new Animated.Value(1)).current;
  const celebrationScale = useRef(new Animated.Value(1)).current;
  const waitIndicatorOpacity = useRef(new Animated.Value(0)).current;
  const waitIndicatorScale = useRef(new Animated.Value(0)).current;
  const readyIndicatorOpacity = useRef(new Animated.Value(0)).current;
  const readyIndicatorScale = useRef(new Animated.Value(0)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;
  const sparklesOpacity = useRef(new Animated.Value(0)).current;
  const sparklesScale = useRef(new Animated.Value(0)).current;
  
  // Timeouts and intervals
  const growthTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const bloomTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const rotationAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);
  
  // Track animated values to avoid _value access
  const flowerScaleCurrentRef = useRef(0);
  const petalScaleCurrentRef = useRef(0);
  
  useEffect(() => {
    const flowerListener = flowerScale.addListener(({ value }) => {
      flowerScaleCurrentRef.current = value;
    });
    const petalListener = petalScale.addListener(({ value }) => {
      petalScaleCurrentRef.current = value;
    });
    return () => {
      flowerScale.removeListener(flowerListener);
      petalScale.removeListener(petalListener);
    };
  }, [flowerScale, petalScale]);

  const finishGame = useCallback(async () => {
    // Clear all timeouts and animations
    if (growthTimeoutRef.current) {
      clearTimeout(growthTimeoutRef.current);
      growthTimeoutRef.current = null;
    }
    if (bloomTimeoutRef.current) {
      clearTimeout(bloomTimeoutRef.current);
      bloomTimeoutRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    if (rotationAnimationRef.current) {
      rotationAnimationRef.current.stop();
      rotationAnimationRef.current = null;
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
        type: 'growing-flower',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['patience', 'delayed-gratification', 'sustained-attention', 'impulse-control'],
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
    if (growthTimeoutRef.current) {
      clearTimeout(growthTimeoutRef.current);
      growthTimeoutRef.current = null;
    }
    if (bloomTimeoutRef.current) {
      clearTimeout(bloomTimeoutRef.current);
      bloomTimeoutRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    if (rotationAnimationRef.current) {
      rotationAnimationRef.current.stop();
      rotationAnimationRef.current = null;
    }

    if (rounds >= requiredRounds) {
      return;
    }

    // Reset state
    setIsProcessing(false);
    setCanTap(false);
    setIsBloomed(false);
    setGrowthProgress(0);
    
    // Reset animations
    flowerScale.setValue(0);
    petalRotation.setValue(0);
    petalScale.setValue(0);
    centerScale.setValue(0);
    stemHeight.setValue(0);
    flowerOpacity.setValue(0);
    bloomPulse.setValue(1);
    celebrationScale.setValue(1);
    waitIndicatorOpacity.setValue(0);
    waitIndicatorScale.setValue(0);
    readyIndicatorOpacity.setValue(0);
    readyIndicatorScale.setValue(0);
    progressBarWidth.setValue(0);
    sparklesOpacity.setValue(0);
    sparklesScale.setValue(0);

    // Select random flower
    const flowerIndex = Math.floor(Math.random() * FLOWER_COLORS.length);
    setCurrentFlower(flowerIndex);

    // Show WAIT indicator
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

    speak('Watch the flower grow...');

    // Animate flower appearance - first show it, then grow it
    Animated.sequence([
      // Fade in and show at small size
      Animated.parallel([
        Animated.timing(flowerOpacity, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(flowerScale, {
          toValue: 0.2,
          duration: 400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
      // Then grow to full size
      Animated.parallel([
        Animated.timing(flowerScale, {
          toValue: 1,
          duration: GROWTH_DURATION_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(petalScale, {
          toValue: 1,
          duration: GROWTH_DURATION_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(petalRotation, {
          toValue: 1,
          duration: GROWTH_DURATION_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Grow stem first (40% of time)
    Animated.timing(stemHeight, {
      toValue: 1,
      duration: GROWTH_DURATION_MS * 0.4,
      delay: 400, // Start after initial appearance
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

    // Grow flower center (starts at 30% of growth time)
    Animated.timing(centerScale, {
      toValue: 1,
      duration: GROWTH_DURATION_MS * 0.7,
      delay: 400 + GROWTH_DURATION_MS * 0.3, // Start after initial appearance + delay
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    // Animate progress bar
    Animated.timing(progressBarWidth, {
      toValue: SCREEN_WIDTH * 0.6,
      duration: GROWTH_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Update progress percentage (account for initial 400ms appearance delay)
    const INITIAL_DELAY_MS = 400;
    const TOTAL_GROWTH_TIME = INITIAL_DELAY_MS + GROWTH_DURATION_MS;
    const startTime = Date.now();
    progressIntervalRef.current = (setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(Math.max(0, (elapsed - INITIAL_DELAY_MS) / GROWTH_DURATION_MS), 1);
      setGrowthProgress(progress);
    }, 100)) as unknown as NodeJS.Timeout;

    // After growth completes, flower is bloomed (account for initial 400ms appearance delay)
    growthTimeoutRef.current = (setTimeout(() => {
      // Stop rotation
      if (rotationAnimationRef.current) {
        rotationAnimationRef.current.stop();
        rotationAnimationRef.current = null;
      }
      petalRotation.setValue(0);

      // Clear progress interval
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      setGrowthProgress(1);

      // Hide WAIT indicator
      Animated.parallel([
        Animated.timing(waitIndicatorOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(waitIndicatorScale, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Show READY indicator
      Animated.parallel([
        Animated.spring(readyIndicatorScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(readyIndicatorOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Show sparkles
      Animated.parallel([
        Animated.spring(sparklesScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(sparklesOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start();

      setIsBloomed(true);
      setCanTap(true);

      // Pulse animation for bloomed flower
      pulseAnimationRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(bloomPulse, {
            toValue: 1.12,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(bloomPulse, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimationRef.current.start();

      speak('Tap the flower!');

      // Flower expires after duration - use functional state update to avoid stale closure
      bloomTimeoutRef.current = (setTimeout(() => {
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
        
        // Hide flower and advance
        Animated.parallel([
          Animated.timing(flowerOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(readyIndicatorOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(sparklesOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(progressBarWidth, {
            toValue: 0,
            duration: 500,
            useNativeDriver: false,
          }),
        ]).start(() => {
          setRounds(prev => {
            const nextRound = prev + 1;
            advanceToNextRoundRef.current?.(nextRound);
            return nextRound;
          });
        });
        
        bloomTimeoutRef.current = null;
      }, BLOOM_DURATION_MS)) as unknown as NodeJS.Timeout;
      
      growthTimeoutRef.current = null;
    }, GROWTH_DURATION_MS)) as unknown as NodeJS.Timeout;
  }, [rounds, requiredRounds]);

  const handleFlowerTap = useCallback(() => {
    if (isProcessing) return;

    // Clear timeouts
    if (bloomTimeoutRef.current) {
      clearTimeout(bloomTimeoutRef.current);
      bloomTimeoutRef.current = null;
    }

    // Stop animations
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }

    setIsProcessing(true);

    if (isBloomed && canTap) {
      // Correct tap on bloomed flower
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Enhanced celebration animation
      Animated.parallel([
        Animated.sequence([
          Animated.parallel([
            Animated.timing(celebrationScale, {
              toValue: 1.4,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(petalScale, {
              toValue: 1.3,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(centerScale, {
              toValue: 1.2,
              duration: 300,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(celebrationScale, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(petalScale, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(centerScale, {
              toValue: 1,
              duration: 300,
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.timing(sparklesScale, {
            toValue: 1.5,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(sparklesScale, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Show success animation instead of TTS
      setShowRoundSuccess(true);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);

      // Hide flower and advance
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(flowerOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(readyIndicatorOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(sparklesOpacity, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(progressBarWidth, {
            toValue: 0,
            duration: 500,
            useNativeDriver: false,
          }),
        ]).start(() => {
          setRounds(prev => {
            const nextRound = prev + 1;
            advanceToNextRoundRef.current?.(nextRound);
            return nextRound;
          });
        });
      }, 800);
    } else {
      // Early tap
      setEarlyTaps(prev => prev + 1);

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      // More pronounced feedback for early tap
      Animated.sequence([
        Animated.parallel([
          Animated.timing(flowerScale, {
            toValue: 0.9,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(petalScale, {
            toValue: 0.9,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(flowerScale, {
            toValue: isBloomed ? 1 : flowerScaleCurrentRef.current,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(petalScale, {
            toValue: isBloomed ? 1 : petalScaleCurrentRef.current,
            duration: 150,
            useNativeDriver: true,
          }),
        ]),
      ]).start();

      // Show wait indicator briefly
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

      speak('Wait for it to bloom!');
      setIsProcessing(false);
    }
  }, [isBloomed, canTap, isProcessing]);

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
      speak('Watch the flower grow, then tap when it blooms!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (growthTimeoutRef.current) {
        clearTimeout(growthTimeoutRef.current);
      }
      if (bloomTimeoutRef.current) {
        clearTimeout(bloomTimeoutRef.current);
      }
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
      if (pulseAnimationRef.current) {
        pulseAnimationRef.current.stop();
      }
      if (rotationAnimationRef.current) {
        rotationAnimationRef.current.stop();
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

  const petalRot = petalRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const stemHeightValue = stemHeight.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 100],
  });

  const flower = FLOWER_COLORS[currentFlower];
  const bloomScale = Animated.multiply(flowerScale, bloomPulse);
  const finalPetalScale = Animated.multiply(petalScale, celebrationScale);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#D1FAE5', '#A7F3D0']}
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
            <Text style={styles.title}>Growing Flower</Text>
            <Text style={styles.subtitle}>
              {isBloomed ? 'Tap the beautiful flower!' : `Watch it grow... ${Math.round(growthProgress * 100)}%`}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Wait Indicator */}
          {!isBloomed && (
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
                <Ionicons name="hourglass-outline" size={32} color="#FFFFFF" />
                <Text style={styles.waitText}>WAIT...</Text>
              </View>
            </Animated.View>
          )}

          {/* Ready Indicator */}
          {isBloomed && (
            <Animated.View
              style={[
                styles.readyIndicator,
                {
                  transform: [{ scale: readyIndicatorScale }],
                  opacity: readyIndicatorOpacity,
                },
              ]}
            >
              <View style={styles.readyCircle}>
                <Text style={styles.readyText}>TAP NOW!</Text>
              </View>
            </Animated.View>
          )}

          {/* Sparkles around flower when ready */}
          {isBloomed && (
            <Animated.View
              style={[
                styles.sparklesContainer,
                {
                  transform: [{ scale: sparklesScale }],
                  opacity: sparklesOpacity,
                },
              ]}
            >
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
                const angle = (i * 45) * (Math.PI / 180);
                const radius = 120;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                return (
                  <Text
                    key={i}
                    style={[
                      styles.sparkle,
                      {
                        transform: [
                          { translateX: x },
                          { translateY: y },
                        ],
                      },
                    ]}
                  >
                    ✨
                  </Text>
                );
              })}
            </Animated.View>
          )}

          {/* Flower */}
          <Pressable
            onPress={handleFlowerTap}
            disabled={isProcessing && !isBloomed}
            style={styles.flowerContainer}
          >
            <Animated.View
              style={[
                styles.flowerWrapper,
                {
                  transform: [{ scale: isBloomed ? bloomScale : flowerScale }],
                  opacity: flowerOpacity,
                },
              ]}
            >
              {/* Stem */}
              <Animated.View
                style={[
                  styles.stem,
                  {
                    height: stemHeightValue,
                    backgroundColor: flower.stem,
                  },
                ]}
              />

              {/* Flower Center */}
              <Animated.View
                style={[
                  styles.flowerCenter,
                  {
                    transform: [{ scale: centerScale }],
                  },
                ]}
              >
                <LinearGradient
                  colors={flower.center as [string, string, ...string[]]}
                  style={styles.centerGradient}
                >
                  <Text style={styles.centerEmoji}>🌻</Text>
                </LinearGradient>
              </Animated.View>

              {/* Petals */}
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const angle = (i * 60) * (Math.PI / 180);
                const radius = 55;
                const x = Math.cos(angle) * radius;
                const y = Math.sin(angle) * radius;
                
                return (
                  <Animated.View
                    key={i}
                    style={[
                      styles.petal,
                      {
                        transform: [
                          { translateX: x },
                          { translateY: y },
                          { rotate: isBloomed ? '0deg' : petalRot },
                          { scale: finalPetalScale },
                        ],
                      },
                    ]}
                  >
                    <LinearGradient
                      colors={flower.petal as [string, string, ...string[]]}
                      style={styles.petalGradient}
                    />
                  </Animated.View>
                );
              })}
            </Animated.View>
          </Pressable>

          {/* Progress Bar */}
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBarBackground}>
              <Animated.View
                style={[
                  styles.progressBarFill,
                  {
                    width: progressBarWidth,
                    backgroundColor: isBloomed ? '#22C55E' : '#FCD34D',
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {isBloomed ? '✓ Fully Bloomed!' : `${Math.round(growthProgress * 100)}%`}
            </Text>
          </View>

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
            <Ionicons name="hourglass" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Patience</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="gift" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Delayed Gratification</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="eye" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Sustained Attention</Text>
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
  waitIndicator: {
    position: 'absolute',
    top: 40,
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
    shadowColor: '#FCD34D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 15,
    elevation: 15,
  },
  waitText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#D97706',
    marginTop: 4,
  },
  readyIndicator: {
    position: 'absolute',
    top: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyCircle: {
    width: 120,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 20,
  },
  readyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  sparklesContainer: {
    position: 'absolute',
    width: 300,
    height: 300,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sparkle: {
    position: 'absolute',
    fontSize: 30,
  },
  flowerContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  flowerWrapper: {
    width: FLOWER_SIZE,
    height: FLOWER_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  stem: {
    position: 'absolute',
    bottom: -50,
    width: 10,
    borderRadius: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  flowerCenter: {
    width: 70,
    height: 70,
    borderRadius: 35,
    zIndex: 10,
  },
  centerGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  centerEmoji: {
    fontSize: 40,
  },
  petal: {
    position: 'absolute',
    width: 45,
    height: 70,
    borderRadius: 22.5,
  },
  petalGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 22.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  progressBarContainer: {
    position: 'absolute',
    bottom: 140,
    width: '80%',
    alignItems: 'center',
  },
  progressBarBackground: {
    width: '100%',
    height: 14,
    backgroundColor: '#E5E7EB',
    borderRadius: 7,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 7,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
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
