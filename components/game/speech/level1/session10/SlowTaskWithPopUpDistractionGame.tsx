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
const DISTRACTION_SIZE = 80;
const DEFAULT_TTS_RATE = 0.75;
const GROWTH_DURATION_MS = 6000;
const DISTRACTION_INTERVAL_MS = 2000;
const TAP_TIMEOUT_MS = 5000;

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
  { petal: ['#EC4899', '#DB2777'], center: ['#FCD34D', '#FBBF24'], stem: '#22C55E' },
  { petal: ['#3B82F6', '#2563EB'], center: ['#FCD34D', '#FBBF24'], stem: '#16A34A' },
  { petal: ['#8B5CF6', '#7C3AED'], center: ['#FCD34D', '#FBBF24'], stem: '#22C55E' },
];

const DISTRACTIONS = [
  { emoji: '☁️', name: 'cloud', color: ['#94A3B8', '#64748B'] },
  { emoji: '🐛', name: 'bug', color: ['#10B981', '#059669'] },
  { emoji: '✨', name: 'sparkle', color: ['#FCD34D', '#FBBF24'] },
  { emoji: '🦋', name: 'butterfly', color: ['#8B5CF6', '#7C3AED'] },
];

export const SlowTaskWithPopUpDistractionGame: React.FC<Props> = ({
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
  const [currentFlower, setCurrentFlower] = useState<number>(0);
  const [growthProgress, setGrowthProgress] = useState(0);
  const [isBloomed, setIsBloomed] = useState(false);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [distractionTaps, setDistractionTaps] = useState(0);
  const [missedTaps, setMissedTaps] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [currentDistraction, setCurrentDistraction] = useState<typeof DISTRACTIONS[0] | null>(null);
  const [showDistraction, setShowDistraction] = useState(false);
  
  // Animations
  const flowerScale = useRef(new Animated.Value(0)).current;
  const petalScale = useRef(new Animated.Value(0)).current;
  const centerScale = useRef(new Animated.Value(0)).current;
  const stemHeight = useRef(new Animated.Value(0)).current;
  const flowerOpacity = useRef(new Animated.Value(0)).current;
  const bloomPulse = useRef(new Animated.Value(1)).current;
  const distractionX = useRef(new Animated.Value(0)).current;
  const distractionY = useRef(new Animated.Value(0)).current;
  const distractionScale = useRef(new Animated.Value(0)).current;
  const distractionOpacity = useRef(new Animated.Value(0)).current;
  const distractionBounce = useRef(new Animated.Value(1)).current;
  const celebrationScale = useRef(new Animated.Value(1)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  const warningScale = useRef(new Animated.Value(1)).current;
  const warningOpacity = useRef(new Animated.Value(0)).current;
  const progressBarWidth = useRef(new Animated.Value(0)).current;
  
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
  
  // Timeouts and intervals
  const growthTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const distractionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const distractionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);
  const pulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const distractionAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  const finishGame = useCallback(async () => {
    // Clear all timeouts and animations
    if (growthTimeoutRef.current) {
      clearTimeout(growthTimeoutRef.current);
      growthTimeoutRef.current = null;
    }
    if (distractionIntervalRef.current) {
      clearInterval(distractionIntervalRef.current);
      distractionIntervalRef.current = null;
    }
    if (distractionTimeoutRef.current) {
      clearTimeout(distractionTimeoutRef.current);
      distractionTimeoutRef.current = null;
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
    if (distractionAnimationRef.current) {
      distractionAnimationRef.current.stop();
      distractionAnimationRef.current = null;
    }
    
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const totalAttempts = correctTaps + distractionTaps + missedTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 40;

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
        type: 'slow-task-with-pop-up-distraction',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['sustained-attention', 'delayed-gratification', 'ignoring-visual-motion', 'focus'],
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

  const isBloomedRef = useRef(false);
  
  const showDistractionPopUp = useCallback(() => {
    if (isBloomedRef.current) return; // Don't show distractions after bloom
    
    const randomDistraction = DISTRACTIONS[Math.floor(Math.random() * DISTRACTIONS.length)];
    setCurrentDistraction(randomDistraction);
    setShowDistraction(true);
    
    // Random position (avoid center where flower is)
    const avoidCenter = Math.random() > 0.5;
    const x = avoidCenter 
      ? SCREEN_WIDTH * (0.1 + Math.random() * 0.3) - DISTRACTION_SIZE / 2
      : SCREEN_WIDTH * (0.7 + Math.random() * 0.2) - DISTRACTION_SIZE / 2;
    const y = SCREEN_HEIGHT * (0.15 + Math.random() * 0.5) - DISTRACTION_SIZE / 2;
    
    distractionX.setValue(x);
    distractionY.setValue(y);
    
    // Animate appearance with pop effect
    Animated.sequence([
      Animated.parallel([
        Animated.spring(distractionScale, {
          toValue: 1.2,
          tension: 50,
          friction: 5,
          useNativeDriver: true,
        }),
        Animated.timing(distractionOpacity, {
          toValue: 0.95,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(distractionScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Bounce animation
    distractionAnimationRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(distractionBounce, {
          toValue: 1.15,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(distractionBounce, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    distractionAnimationRef.current.start();

    // Hide after duration
    distractionTimeoutRef.current = (setTimeout(() => {
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
        distractionBounce.setValue(1);
      });
      distractionTimeoutRef.current = null;
    }, 1800)) as unknown as NodeJS.Timeout;
  }, [SCREEN_WIDTH, SCREEN_HEIGHT]);

  const startRound = useCallback(() => {
    // Clear all timeouts and animations
    if (growthTimeoutRef.current) {
      clearTimeout(growthTimeoutRef.current);
      growthTimeoutRef.current = null;
    }
    if (distractionIntervalRef.current) {
      clearInterval(distractionIntervalRef.current);
      distractionIntervalRef.current = null;
    }
    if (distractionTimeoutRef.current) {
      clearTimeout(distractionTimeoutRef.current);
      distractionTimeoutRef.current = null;
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
    if (distractionAnimationRef.current) {
      distractionAnimationRef.current.stop();
      distractionAnimationRef.current = null;
    }

    if (rounds >= requiredRounds) {
      return;
    }

    // Reset state
    setIsProcessing(false);
    setCanTap(false);
    setIsBloomed(false);
    isBloomedRef.current = false;
    setGrowthProgress(0);
    setShowDistraction(false);
    setCurrentDistraction(null);
    
    // Reset animations
    flowerScale.setValue(0);
    petalScale.setValue(0);
    centerScale.setValue(0);
    stemHeight.setValue(0);
    flowerOpacity.setValue(0);
    bloomPulse.setValue(1);
    distractionX.setValue(0);
    distractionY.setValue(0);
    distractionScale.setValue(0);
    distractionOpacity.setValue(0);
    distractionBounce.setValue(1);
    celebrationScale.setValue(1);
    celebrationOpacity.setValue(0);
    warningScale.setValue(1);
    warningOpacity.setValue(0);
    progressBarWidth.setValue(0);

    // Select random flower
    const flowerIndex = Math.floor(Math.random() * FLOWER_COLORS.length);
    setCurrentFlower(flowerIndex);

    speak('Watch the flower grow...');

    // Animate flower appearance
    Animated.sequence([
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
      ]),
    ]).start();

    // Grow stem
    Animated.timing(stemHeight, {
      toValue: 1,
      duration: GROWTH_DURATION_MS * 0.4,
      delay: 400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();

    // Grow center
    Animated.timing(centerScale, {
      toValue: 1,
      duration: GROWTH_DURATION_MS * 0.7,
      delay: 400 + GROWTH_DURATION_MS * 0.3,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    // Animate progress bar
    Animated.timing(progressBarWidth, {
      toValue: SCREEN_WIDTH * 0.6,
      duration: GROWTH_DURATION_MS,
      delay: 400,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Update progress
    const INITIAL_DELAY_MS = 400;
    const TOTAL_GROWTH_TIME = INITIAL_DELAY_MS + GROWTH_DURATION_MS;
    const startTime = Date.now();
    progressIntervalRef.current = (setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(Math.max(0, (elapsed - INITIAL_DELAY_MS) / GROWTH_DURATION_MS), 1);
      setGrowthProgress(progress);
    }, 100)) as unknown as NodeJS.Timeout;

    // Show distractions at intervals (more frequent)
    distractionIntervalRef.current = (setInterval(() => {
      showDistractionPopUp();
    }, DISTRACTION_INTERVAL_MS)) as unknown as NodeJS.Timeout;

    // After growth completes
    growthTimeoutRef.current = (setTimeout(() => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      if (distractionIntervalRef.current) {
        clearInterval(distractionIntervalRef.current);
        distractionIntervalRef.current = null;
      }
      
      setGrowthProgress(1);
      setIsBloomed(true);
      isBloomedRef.current = true;
      setCanTap(true);

      // Pulse animation
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

      // Timeout for missed tap
      tapTimeoutRef.current = (setTimeout(() => {
        setMissedTaps(prev => prev + 1);
        speak('Try again!');
        
        // Hide and advance
        Animated.parallel([
          Animated.timing(flowerOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(progressBarWidth, {
            toValue: 0,
            duration: 300,
            useNativeDriver: false,
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
      
      growthTimeoutRef.current = null;
    }, TOTAL_GROWTH_TIME)) as unknown as NodeJS.Timeout;
  }, [rounds, requiredRounds, SCREEN_WIDTH, showDistractionPopUp]);

  const handleFlowerTap = useCallback(() => {
    if (isProcessing) return;

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

    if (isBloomed && canTap) {
      // Correct tap
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Celebration
      Animated.parallel([
        Animated.sequence([
          Animated.timing(flowerScale, {
            toValue: 1.3,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(flowerScale, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.spring(celebrationScale, {
            toValue: 1.2,
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

      // Show success animation instead of TTS
      setShowRoundSuccess(true);
      setTimeout(() => {
        setShowRoundSuccess(false);
      }, 2500);

      // Hide and advance
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(flowerOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(celebrationOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(progressBarWidth, {
            toValue: 0,
            duration: 300,
            useNativeDriver: false,
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
    } else {
      // Early tap
      setDistractionTaps(prev => prev + 1);

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      // Warning
      Animated.parallel([
        Animated.sequence([
          Animated.timing(flowerScale, {
            toValue: 0.95,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.timing(flowerScale, {
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

      speak('Wait for it to bloom!');

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

      setIsProcessing(false);
    }
  }, [isBloomed, canTap, isProcessing, flowerScale]);

  const handleDistractionTap = useCallback(() => {
    if (isProcessing || isBloomed) return;

    // Distraction tap
    setDistractionTaps(prev => prev + 1);

    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {}

    // Warning
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

    speak('Focus on the flower!');

    // Hide distraction
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
  }, [isProcessing, isBloomed, distractionScale]);

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
      speak('Complete the slow task, ignore the pop-up distractions!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (growthTimeoutRef.current) {
        clearTimeout(growthTimeoutRef.current);
      }
      if (distractionIntervalRef.current) {
        clearInterval(distractionIntervalRef.current);
      }
      if (distractionTimeoutRef.current) {
        clearTimeout(distractionTimeoutRef.current);
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
      if (distractionAnimationRef.current) {
        distractionAnimationRef.current.stop();
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

  const stemHeightValue = stemHeight.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 100],
  });

  const flower = FLOWER_COLORS[currentFlower];
  const bloomScale = Animated.multiply(flowerScale, bloomPulse);
  const distractionBounceScale = Animated.multiply(distractionScale, distractionBounce);

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
            <Text style={styles.title}>Slow Task + Distraction</Text>
            <Text style={styles.subtitle}>
              {isBloomed ? 'Tap the flower!' : `Watch it grow... ${Math.round(growthProgress * 100)}%`}
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
                colors={['#F59E0B', '#D97706']}
                style={styles.warningGradient}
              >
                <Ionicons name="eye-off" size={24} color="#FFFFFF" />
                <Text style={styles.warningText}>Focus on the flower!</Text>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Distraction Pop-up */}
          {showDistraction && currentDistraction && (
            <Pressable
              onPress={handleDistractionTap}
              disabled={isProcessing || isBloomed}
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
                    transform: [{ scale: distractionBounceScale }],
                    opacity: distractionOpacity,
                  },
                ]}
              >
                <LinearGradient
                  colors={currentDistraction.color as [string, string, ...string[]]}
                  style={styles.distractionGradient}
                >
                  <Text style={styles.distractionEmoji}>{currentDistraction.emoji}</Text>
                </LinearGradient>
              </Animated.View>
            </Pressable>
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

              {/* Center */}
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
                          { scale: petalScale },
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
            <Text style={styles.celebrationText}>🌻 Perfect! 🌻</Text>
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
            <Ionicons name="hourglass" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Sustained Attention</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="gift" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Delayed Gratification</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="eye-off" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Ignoring Motion</Text>
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
    shadowColor: '#F59E0B',
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
  distractionContainer: {
    position: 'absolute',
    width: DISTRACTION_SIZE,
    height: DISTRACTION_SIZE,
    zIndex: 5,
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
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  distractionEmoji: {
    fontSize: 45,
  },
  flowerContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
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
  celebration: {
    position: 'absolute',
    top: '30%',
    alignItems: 'center',
  },
  celebrationText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#22C55E',
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

