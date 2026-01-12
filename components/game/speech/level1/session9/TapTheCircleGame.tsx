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

const SHAPE_SIZE = 120;
const DEFAULT_TTS_RATE = 0.75;
const INSTRUCTION_DELAY_MS = 1000;

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
  { emoji: '⭕', name: 'circle', color: ['#3B82F6', '#2563EB'], displayName: 'circle' },
  { emoji: '🔺', name: 'triangle', color: ['#EF4444', '#DC2626'], displayName: 'triangle' },
  { emoji: '⬛', name: 'square', color: ['#10B981', '#059669'], displayName: 'square' },
  { emoji: '💎', name: 'diamond', color: ['#8B5CF6', '#7C3AED'], displayName: 'diamond' },
  { emoji: '⭐', name: 'star', color: ['#FCD34D', '#FBBF24'], displayName: 'star' },
  { emoji: '❤️', name: 'heart', color: ['#EC4899', '#DB2777'], displayName: 'heart' },
];

export const TapTheCircleGame: React.FC<Props> = ({
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
    incorrectTaps: number;
    accuracy: number;
    xpAwarded: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  
  // Game state
  const [shapes, setShapes] = useState<{ id: number; emoji: string; color: string[]; name: string; displayName: string }[]>([]);
  const [targetShape, setTargetShape] = useState<string | null>(null);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [incorrectTaps, setIncorrectTaps] = useState(0);
  const [showInstruction, setShowInstruction] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const shapeScales = useRef<Map<number, Animated.Value>>(new Map()).current;
  const shapeOpacities = useRef<Map<number, Animated.Value>>(new Map()).current;
  const instructionScale = useRef(new Animated.Value(0)).current;
  const instructionOpacity = useRef(new Animated.Value(0)).current;
  const celebrationScale = useRef(new Animated.Value(1)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  
  // Timeouts
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);

  const finishGame = useCallback(async () => {
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const totalAttempts = correctTaps + incorrectTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 32;

    setFinalStats({
      totalRounds: requiredRounds,
      correctTaps,
      incorrectTaps,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'tap-the-circle',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['shape-recognition', 'instruction-discrimination', 'cognitive-categorization'],
        incorrectAttempts: incorrectTaps,
        meta: {
          correctTaps,
          incorrectTaps,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [correctTaps, incorrectTaps, requiredRounds, onComplete]);

  const advanceToNextRound = useCallback((nextRound: number) => {
    if (nextRound >= requiredRounds) {
      return;
    }
    setTimeout(() => {
      startRoundRef.current?.();
    }, 1000);
  }, [requiredRounds]);

  const startRound = useCallback(() => {
    // Clear timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }

    if (rounds >= requiredRounds) {
      return;
    }

    // Reset state
    setIsProcessing(false);
    setCanTap(false);
    setShowInstruction(false);
    setTargetShape(null);
    
    // Select 3 random shapes
    const shuffled = [...SHAPES].sort(() => Math.random() - 0.5);
    const selectedShapes = shuffled.slice(0, 3).map((shape, idx) => ({
      id: idx,
      emoji: shape.emoji,
      color: shape.color,
      name: shape.name,
      displayName: shape.displayName,
    }));
    
    // Select target shape
    const target = selectedShapes[Math.floor(Math.random() * selectedShapes.length)];
    
    setShapes(selectedShapes);
    setTargetShape(target.name);

    // Initialize animations
    selectedShapes.forEach((shape) => {
      if (!shapeScales.has(shape.id)) {
        shapeScales.set(shape.id, new Animated.Value(0));
        shapeOpacities.set(shape.id, new Animated.Value(0));
      } else {
        shapeScales.get(shape.id)!.setValue(0);
        shapeOpacities.get(shape.id)!.setValue(0);
      }
    });

    instructionScale.setValue(0);
    instructionOpacity.setValue(0);
    celebrationScale.setValue(1);
    celebrationOpacity.setValue(0);

    // Show shapes
    selectedShapes.forEach((shape, index) => {
      setTimeout(() => {
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
      }, index * 200);
    });

    // Show instruction after shapes appear
    setTimeout(() => {
      setShowInstruction(true);
      
      // Show instruction animation
      Animated.parallel([
        Animated.spring(instructionScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(instructionOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ]).start();

      // Play audio instruction
      speak(`Tap the ${target.displayName}`);

      // Allow tapping
      setCanTap(true);

      // Timeout for missed tap
      tapTimeoutRef.current = (setTimeout(() => {
        if (canTap && !isProcessing) {
          setIncorrectTaps(prev => prev + 1);
          speak('Try again!');
        }
        
        // Hide and advance
        selectedShapes.forEach((shape) => {
          Animated.parallel([
            Animated.timing(shapeOpacities.get(shape.id)!, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(shapeScales.get(shape.id)!, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start();
        });
        
        Animated.parallel([
          Animated.timing(instructionOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(instructionScale, {
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
      }, 8000)) as unknown as NodeJS.Timeout;
    }, INSTRUCTION_DELAY_MS);
  }, [rounds, requiredRounds, canTap, isProcessing, shapeScales, shapeOpacities]);

  const handleShapeTap = useCallback((shapeName: string, shapeId: number) => {
    if (isProcessing || !canTap) return;

    setIsProcessing(true);

    // Clear timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }

    if (shapeName === targetShape) {
      // Correct tap
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Celebration animation
      Animated.parallel([
        Animated.sequence([
          Animated.timing(shapeScales.get(shapeId)!, {
            toValue: 1.4,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(shapeScales.get(shapeId)!, {
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
        shapes.forEach((shape) => {
          Animated.parallel([
            Animated.timing(shapeOpacities.get(shape.id)!, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(shapeScales.get(shape.id)!, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start();
        });
        
        Animated.parallel([
          Animated.timing(instructionOpacity, {
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
    } else {
      // Incorrect tap
      setIncorrectTaps(prev => prev + 1);

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      // Shake animation
      Animated.sequence([
        Animated.timing(shapeScales.get(shapeId)!, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(shapeScales.get(shapeId)!, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      speak('Try again!');
      setIsProcessing(false);
    }
  }, [isProcessing, canTap, targetShape, shapes, shapeScales, shapeOpacities]);

  useEffect(() => {
    if (rounds >= requiredRounds && !gameFinished) {
      finishGame();
    }
  }, [rounds, requiredRounds, gameFinished, finishGame]);

  useLayoutEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  useLayoutEffect(() => {
    advanceToNextRoundRef.current = advanceToNextRound;
  }, [advanceToNextRound]);

  useEffect(() => {
    try {
      speak('Tap the circle when it appears!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
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

  // Calculate positions for shapes
  const getShapePosition = (index: number) => {
    return {
      x: SCREEN_WIDTH * (0.25 + index * 0.25) - SHAPE_SIZE / 2,
      y: SCREEN_HEIGHT * 0.5 - SHAPE_SIZE / 2,
    };
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FDF4FF', '#FAE8FF']}
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
            <Text style={styles.title}>Tap the Circle</Text>
            <Text style={styles.subtitle}>
              {showInstruction ? `Tap the ${targetShape ? SHAPES.find(s => s.name === targetShape)?.displayName : ''}` : 'Get ready...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Instruction Banner */}
          {showInstruction && targetShape && (
            <Animated.View
              style={[
                styles.instructionBanner,
                {
                  transform: [{ scale: instructionScale }],
                  opacity: instructionOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={['#8B5CF6', '#7C3AED']}
                style={styles.instructionGradient}
              >
                <Ionicons name="shapes" size={28} color="#FFFFFF" />
                <Text style={styles.instructionText}>
                  Tap the {SHAPES.find(s => s.name === targetShape)?.displayName}
                </Text>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Shapes */}
          {shapes.map((shape, index) => {
            const position = getShapePosition(index);
            const scale = shapeScales.get(shape.id) || new Animated.Value(0);
            const opacity = shapeOpacities.get(shape.id) || new Animated.Value(0);

            return (
              <Pressable
                key={shape.id}
                onPress={() => handleShapeTap(shape.name, shape.id)}
                disabled={!canTap || isProcessing}
                style={[
                  styles.shapeContainer,
                  {
                    left: position.x,
                    top: position.y,
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
                    style={styles.shapeGradient}
                  >
                    <Text style={styles.shapeEmoji}>{shape.emoji}</Text>
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
            <Text style={styles.celebrationText}>✨ Perfect! ✨</Text>
          </Animated.View>

          {/* Progress Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>
              Round {rounds + 1} / {requiredRounds}
            </Text>
            <Text style={styles.statsSubtext}>
              ✓ Correct: {correctTaps} • ✗ Errors: {incorrectTaps}
            </Text>
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="shapes" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Shape Recognition</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="filter" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Instruction Discrimination</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="grid" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Categorization</Text>
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
  instructionBanner: {
    position: 'absolute',
    top: 40,
    width: '90%',
    zIndex: 10,
  },
  instructionGradient: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  instructionText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginLeft: 12,
    textTransform: 'capitalize',
  },
  shapeContainer: {
    position: 'absolute',
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
  },
  shape: {
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    borderRadius: SHAPE_SIZE / 2,
  },
  shapeGradient: {
    width: '100%',
    height: '100%',
    borderRadius: SHAPE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  shapeEmoji: {
    fontSize: 60,
  },
  celebration: {
    position: 'absolute',
    top: '30%',
    alignItems: 'center',
  },
  celebrationText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#8B5CF6',
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

