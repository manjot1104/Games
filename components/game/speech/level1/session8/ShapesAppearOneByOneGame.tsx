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

const SHAPE_SIZE = 100;
const DEFAULT_TTS_RATE = 0.75;
const APPEAR_INTERVAL_MS = 2000; // 2 seconds between shapes
const TAP_DURATION_MS = 4000; // How long shapes are tappable after all appear

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
  { emoji: '🔵', name: 'circle', color: ['#3B82F6', '#2563EB'] },
  { emoji: '🔶', name: 'triangle', color: ['#F59E0B', '#D97706'] },
  { emoji: '🔷', name: 'diamond', color: ['#8B5CF6', '#7C3AED'] },
  { emoji: '⭐', name: 'star', color: ['#FCD34D', '#FBBF24'] },
  { emoji: '🟢', name: 'square', color: ['#22C55E', '#16A34A'] },
  { emoji: '❤️', name: 'heart', color: ['#EC4899', '#DB2777'] },
];

export const ShapesAppearOneByOneGame: React.FC<Props> = ({
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
  const [shapes, setShapes] = useState<{ id: number; emoji: string; color: string[]; tapped: boolean; x: number; y: number }[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [incorrectTaps, setIncorrectTaps] = useState(0);
  const [tappedShapes, setTappedShapes] = useState<Set<number>>(new Set());
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations - one per shape
  const shapeScales = useRef<Map<number, Animated.Value>>(new Map()).current;
  const shapeOpacities = useRef<Map<number, Animated.Value>>(new Map()).current;
  
  // Timeouts
  const appearanceTimeoutsRef = useRef<NodeJS.Timeout[]>([]);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);

  const finishGame = useCallback(async () => {
    // Clear all timeouts
    appearanceTimeoutsRef.current.forEach(t => clearTimeout(t));
    appearanceTimeoutsRef.current = [];
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const totalAttempts = correctTaps + incorrectTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 35;

    setFinalStats({
      totalRounds: requiredRounds,
      correctTaps,
      incorrectTaps,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'shapes-appear-one-by-one',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['multi-step-attention', 'memory', 'focus', 'sequencing'],
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
    }, 800);
  }, [requiredRounds]);

  const startRound = useCallback(() => {
    // Clear all timeouts
    appearanceTimeoutsRef.current.forEach(t => clearTimeout(t));
    appearanceTimeoutsRef.current = [];
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
    setVisibleCount(0);
    setTappedShapes(new Set());
    
    // Select 3 random shapes with positions
    const positions = [
      { x: SCREEN_WIDTH * 0.25 - SHAPE_SIZE / 2, y: SCREEN_HEIGHT * 0.4 - SHAPE_SIZE / 2 },
      { x: SCREEN_WIDTH * 0.5 - SHAPE_SIZE / 2, y: SCREEN_HEIGHT * 0.4 - SHAPE_SIZE / 2 },
      { x: SCREEN_WIDTH * 0.75 - SHAPE_SIZE / 2, y: SCREEN_HEIGHT * 0.4 - SHAPE_SIZE / 2 },
    ];
    
    const selectedShapes: { id: number; emoji: string; color: string[]; tapped: boolean; x: number; y: number }[] = [];
    const availableShapes = [...SHAPES];
    for (let i = 0; i < 3; i++) {
      const randomIndex = Math.floor(Math.random() * availableShapes.length);
      const shape = availableShapes[randomIndex];
      selectedShapes.push({
        id: i,
        emoji: shape.emoji,
        color: shape.color,
        tapped: false,
        x: positions[i].x,
        y: positions[i].y,
      });
      availableShapes.splice(randomIndex, 1);
    }
    
    setShapes(selectedShapes);

    // Initialize animations for each shape
    selectedShapes.forEach((shape) => {
      if (!shapeScales.has(shape.id)) {
        shapeScales.set(shape.id, new Animated.Value(0));
        shapeOpacities.set(shape.id, new Animated.Value(0));
      } else {
        shapeScales.get(shape.id)!.setValue(0);
        shapeOpacities.get(shape.id)!.setValue(0);
      }
    });

    speak('Watch the shapes appear...');

    // Make shapes appear one by one
    selectedShapes.forEach((shape, index) => {
      const timeout = (setTimeout(() => {
        setVisibleCount(prev => prev + 1);

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

        // After all 3 appear, allow tapping
        if (index === selectedShapes.length - 1) {
          setTimeout(() => {
            setCanTap(true);
            speak('Tap all three shapes!');
            
            // Shapes expire after duration
            tapTimeoutRef.current = (setTimeout(() => {
              if (canTap && !isProcessing) {
                setIncorrectTaps(prev => prev + 1);
                speak('Time\'s up!');
              }
              
              // Hide shapes and advance
              selectedShapes.forEach((s) => {
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
            }, TAP_DURATION_MS)) as unknown as NodeJS.Timeout;
          }, 500);
        }
      }, index * APPEAR_INTERVAL_MS)) as unknown as NodeJS.Timeout;
      
      appearanceTimeoutsRef.current.push(timeout);
    });
  }, [rounds, requiredRounds, canTap, isProcessing, SCREEN_WIDTH, SCREEN_HEIGHT, shapeScales, shapeOpacities]);

  const handleShapeTap = useCallback((shapeId: number) => {
    if (isProcessing || !canTap) return;

    // Check if already tapped
    if (tappedShapes.has(shapeId)) {
      return;
    }

    // Mark as tapped using functional update to get latest state
    setTappedShapes(prevTapped => {
      const newTappedShapes = new Set(prevTapped);
      newTappedShapes.add(shapeId);
      
      // Update shape state
      setShapes(prevShapes => prevShapes.map(s => 
        s.id === shapeId ? { ...s, tapped: true } : s
      ));

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}

      // Animate tap
      Animated.sequence([
        Animated.timing(shapeScales.get(shapeId)!, {
          toValue: 1.3,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(shapeScales.get(shapeId)!, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();

      // Check if all 3 shapes are tapped
      if (newTappedShapes.size === 3) {
        setIsProcessing(true);
        setCanTap(false);
        setCorrectTaps(prev => prev + 1);

        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } catch {}

        // Celebration animation - use current shapes state
        setShapes(currentShapes => {
          currentShapes.forEach((shape) => {
            Animated.sequence([
              Animated.parallel([
                Animated.timing(shapeScales.get(shape.id)!, {
                  toValue: 1.4,
                  duration: 200,
                  useNativeDriver: true,
                }),
                Animated.timing(shapeOpacities.get(shape.id)!, {
                  toValue: 0.8,
                  duration: 200,
                  useNativeDriver: true,
                }),
              ]),
              Animated.parallel([
                Animated.timing(shapeScales.get(shape.id)!, {
                  toValue: 1,
                  duration: 200,
                  useNativeDriver: true,
                }),
                Animated.timing(shapeOpacities.get(shape.id)!, {
                  toValue: 1,
                  duration: 200,
                  useNativeDriver: true,
                }),
              ]),
            ]).start();
          });
          return currentShapes;
        });

        // Show success animation instead of TTS
        setShowRoundSuccess(true);
        setTimeout(() => {
          setShowRoundSuccess(false);
        }, 2500);

        // Clear timeout
        if (tapTimeoutRef.current) {
          clearTimeout(tapTimeoutRef.current);
          tapTimeoutRef.current = null;
        }

        // Hide shapes and advance
        setTimeout(() => {
          setShapes(currentShapes => {
            currentShapes.forEach((shape) => {
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
            return currentShapes;
          });
          
          setTimeout(() => {
            setRounds(prev => {
              const nextRound = prev + 1;
              advanceToNextRoundRef.current?.(nextRound);
              return nextRound;
            });
          }, 400);
        }, 1000);
      } else {
        // Show success animation for partial success
        setShowRoundSuccess(true);
        setTimeout(() => {
          setShowRoundSuccess(false);
        }, 2500);
      }
      
      return newTappedShapes;
    });
  }, [isProcessing, canTap, tappedShapes, shapeScales, shapeOpacities]);

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
      speak('Watch shapes appear one by one, then tap them!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      appearanceTimeoutsRef.current.forEach(t => clearTimeout(t));
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
            <Text style={styles.title}>Shapes Appear One By One</Text>
            <Text style={styles.subtitle}>
              {visibleCount < 3 ? `Watch... ${visibleCount}/3` : canTap ? 'Tap all three shapes!' : 'Get ready...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {shapes.map((shape) => {
            const scale = shapeScales.get(shape.id) || new Animated.Value(0);
            const opacity = shapeOpacities.get(shape.id) || new Animated.Value(0);

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
                    style={styles.shapeGradient}
                  >
                    <Text style={styles.shapeEmoji}>{shape.emoji}</Text>
                    {shape.tapped && (
                      <View style={styles.checkmark}>
                        <Text style={styles.checkmarkText}>✓</Text>
                      </View>
                    )}
                  </LinearGradient>
                </Animated.View>
              </Pressable>
            );
          })}

          {/* Progress Stats */}
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>
              Round {rounds + 1} / {requiredRounds}
            </Text>
            <Text style={styles.statsSubtext}>
              ✓ Perfect: {correctTaps} • ✗ Errors: {incorrectTaps}
            </Text>
            {visibleCount === 3 && canTap && (
              <Text style={styles.tapHint}>
                Tap all {3 - tappedShapes.size} remaining shapes!
              </Text>
            )}
          </View>
        </View>

        {/* Skills Footer */}
        <View style={styles.skillsContainer}>
          <View style={styles.skillItem}>
            <Ionicons name="layers" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Multi-step Attention</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="bulb" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Memory & Focus</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="list" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Sequencing</Text>
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
    fontSize: 50,
  },
  checkmark: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: 'bold',
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
    marginBottom: 8,
  },
  tapHint: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8B5CF6',
    marginTop: 4,
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

