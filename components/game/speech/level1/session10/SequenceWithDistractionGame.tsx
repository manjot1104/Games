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

const SHAPE_SIZE = 130;
const DISTRACTION_SIZE = 100;
const DEFAULT_TTS_RATE = 0.75;
const APPEAR_INTERVAL_MS = 1800;
const DISTRACTION_DURATION_MS = 2000;
const TAP_TIMEOUT_MS = 12000;
const DISTRACTION_INTERVAL_MS = 2500; // Show distraction every 2.5 seconds during tapping

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

const SHAPES = [
  { emoji: '⭕', name: 'circle', color: ['#3B82F6', '#2563EB'] },
  { emoji: '⬛', name: 'square', color: ['#10B981', '#059669'] },
  { emoji: '⭐', name: 'star', color: ['#FCD34D', '#FBBF24'] },
  { emoji: '🔺', name: 'triangle', color: ['#EF4444', '#DC2626'] },
  { emoji: '💎', name: 'diamond', color: ['#8B5CF6', '#7C3AED'] },
  { emoji: '❤️', name: 'heart', color: ['#EC4899', '#DB2777'] },
];

const DISTRACTIONS = [
  { emoji: '🎈', name: 'balloon', color: ['#F472B6', '#EC4899'] },
  { emoji: '🎮', name: 'game', color: ['#6366F1', '#4F46E5'] },
  { emoji: '🚗', name: 'car', color: ['#F59E0B', '#D97706'] },
  { emoji: '🐶', name: 'dog', color: ['#8B5CF6', '#7C3AED'] },
  { emoji: '🎨', name: 'paint', color: ['#EC4899', '#DB2777'] },
  { emoji: '🎪', name: 'circus', color: ['#FCD34D', '#FBBF24'] },
];

type ShapeData = {
  id: number; // Visual position ID (0, 1, 2) - left, middle, right
  emoji: string;
  color: string[];
  name: string;
  tapped: boolean;
  x: number;
  y: number;
  sequenceOrder: number; // Actual sequence order (1, 2, or 3) - which one to tap first
};

export const SequenceWithDistractionGame: React.FC<Props> = ({
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
    wrongOrderTaps: number;
    distractionTaps: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [sequence, setSequence] = useState<ShapeData[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [wrongOrderTaps, setWrongOrderTaps] = useState(0);
  const [distractionTaps, setDistractionTaps] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const [currentDistraction, setCurrentDistraction] = useState<typeof DISTRACTIONS[0] | null>(null);
  const [showDistraction, setShowDistraction] = useState(false);
  const visibleCountRef = useRef(0);
  
  // Animations
  const shapeScales = useRef<Map<number, Animated.Value>>(new Map()).current;
  const shapeOpacities = useRef<Map<number, Animated.Value>>(new Map()).current;
  const shapeGlow = useRef<Map<number, Animated.Value>>(new Map()).current;
  const shapeGlowOpacity = useRef<Map<number, Animated.Value>>(new Map()).current;
  const distractionX = useRef(new Animated.Value(0)).current;
  const distractionY = useRef(new Animated.Value(0)).current;
  const distractionScale = useRef(new Animated.Value(0)).current;
  const distractionOpacity = useRef(new Animated.Value(0)).current;
  const distractionBounce = useRef(new Animated.Value(1)).current;
  const celebrationScale = useRef(new Animated.Value(1)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  const warningScale = useRef(new Animated.Value(1)).current;
  const warningOpacity = useRef(new Animated.Value(0)).current;
  const particleOpacity = useRef(new Animated.Value(0)).current;
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
  
  // Timeouts
  const appearanceTimeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const distractionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const distractionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const distractionAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);
  const glowAnimationRefs = useRef<Map<number, Animated.CompositeAnimation>>(new Map()).current;

  const finishGame = useCallback(async () => {
    appearanceTimeoutsRef.current.forEach(t => clearTimeout(t));
    appearanceTimeoutsRef.current = [];
    if (distractionTimeoutRef.current) {
      clearTimeout(distractionTimeoutRef.current);
      distractionTimeoutRef.current = null;
    }
    if (distractionIntervalRef.current) {
      clearTimeout(distractionIntervalRef.current);
      distractionIntervalRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (distractionAnimationRef.current) {
      distractionAnimationRef.current.stop();
      distractionAnimationRef.current = null;
    }
    glowAnimationRefs.forEach(anim => anim.stop());
    glowAnimationRefs.clear();
    
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const totalAttempts = correctTaps + wrongOrderTaps + distractionTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 42;

    setFinalStats({
      totalRounds: requiredRounds,
      correctTaps,
      wrongOrderTaps,
      distractionTaps,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'sequence-with-distraction',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['multi-step-attention', 'distraction-filtering', 'cognitive-sequencing', 'focus'],
        incorrectAttempts: wrongOrderTaps + distractionTaps,
        meta: {
          correctTaps,
          wrongOrderTaps,
          distractionTaps,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [correctTaps, wrongOrderTaps, distractionTaps, requiredRounds, onComplete]);

  const advanceToNextRound = useCallback((nextRound: number) => {
    if (nextRound >= requiredRounds) {
      return;
    }
    setTimeout(() => {
      startRoundRef.current?.();
    }, 1200);
  }, [requiredRounds]);

  const getDistractionPosition = useCallback(() => {
    // Avoid positions where shapes are
    const shapePositions = sequence.map(s => ({ x: s.x, y: s.y }));
    let attempts = 0;
    let x: number, y: number;
    
    do {
      x = SCREEN_WIDTH * (0.1 + Math.random() * 0.8) - DISTRACTION_SIZE / 2;
      y = SCREEN_HEIGHT * (0.15 + Math.random() * 0.5) - DISTRACTION_SIZE / 2;
      attempts++;
    } while (
      attempts < 20 && 
      shapePositions.some(pos => {
        const distance = Math.sqrt(Math.pow(x - pos.x, 2) + Math.pow(y - pos.y, 2));
        return distance < SHAPE_SIZE + DISTRACTION_SIZE;
      })
    );
    
    return { x, y };
  }, [sequence, SCREEN_WIDTH, SCREEN_HEIGHT]);

  const showDistractionPopUp = useCallback(() => {
    if (!canTap && visibleCountRef.current < 3) return; // Only show during tapping phase or during appearance
    
    const randomDistraction = DISTRACTIONS[Math.floor(Math.random() * DISTRACTIONS.length)];
    setCurrentDistraction(randomDistraction);
    setShowDistraction(true);
    
    const { x, y } = getDistractionPosition();
    
    distractionX.setValue(x);
    distractionY.setValue(y);
    
    // Animate appearance with pop effect
    Animated.parallel([
      Animated.spring(distractionScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(distractionOpacity, {
        toValue: 0.95,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    // Bounce animation
    distractionAnimationRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(distractionBounce, {
          toValue: 1.2,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(distractionBounce, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    distractionAnimationRef.current.start();

    // Hide after duration
    distractionTimeoutRef.current = (setTimeout(() => {
      if (distractionAnimationRef.current) {
        distractionAnimationRef.current.stop();
        distractionAnimationRef.current = null;
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
        distractionBounce.setValue(1);
      });
      distractionTimeoutRef.current = null;
    }, DISTRACTION_DURATION_MS)) as unknown as NodeJS.Timeout;
  }, [canTap, getDistractionPosition]);

  const startDistractionInterval = useCallback(() => {
    if (distractionIntervalRef.current) {
      clearInterval(distractionIntervalRef.current);
    }
    
    // Show first distraction after a delay
    setTimeout(() => {
      showDistractionPopUp();
    }, 1000);
    
    // Then show periodically
    distractionIntervalRef.current = (setInterval(() => {
      if (canTap && !showDistraction) {
        showDistractionPopUp();
      }
    }, DISTRACTION_INTERVAL_MS)) as unknown as NodeJS.Timeout;
  }, [canTap, showDistraction, showDistractionPopUp]);

  const startRound = useCallback(() => {
    // Clear all timeouts
    appearanceTimeoutsRef.current.forEach(t => clearTimeout(t));
    appearanceTimeoutsRef.current = [];
    if (distractionTimeoutRef.current) {
      clearTimeout(distractionTimeoutRef.current);
      distractionTimeoutRef.current = null;
    }
    if (distractionIntervalRef.current) {
      clearInterval(distractionIntervalRef.current);
      distractionIntervalRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (distractionAnimationRef.current) {
      distractionAnimationRef.current.stop();
      distractionAnimationRef.current = null;
    }
    glowAnimationRefs.forEach(anim => anim.stop());
    glowAnimationRefs.clear();

    if (rounds >= requiredRounds) {
      return;
    }

    // Reset state
    setIsProcessing(false);
    setCanTap(false);
    setCurrentStep(0);
    setVisibleCount(0);
    visibleCountRef.current = 0;
    setShowDistraction(false);
    setCurrentDistraction(null);
    progressBarWidth.setValue(0);
    
    // Select 3 random shapes for sequence
    const shuffled = [...SHAPES].sort(() => Math.random() - 0.5);
    const selectedShapes = shuffled.slice(0, 3);
    
    // Randomize the sequence order (which shape to tap 1st, 2nd, 3rd)
    // But keep visual positions fixed (left, middle, right)
    const sequenceOrder = [0, 1, 2].sort(() => Math.random() - 0.5); // Random order: e.g., [2, 0, 1]
    
    const shapeData: ShapeData[] = selectedShapes.map((shape, visualIdx) => {
      // visualIdx is the position (0=left, 1=middle, 2=right)
      // Find which sequence order this position has
      const seqOrder = sequenceOrder.indexOf(visualIdx) + 1; // 1, 2, or 3
      
      return {
        id: visualIdx, // Visual position (0=left, 1=middle, 2=right)
        emoji: shape.emoji,
        color: shape.color,
        name: shape.name,
        tapped: false,
        x: SCREEN_WIDTH * (0.2 + visualIdx * 0.3) - SHAPE_SIZE / 2,
        y: SCREEN_HEIGHT * 0.45 - SHAPE_SIZE / 2,
        sequenceOrder: seqOrder, // Actual tap order (1, 2, or 3)
      };
    });
    
    setSequence(shapeData);

    // Initialize animations
    shapeData.forEach((shape) => {
      if (!shapeScales.has(shape.id)) {
        shapeScales.set(shape.id, new Animated.Value(0));
        shapeOpacities.set(shape.id, new Animated.Value(0));
        shapeGlow.set(shape.id, new Animated.Value(1));
        shapeGlowOpacity.set(shape.id, new Animated.Value(0));
      } else {
        shapeScales.get(shape.id)!.setValue(0);
        shapeOpacities.get(shape.id)!.setValue(0);
        shapeGlow.get(shape.id)!.setValue(1);
        shapeGlowOpacity.get(shape.id)!.setValue(0);
      }
    });

    celebrationScale.setValue(1);
    celebrationOpacity.setValue(0);
    warningScale.setValue(1);
    warningOpacity.setValue(0);
    particleOpacity.setValue(0);

    speak('Watch the sequence...');

    // Make shapes appear one by one in sequence order (1st, 2nd, 3rd)
    // Sort by sequenceOrder to show them in the correct order
    const shapesInSequenceOrder = [...shapeData].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    
    shapesInSequenceOrder.forEach((shape, index) => {
      const timeout = (setTimeout(() => {
        setVisibleCount(prev => {
          const newCount = prev + 1;
          visibleCountRef.current = newCount;
          return newCount;
        });

        // Animate appearance
        Animated.parallel([
          Animated.spring(shapeScales.get(shape.id)!, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(shapeOpacities.get(shape.id)!, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        // Show distraction randomly during sequence appearance
        if (index < 2 && Math.random() > 0.5) {
          setTimeout(() => {
            showDistractionPopUp();
          }, 600);
        }

        // After all 3 appear, allow tapping
        if (index === shapesInSequenceOrder.length - 1) {
          setTimeout(() => {
            setCanTap(true);
            speak('Tap in order!');
            
            // Start distraction interval during tapping
            startDistractionInterval();
            
            // Timeout for missed sequence
            tapTimeoutRef.current = (setTimeout(() => {
              setWrongOrderTaps(prev => prev + 1);
              speak('Try again!');
              
              // Hide shapes and advance
              shapeData.forEach((s) => {
                Animated.parallel([
                  Animated.timing(shapeOpacities.get(s.id)!, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                  }),
                  Animated.timing(shapeScales.get(s.id)!, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                  }),
                ]).start();
              });
              
              setTimeout(() => {
                setRounds(prev => {
                  const nextRound = prev + 1;
                  advanceToNextRoundRef.current?.(nextRound);
                  return nextRound;
                });
              }, 400);
              
              tapTimeoutRef.current = null;
            }, TAP_TIMEOUT_MS)) as unknown as NodeJS.Timeout;
          }, 500);
        }
      }, index * APPEAR_INTERVAL_MS)) as unknown as NodeJS.Timeout;
      
      appearanceTimeoutsRef.current.push(timeout);
    });
  }, [rounds, requiredRounds, SCREEN_WIDTH, SCREEN_HEIGHT, shapeScales, shapeOpacities, shapeGlow, shapeGlowOpacity, showDistractionPopUp, startDistractionInterval]);

  const handleShapeTap = useCallback((shapeId: number) => {
    if (isProcessing || !canTap) return;

    setIsProcessing(true);

    // Clear timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }

    // Use functional updates to avoid stale closures
    // Check both sequence and currentStep together
    setSequence(prevSequence => {
      setCurrentStep(prevStep => {
        // Find the tapped shape
        const tappedShape = prevSequence.find(s => s.id === shapeId);
        if (!tappedShape) {
          setIsProcessing(false);
          return prevStep;
        }
        
        // Check if this is the correct shape in sequence (sequenceOrder should match current step + 1)
        const expectedSequenceOrder = prevStep + 1; // We're looking for shape with sequenceOrder = 1, 2, or 3
        const isCorrect = tappedShape.sequenceOrder === expectedSequenceOrder;
        
        if (isCorrect) {
          // Correct tap in sequence - update sequence
          const newSequence = prevSequence.map(s => 
            s.id === shapeId ? { ...s, tapped: true } : s
          );
          setSequence(newSequence);
          
          try {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch {}

          // Animate tap with particles
          Animated.parallel([
            Animated.sequence([
              Animated.timing(shapeScales.get(shapeId)!, {
                toValue: 1.4,
                duration: 200,
                useNativeDriver: true,
              }),
              Animated.timing(shapeScales.get(shapeId)!, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
              }),
            ]),
            Animated.sequence([
              Animated.timing(particleOpacity, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
              }),
              Animated.timing(particleOpacity, {
                toValue: 0,
                duration: 600,
                useNativeDriver: true,
              }),
            ]),
            Animated.timing(progressBarWidth, {
              toValue: ((prevStep + 1) / prevSequence.length) * 100,
              duration: 400,
              easing: Easing.out(Easing.ease),
              useNativeDriver: false,
            }),
          ]).start();

          // Check if sequence complete
          const nextStep = prevStep + 1;
          
          if (nextStep === prevSequence.length) {
            // Sequence complete
            setCorrectTaps(prev => prev + 1);
            setCanTap(false);
            
            // Stop distraction interval
            if (distractionIntervalRef.current) {
              clearInterval(distractionIntervalRef.current);
              distractionIntervalRef.current = null;
            }

            try {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } catch {}

            // Celebration
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
              Animated.timing(progressBarWidth, {
                toValue: 100,
                duration: 300,
                useNativeDriver: false,
              }),
            ]).start();

            // Show success animation instead of TTS
            setShowRoundSuccess(true);
            setTimeout(() => {
              setShowRoundSuccess(false);
            }, 2500);

            // Hide and advance
            setTimeout(() => {
              newSequence.forEach((s) => {
                Animated.parallel([
                  Animated.timing(shapeOpacities.get(s.id)!, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                  }),
                  Animated.timing(shapeScales.get(s.id)!, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                  }),
                ]).start();
              });
              
              Animated.timing(celebrationOpacity, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
              }).start();
              
              setTimeout(() => {
                setRounds(prev => {
                  const nextRound = prev + 1;
                  advanceToNextRoundRef.current?.(nextRound);
                  return nextRound;
                });
            }, 400);
          }, 1500);
          
          return nextStep; // Update step
        } else {
          // Show success animation for partial success
          setShowRoundSuccess(true);
          setTimeout(() => {
            setShowRoundSuccess(false);
          }, 2500);
          setIsProcessing(false);
          
          return nextStep; // Update to next step
        }
        } else {
          // Wrong order
          setWrongOrderTaps(prev => prev + 1);

          try {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          } catch {}

          // Warning
          Animated.parallel([
            Animated.sequence([
              Animated.timing(shapeScales.get(shapeId)!, {
                toValue: 0.85,
                duration: 150,
                useNativeDriver: true,
              }),
              Animated.timing(shapeScales.get(shapeId)!, {
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

          speak('Tap in order!');

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
          return prevStep; // Don't change step on wrong tap
        }
      });
      
      return prevSequence; // Return unchanged, will be updated inside setCurrentStep
    });
  }, [isProcessing, canTap, shapeScales, shapeOpacities, shapeGlow, shapeGlowOpacity]);

  const handleDistractionTap = useCallback(() => {
    if (isProcessing || !canTap) return;

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

    speak('Focus on the sequence!');

    // Hide distraction
    if (distractionAnimationRef.current) {
      distractionAnimationRef.current.stop();
      distractionAnimationRef.current = null;
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
      distractionBounce.setValue(1);
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
  }, [isProcessing, canTap, distractionScale]);

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
      speak('Tap the objects in the correct order, ignore the distraction!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      appearanceTimeoutsRef.current.forEach(t => clearTimeout(t));
      if (distractionTimeoutRef.current) {
        clearTimeout(distractionTimeoutRef.current);
      }
      if (distractionIntervalRef.current) {
        clearInterval(distractionIntervalRef.current);
      }
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
      if (distractionAnimationRef.current) {
        distractionAnimationRef.current.stop();
      }
      glowAnimationRefs.forEach(anim => anim.stop());
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

  const distractionBounceScale = Animated.multiply(distractionScale, distractionBounce);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FDF4FF', '#FAE8FF', '#F3E8FF']}
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
            <Text style={styles.title}>Sequence with Distraction</Text>
            <Text style={styles.subtitle}>
              {visibleCount < 3 
                ? `Watch... ${visibleCount}/3` 
                : 'Get ready...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Progress Bar */}
          {canTap && sequence.length > 0 && (
            <View style={styles.progressBarContainer}>
              <View style={styles.progressBarBackground}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      width: progressBarWidth.interpolate({
                        inputRange: [0, 100],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
              <Text style={styles.progressText}>
                {currentStep} / {sequence.length}
              </Text>
            </View>
          )}

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
                <Text style={styles.warningText}>Focus on the sequence!</Text>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Distraction Pop-up */}
          {showDistraction && currentDistraction && (
            <Pressable
              onPress={handleDistractionTap}
              disabled={isProcessing || !canTap}
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

          {/* Connecting Lines */}
          {canTap && sequence.length >= 2 && (
            <View style={styles.connectingLines} pointerEvents="none">
              {sequence.slice(0, -1).map((shape, idx) => {
                const nextShape = sequence[idx + 1];
                if (!nextShape) return null;
                
                const startX = shape.x + SHAPE_SIZE / 2;
                const startY = shape.y + SHAPE_SIZE / 2;
                const endX = nextShape.x + SHAPE_SIZE / 2;
                const endY = nextShape.y + SHAPE_SIZE / 2;
                
                const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
                const angle = Math.atan2(endY - startY, endX - startX) * (180 / Math.PI);
                
                return (
                  <View
                    key={`line-${idx}`}
                    style={[
                      styles.connectingLine,
                      {
                        left: startX,
                        top: startY,
                        width: length,
                        transform: [{ rotate: `${angle}deg` }],
                        opacity: shape.tapped ? 0.6 : 0.3,
                      },
                    ]}
                  />
                );
              })}
            </View>
          )}

          {/* Shapes */}
          {sequence.map((shape) => {
            const scale = shapeScales.get(shape.id) || new Animated.Value(0);
            const opacity = shapeOpacities.get(shape.id) || new Animated.Value(0);
            // Check if this is the next shape to tap (by sequence order, not visual position)
            const expectedSequenceOrder = currentStep + 1; // We're looking for shape with sequenceOrder = 1, 2, or 3
            const isNext = canTap && !shape.tapped && shape.sequenceOrder === expectedSequenceOrder;

            return (
              <Pressable
                key={shape.id}
                onPress={() => handleShapeTap(shape.id)}
                disabled={!canTap || shape.tapped || isProcessing}
                style={[
                  styles.shapeContainer,
                  {
                    left: shape.x,
                    top: shape.y,
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.shape,
                    {
                      transform: [{ scale }],
                      opacity,
                    },
                  ]}
                >
                  <LinearGradient
                    colors={shape.color as [string, string, ...string[]]}
                    style={[
                      styles.shapeGradient,
                      shape.tapped && styles.shapeTapped,
                    ]}
                  >
                    <Text style={styles.shapeEmoji}>{shape.emoji}</Text>
                    {shape.tapped && (
                      <View style={styles.checkmark}>
                        <Ionicons name="checkmark-circle" size={32} color="#FFFFFF" />
                      </View>
                    )}
                  </LinearGradient>
                </Animated.View>
              </Pressable>
            );
          })}

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
            <Text style={styles.celebrationText}>🎯 Perfect! 🎯</Text>
          </Animated.View>

          {/* Particle Effects */}
          <Animated.View
            style={[
              styles.particles,
              {
                opacity: particleOpacity,
              },
            ]}
            pointerEvents="none"
          >
            {sequence.map((shape, i) => {
              if (!shape.tapped) return null;
              return [...Array(6)].map((_, j) => {
                const angle = (j * 60) * (Math.PI / 180);
                const distance = 60;
                return (
                  <View
                    key={`particle-${shape.id}-${j}`}
                    style={[
                      styles.particle,
                      {
                        left: shape.x + SHAPE_SIZE / 2,
                        top: shape.y + SHAPE_SIZE / 2,
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
              });
            })}
          </Animated.View>

          {/* Progress Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>
              Round {rounds + 1} / {requiredRounds}
            </Text>
            <Text style={styles.statsSubtext}>
              ✓ Correct: {correctTaps} • ⚠ Wrong Order: {wrongOrderTaps} • ⚠ Distracted: {distractionTaps}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="layers" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Multi-step Attention</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="filter" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Distraction Filtering</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="list" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Cognitive Sequencing</Text>
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
  progressBarContainer: {
    position: 'absolute',
    top: 20,
    width: '85%',
    alignItems: 'center',
    zIndex: 20,
  },
  progressBarBackground: {
    width: '100%',
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#8B5CF6',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  warningBanner: {
    position: 'absolute',
    top: 80,
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
  distractionContainer: {
    position: 'absolute',
    width: DISTRACTION_SIZE,
    height: DISTRACTION_SIZE,
    zIndex: 12,
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
  connectingLines: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
  connectingLine: {
    position: 'absolute',
    height: 3,
    backgroundColor: '#8B5CF6',
    borderRadius: 1.5,
  },
  shapeContainer: {
    position: 'absolute',
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    zIndex: 10,
  },
  shape: {
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    borderRadius: SHAPE_SIZE / 2,
    position: 'relative',
  },
  shapeGlowRing: {
    position: 'absolute',
    width: SHAPE_SIZE + 30,
    height: SHAPE_SIZE + 30,
    borderRadius: (SHAPE_SIZE + 30) / 2,
    backgroundColor: '#3B82F6',
    top: -15,
    left: -15,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 20,
  },
  shapeGradient: {
    width: '100%',
    height: '100%',
    borderRadius: SHAPE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  shapeTapped: {
    borderColor: '#22C55E',
    borderWidth: 5,
    opacity: 0.8,
  },
  shapeEmoji: {
    fontSize: 65,
  },
  orderBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0F172A',
  },
  orderBadgeText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0F172A',
  },
  checkmark: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  celebration: {
    position: 'absolute',
    top: '25%',
    alignItems: 'center',
  },
  celebrationText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#8B5CF6',
    textShadowColor: 'rgba(139, 92, 246, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  particles: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    zIndex: 5,
  },
  particle: {
    position: 'absolute',
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  particleEmoji: {
    fontSize: 20,
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
