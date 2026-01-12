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

const TARGET_SIZE = 160;
const DISTRACTION_SIZE = 100;
const DEFAULT_TTS_RATE = 0.75;
const DISTRACTION_DURATION_MS = 3000;
const TAP_TIMEOUT_MS = 6000;

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

const TARGETS = [
  { emoji: '⚽', name: 'ball', color: ['#3B82F6', '#2563EB'] },
  { emoji: '⭐', name: 'star', color: ['#FCD34D', '#FBBF24'] },
  { emoji: '🎈', name: 'balloon', color: ['#EC4899', '#DB2777'] },
  { emoji: '🍎', name: 'apple', color: ['#EF4444', '#DC2626'] },
];

const DISTRACTIONS = [
  { emoji: '🦋', name: 'butterfly', color: ['#8B5CF6', '#7C3AED'] },
  { emoji: '🐦', name: 'bird', color: ['#10B981', '#059669'] },
  { emoji: '✨', name: 'sparkle', color: ['#FCD34D', '#FBBF24'] },
  { emoji: '🌙', name: 'moon', color: ['#94A3B8', '#64748B'] },
];

export const TapTheTargetIgnoreDistractionGame: React.FC<Props> = ({
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
    distractionTaps: number;
    missedTaps: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [target, setTarget] = useState<typeof TARGETS[0] | null>(null);
  const [distraction, setDistraction] = useState<typeof DISTRACTIONS[0] | null>(null);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [distractionTaps, setDistractionTaps] = useState(0);
  const [missedTaps, setMissedTaps] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [showDistraction, setShowDistraction] = useState(false);
  
  // Animations
  const targetScale = useRef(new Animated.Value(0)).current;
  const targetOpacity = useRef(new Animated.Value(0)).current;
  const targetPulse = useRef(new Animated.Value(1)).current;
  const targetGlow = useRef(new Animated.Value(0)).current;
  const targetGlowOpacity = useRef(new Animated.Value(0)).current;
  const distractionX = useRef(new Animated.Value(0)).current;
  const distractionY = useRef(new Animated.Value(0)).current;
  const distractionScale = useRef(new Animated.Value(0)).current;
  const distractionOpacity = useRef(new Animated.Value(0)).current;
  const distractionRotation = useRef(new Animated.Value(0)).current;
  const orbitAngle = useRef(new Animated.Value(0)).current;
  const celebrationScale = useRef(new Animated.Value(1)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  const warningScale = useRef(new Animated.Value(1)).current;
  const warningOpacity = useRef(new Animated.Value(0)).current;
  const particleOpacity = useRef(new Animated.Value(0)).current;
  
  // Track warningOpacity value to avoid _value access
  const warningOpacityCurrentRef = useRef(0);
  
  useEffect(() => {
    const listener = warningOpacity.addListener(({ value }) => {
      warningOpacityCurrentRef.current = value;
    });
    return () => {
      warningOpacity.removeListener(listener);
    };
  }, [warningOpacity]);
  
  // Timeouts and animations
  const distractionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const distractionAnimationRef = useRef<NodeJS.Timeout | null>(null);
  const distractionRotationAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);

  const finishGame = useCallback(async () => {
    if (distractionTimeoutRef.current) {
      clearTimeout(distractionTimeoutRef.current);
      distractionTimeoutRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if ((distractionAnimationRef as any).current) {
      const { animation, listenerId } = (distractionAnimationRef as any).current;
      animation.stop();
      orbitAngle.removeListener(listenerId);
      (distractionAnimationRef as any).current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const totalAttempts = correctTaps + distractionTaps + missedTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 36;

    setFinalStats({
      totalRounds: requiredRounds,
      correctTaps,
      distractionTaps,
      missedTaps,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'tap-the-target-ignore-distraction',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['selective-attention', 'filtering-distractions', 'impulse-control', 'focus'],
        incorrectAttempts: distractionTaps + missedTaps,
        meta: {
          correctTaps,
          distractionTaps,
          missedTaps,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [correctTaps, distractionTaps, missedTaps, requiredRounds, onComplete]);

  const advanceToNextRound = useCallback((nextRound: number) => {
    if (nextRound >= requiredRounds) {
      return;
    }
    setTimeout(() => {
      startRoundRef.current?.();
    }, 1200);
  }, [requiredRounds]);

  const startRound = useCallback(() => {
    // Clear timeouts and animations
    if (distractionTimeoutRef.current) {
      clearTimeout(distractionTimeoutRef.current);
      distractionTimeoutRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (distractionAnimationRef.current) {
      const { animation, listenerId } = (distractionAnimationRef as any).current;
      animation.stop();
      orbitAngle.removeListener(listenerId);
      distractionAnimationRef.current = null;
    }
    if (distractionRotationAnimationRef.current) {
      distractionRotationAnimationRef.current.stop();
      distractionRotationAnimationRef.current = null;
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
    setShowDistraction(false);
    
    // Select random target and distraction
    const randomTarget = TARGETS[Math.floor(Math.random() * TARGETS.length)];
    const randomDistraction = DISTRACTIONS[Math.floor(Math.random() * DISTRACTIONS.length)];
    
    setTarget(randomTarget);
    setDistraction(randomDistraction);

    // Reset animations
    targetScale.setValue(0);
    targetOpacity.setValue(0);
    targetPulse.setValue(1);
    targetGlow.setValue(0);
    targetGlowOpacity.setValue(0);
    distractionX.setValue(0);
    distractionY.setValue(0);
    distractionScale.setValue(0);
    distractionOpacity.setValue(0);
    distractionRotation.setValue(0);
    orbitAngle.setValue(0);
    celebrationScale.setValue(1);
    celebrationOpacity.setValue(0);
    warningScale.setValue(1);
    warningOpacity.setValue(0);
    particleOpacity.setValue(0);

    // Show target
    Animated.parallel([
      Animated.spring(targetScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(targetOpacity, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse animation for target
    pulseAnimationRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(targetPulse, {
          toValue: 1.08,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(targetPulse, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulseAnimationRef.current.start();

    // Continuous glow for target to make it stand out
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(targetGlow, {
            toValue: 1.15,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(targetGlowOpacity, {
            toValue: 0.4,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(targetGlow, {
            toValue: 1,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(targetGlowOpacity, {
            toValue: 0.2,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    ).start();

    speak(`Tap the ${randomTarget.name}`);

    // Allow tapping
    setCanTap(true);

    // Show distraction after delay
    setTimeout(() => {
      setShowDistraction(true);
      
      // Target center position
      const targetCenterX = SCREEN_WIDTH / 2;
      const targetCenterY = SCREEN_HEIGHT / 2;
      
      // Orbit radius - distance from target center (ensure clear visibility around target)
      // Calculate radius so distraction orbits just outside the target's edge
      const orbitRadius = (TARGET_SIZE / 2) + (DISTRACTION_SIZE / 2) + 50; // 50px gap for visibility
      
      // Random starting angle for orbit (0 to 2π)
      const startAngle = Math.random() * Math.PI * 2;
      
      // Random orbit direction (clockwise or counterclockwise)
      const orbitDirection = Math.random() > 0.5 ? 1 : -1;
      
      // Number of full rotations during duration
      const totalRotations = 2.5;
      
      // Set initial angle
      orbitAngle.setValue(startAngle);
      
      // Calculate initial position on orbit
      const startX = targetCenterX + Math.cos(startAngle) * orbitRadius - DISTRACTION_SIZE / 2;
      const startY = targetCenterY + Math.sin(startAngle) * orbitRadius - DISTRACTION_SIZE / 2;
      
      distractionX.setValue(startX);
      distractionY.setValue(startY);
      
      // Animate distraction appearance
      Animated.parallel([
        Animated.spring(distractionScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(distractionOpacity, {
          toValue: 0.95, // More visible
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();

      // Create smooth orbital movement using Animated API
      // Animate the angle from startAngle to startAngle + (2π * rotations * direction)
      const endAngle = startAngle + (Math.PI * 2 * totalRotations * orbitDirection);
      
      // Create the orbital animation
      const orbitAnimation = Animated.timing(orbitAngle, {
        toValue: endAngle,
        duration: DISTRACTION_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: false, // Must be false for position animations
      });
      
      // Listen to angle changes and update position
      const listenerId = orbitAngle.addListener(({ value }) => {
        const currentX = targetCenterX + Math.cos(value) * orbitRadius - DISTRACTION_SIZE / 2;
        const currentY = targetCenterY + Math.sin(value) * orbitRadius - DISTRACTION_SIZE / 2;
        
        distractionX.setValue(currentX);
        distractionY.setValue(currentY);
      });
      
      // Store listener ID for cleanup
      (distractionAnimationRef as any).current = { animation: orbitAnimation, listenerId };
      
      // Start the orbital animation
      orbitAnimation.start();
      
      // Continuous rotation animation (distraction spinning on its own axis)
      distractionRotationAnimationRef.current = Animated.loop(
        Animated.timing(distractionRotation, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      distractionRotationAnimationRef.current.start();

      // Hide distraction after duration
      distractionTimeoutRef.current = (setTimeout(() => {
        // Stop orbit animation and remove listener
        if ((distractionAnimationRef as any).current) {
          const { animation, listenerId } = (distractionAnimationRef as any).current;
          animation.stop();
          orbitAngle.removeListener(listenerId);
          (distractionAnimationRef as any).current = null;
        }
        
        Animated.parallel([
          Animated.timing(distractionOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(distractionScale, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start(() => {
          setShowDistraction(false);
        });
        distractionTimeoutRef.current = null;
      }, DISTRACTION_DURATION_MS)) as unknown as NodeJS.Timeout;
    }, 1500);

    // Timeout for missed tap
    tapTimeoutRef.current = (setTimeout(() => {
      setMissedTaps(prev => prev + 1);
      speak('Try again!');
      
      // Hide and advance
      Animated.parallel([
        Animated.timing(targetOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(targetScale, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
      
      setTimeout(() => {
        setRounds(prev => {
          const nextRound = prev + 1;
          advanceToNextRoundRef.current?.(nextRound);
          return nextRound;
        });
      }, 400);
      
      tapTimeoutRef.current = null;
    }, TAP_TIMEOUT_MS)) as unknown as NodeJS.Timeout;
  }, [rounds, requiredRounds, SCREEN_WIDTH, SCREEN_HEIGHT]);

  const handleTargetTap = useCallback(() => {
    if (isProcessing || !canTap) return;

    setIsProcessing(true);

    // Clear timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }

    // Correct tap
    setCorrectTaps(prev => prev + 1);
    setCanTap(false);

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Celebration animation with particles
    Animated.parallel([
      Animated.sequence([
        Animated.timing(targetScale, {
          toValue: 1.5,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(targetScale, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(celebrationScale, {
          toValue: 1.3,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(celebrationOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(particleOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(particleOpacity, {
            toValue: 0,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();

    // Show success animation instead of TTS
    setShowRoundSuccess(true);
    setTimeout(() => {
      setShowRoundSuccess(false);
    }, 2500);

    // Hide and advance
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(targetOpacity, {
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
      
      setTimeout(() => {
        setRounds(prev => {
          const nextRound = prev + 1;
          advanceToNextRoundRef.current?.(nextRound);
          return nextRound;
        });
      }, 400);
    }, 1500);
  }, [isProcessing, canTap, targetScale]);

  const handleDistractionTap = useCallback(() => {
    if (isProcessing || !canTap) return;

    // Distraction tap
    setDistractionTaps(prev => prev + 1);

    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {}

    // Warning animation
    Animated.parallel([
      Animated.sequence([
        Animated.timing(distractionScale, {
          toValue: 0.8,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(distractionScale, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.spring(warningScale, {
          toValue: 1.1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(warningOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    speak(`Try the ${target?.name}!`);

    // Hide warning
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(warningOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(warningScale, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }, 2000);
  }, [isProcessing, canTap, target, distractionScale]);

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
      speak('Tap the target, ignore the moving distraction!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (distractionTimeoutRef.current) {
        clearTimeout(distractionTimeoutRef.current);
      }
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
      if (distractionAnimationRef.current) {
        const { animation, listenerId } = (distractionAnimationRef as any).current;
        animation.stop();
        orbitAngle.removeListener(listenerId);
      }
      if (distractionRotationAnimationRef.current) {
        distractionRotationAnimationRef.current.stop();
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

  if (!target) return null;

  const distractionRot = distractionRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const targetPulseScale = Animated.multiply(targetScale, targetPulse);

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
            <Text style={styles.title}>Tap the Target</Text>
            <Text style={styles.subtitle}>
              {canTap ? `Tap the ${target.name}!` : 'Get ready...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Warning Message */}
          {warningOpacityCurrentRef.current > 0 && (
            <Animated.View
              style={[
                styles.warningBanner,
                {
                  transform: [{ scale: warningScale }],
                  opacity: warningOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={['#EF4444', '#DC2626']}
                style={styles.warningGradient}
              >
                <Ionicons name="alert-circle" size={24} color="#FFFFFF" />
                <Text style={styles.warningText}>Focus on the target!</Text>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Target with Glow */}
          <Pressable
            onPress={handleTargetTap}
            disabled={!canTap || isProcessing}
            style={[
              styles.targetContainer,
              {
                left: SCREEN_WIDTH / 2 - TARGET_SIZE / 2,
                top: SCREEN_HEIGHT / 2 - TARGET_SIZE / 2,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.target,
                {
                  transform: [{ scale: targetPulseScale }],
                  opacity: targetOpacity,
                },
              ]}
            >
              {/* Glow ring around target */}
              <Animated.View
                style={[
                  styles.targetGlow,
                  {
                    transform: [{ scale: targetGlow }],
                    opacity: targetGlowOpacity,
                  },
                ]}
              />
              <LinearGradient
                colors={target.color as [string, string, ...string[]]}
                style={styles.targetGradient}
              >
                <Text style={styles.targetEmoji}>{target.emoji}</Text>
              </LinearGradient>
              {/* "TAP ME" indicator */}
              {canTap && (
                <View style={styles.tapIndicator}>
                  <Text style={styles.tapIndicatorText}>TAP ME</Text>
                </View>
              )}
            </Animated.View>
          </Pressable>

          {/* Distraction */}
          {showDistraction && distraction && (
            <Pressable
              onPress={handleDistractionTap}
              disabled={!canTap || isProcessing}
              style={[
                styles.distractionContainer,
                {
                  left: distractionX,
                  top: distractionY,
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.distraction,
                  {
                    transform: [
                      { scale: distractionScale },
                      { rotate: distractionRot },
                    ],
                    opacity: distractionOpacity,
                  },
                ]}
              >
                <LinearGradient
                  colors={distraction.color as [string, string, ...string[]]}
                  style={styles.distractionGradient}
                >
                  <Text style={styles.distractionEmoji}>{distraction.emoji}</Text>
                </LinearGradient>
              </Animated.View>
            </Pressable>
          )}

          {/* Celebration */}
          <Animated.View
            style={[
              styles.celebration,
              {
                transform: [{ scale: celebrationScale }],
                opacity: celebrationOpacity,
              },
            ]}
          >
            <Text style={styles.celebrationText}>🎯 Great Focus! 🎯</Text>
          </Animated.View>

          {/* Particle Effects */}
          <Animated.View
            style={[
              styles.particles,
              {
                left: SCREEN_WIDTH / 2,
                top: SCREEN_HEIGHT / 2,
                opacity: particleOpacity,
              },
            ]}
            pointerEvents="none"
          >
            {[...Array(8)].map((_, i) => {
              const angle = (i * 45) * (Math.PI / 180);
              const distance = 80;
              return (
                <View
                  key={i}
                  style={[
                    styles.particle,
                    {
                      transform: [
                        { translateX: Math.cos(angle) * distance },
                        { translateY: Math.sin(angle) * distance },
                      ],
                    },
                  ]}
                >
                  <Text style={styles.particleEmoji}>✨</Text>
                </View>
              );
            })}
          </Animated.View>

          {/* Progress Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>
              Round {rounds + 1} / {requiredRounds}
            </Text>
            <Text style={styles.statsSubtext}>
              ✓ Correct: {correctTaps} • ⚠ Distracted: {distractionTaps} • ✗ Missed: {missedTaps}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="eye" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Selective Attention</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="filter" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Filtering Distractions</Text>
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
  warningBanner: {
    position: 'absolute',
    top: 40,
    width: '90%',
    zIndex: 15,
  },
  warningGradient: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  warningText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginLeft: 12,
  },
  targetContainer: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    zIndex: 10,
  },
  target: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    position: 'relative',
  },
  targetGlow: {
    position: 'absolute',
    width: TARGET_SIZE + 40,
    height: TARGET_SIZE + 40,
    borderRadius: (TARGET_SIZE + 40) / 2,
    backgroundColor: '#FCD34D',
    top: -20,
    left: -20,
    shadowColor: '#FCD34D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 25,
    elevation: 25,
  },
  targetGradient: {
    width: '100%',
    height: '100%',
    borderRadius: TARGET_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 15,
    borderWidth: 5,
    borderColor: '#FFFFFF',
    zIndex: 1,
  },
  tapIndicator: {
    position: 'absolute',
    bottom: -35,
    left: '50%',
    transform: [{ translateX: -35 }],
    backgroundColor: '#3B82F6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  tapIndicatorText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  particles: {
    position: 'absolute',
    width: 0,
    height: 0,
  },
  particle: {
    position: 'absolute',
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  particleEmoji: {
    fontSize: 24,
  },
  targetEmoji: {
    fontSize: 80,
  },
  distractionContainer: {
    position: 'absolute',
    width: DISTRACTION_SIZE,
    height: DISTRACTION_SIZE,
    zIndex: 15, // Above target (target is zIndex 10) so it's visible when orbiting
  },
  distraction: {
    width: DISTRACTION_SIZE,
    height: DISTRACTION_SIZE,
    borderRadius: DISTRACTION_SIZE / 2,
  },
  distractionGradient: {
    width: '100%',
    height: '100%',
    borderRadius: DISTRACTION_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  distractionEmoji: {
    fontSize: 50,
  },
  celebration: {
    position: 'absolute',
    top: '30%',
    alignItems: 'center',
  },
  celebrationText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#3B82F6',
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

