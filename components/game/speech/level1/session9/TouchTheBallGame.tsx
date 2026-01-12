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

const OBJECT_SIZE = 140;
const DEFAULT_TTS_RATE = 0.75;
const GLOW_DURATION_MS = 1000;
const INSTRUCTION_DELAY_MS = 800;

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
  { emoji: '⚽', name: 'ball', color: ['#3B82F6', '#2563EB'], displayName: 'ball' },
  { emoji: '🍎', name: 'apple', color: ['#EF4444', '#DC2626'], displayName: 'apple' },
  { emoji: '🚗', name: 'car', color: ['#F59E0B', '#D97706'], displayName: 'car' },
  { emoji: '🐶', name: 'dog', color: ['#8B5CF6', '#7C3AED'], displayName: 'dog' },
  { emoji: '🐱', name: 'cat', color: ['#EC4899', '#DB2777'], displayName: 'cat' },
  { emoji: '📱', name: 'phone', color: ['#10B981', '#059669'], displayName: 'phone' },
];

export const TouchTheBallGame: React.FC<Props> = ({
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
  const [objects, setObjects] = useState<{ id: number; emoji: string; color: string[]; name: string; displayName: string }[]>([]);
  const [targetObject, setTargetObject] = useState<string | null>(null);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [incorrectTaps, setIncorrectTaps] = useState(0);
  const [showInstruction, setShowInstruction] = useState(false);
  const [glowingObjectId, setGlowingObjectId] = useState<number | null>(null);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const objectScales = useRef<Map<number, Animated.Value>>(new Map()).current;
  const objectOpacities = useRef<Map<number, Animated.Value>>(new Map()).current;
  const glowScales = useRef<Map<number, Animated.Value>>(new Map()).current;
  const glowOpacities = useRef<Map<number, Animated.Value>>(new Map()).current;
  const instructionScale = useRef(new Animated.Value(0)).current;
  const instructionOpacity = useRef(new Animated.Value(0)).current;
  const celebrationScale = useRef(new Animated.Value(1)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  
  // Timeouts
  const glowTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);

  const finishGame = useCallback(async () => {
    if (glowTimeoutRef.current) {
      clearTimeout(glowTimeoutRef.current);
      glowTimeoutRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const totalAttempts = correctTaps + incorrectTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 30;

    setFinalStats({
      totalRounds: requiredRounds,
      correctTaps,
      incorrectTaps,
      accuracy,
      xpAwarded: xp,
    });

    try {
      const result = await logGameAndAward({
        type: 'touch-the-ball',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['receptive-command', 'object-identification', 'instruction-following'],
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

  const startRound = useCallback(() => {
    // Clear timeouts
    if (glowTimeoutRef.current) {
      clearTimeout(glowTimeoutRef.current);
      glowTimeoutRef.current = null;
    }
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
    setGlowingObjectId(null);
    setTargetObject(null);
    
    // Select 2-3 random objects
    const numObjects = Math.random() > 0.5 ? 2 : 3;
    const shuffled = [...OBJECTS].sort(() => Math.random() - 0.5);
    const selectedObjects = shuffled.slice(0, numObjects).map((obj, idx) => ({
      id: idx,
      emoji: obj.emoji,
      color: obj.color,
      name: obj.name,
      displayName: obj.displayName,
    }));
    
    // Select target object
    const target = selectedObjects[Math.floor(Math.random() * selectedObjects.length)];
    
    setObjects(selectedObjects);
    setTargetObject(target.name);

    // Initialize animations
    selectedObjects.forEach((obj) => {
      if (!objectScales.has(obj.id)) {
        objectScales.set(obj.id, new Animated.Value(0));
        objectOpacities.set(obj.id, new Animated.Value(0));
        glowScales.set(obj.id, new Animated.Value(1));
        glowOpacities.set(obj.id, new Animated.Value(0));
      } else {
        objectScales.get(obj.id)!.setValue(0);
        objectOpacities.get(obj.id)!.setValue(0);
        glowScales.get(obj.id)!.setValue(1);
        glowOpacities.get(obj.id)!.setValue(0);
      }
    });

    instructionScale.setValue(0);
    instructionOpacity.setValue(0);
    celebrationScale.setValue(1);
    celebrationOpacity.setValue(0);

    // Show objects
    selectedObjects.forEach((obj, index) => {
      setTimeout(() => {
        Animated.parallel([
          Animated.spring(objectScales.get(obj.id)!, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(objectOpacities.get(obj.id)!, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();
      }, index * 200);
    });

    // Show instruction after objects appear
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
      speak(`Touch the ${target.displayName}`);

      // Make target object glow
      setTimeout(() => {
        const targetObj = selectedObjects.find(o => o.name === target.name);
        if (targetObj) {
          setGlowingObjectId(targetObj.id);
          
          // Glow animation
          Animated.sequence([
            Animated.parallel([
              Animated.timing(glowScales.get(targetObj.id)!, {
                toValue: 1.2,
                duration: GLOW_DURATION_MS / 2,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.timing(glowOpacities.get(targetObj.id)!, {
                toValue: 0.6,
                duration: GLOW_DURATION_MS / 2,
                useNativeDriver: true,
              }),
            ]),
            Animated.parallel([
              Animated.timing(glowScales.get(targetObj.id)!, {
                toValue: 1,
                duration: GLOW_DURATION_MS / 2,
                easing: Easing.inOut(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.timing(glowOpacities.get(targetObj.id)!, {
                toValue: 0,
                duration: GLOW_DURATION_MS / 2,
                useNativeDriver: true,
              }),
            ]),
          ]).start();

          glowTimeoutRef.current = (setTimeout(() => {
            setGlowingObjectId(null);
            glowTimeoutRef.current = null;
          }, GLOW_DURATION_MS)) as unknown as NodeJS.Timeout;
        }
      }, INSTRUCTION_DELAY_MS);

      // Allow tapping
      setCanTap(true);

      // Timeout for missed tap
      tapTimeoutRef.current = (setTimeout(() => {
        if (canTap && !isProcessing) {
          setIncorrectTaps(prev => prev + 1);
          speak('Try again!');
        }
        
        // Hide and advance
        selectedObjects.forEach((obj) => {
          Animated.parallel([
            Animated.timing(objectOpacities.get(obj.id)!, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(objectScales.get(obj.id)!, {
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
    }, 1000);
  }, [rounds, requiredRounds, canTap, isProcessing, objectScales, objectOpacities, glowScales, glowOpacities]);

  useLayoutEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  const advanceToNextRound = useCallback((nextRound: number) => {
    if (nextRound >= requiredRounds) {
      return;
    }
    setTimeout(() => {
      startRoundRef.current?.();
    }, 1000);
  }, [requiredRounds]);

  useLayoutEffect(() => {
    advanceToNextRoundRef.current = advanceToNextRound;
  }, [advanceToNextRound]);

  const handleObjectTap = useCallback((objectName: string, objectId: number) => {
    if (isProcessing || !canTap) return;

    setIsProcessing(true);

    // Clear timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }

    if (objectName === targetObject) {
      // Correct tap
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Celebration animation
      Animated.parallel([
        Animated.sequence([
          Animated.timing(objectScales.get(objectId)!, {
            toValue: 1.4,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(objectScales.get(objectId)!, {
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
        objects.forEach((obj) => {
          Animated.parallel([
            Animated.timing(objectOpacities.get(obj.id)!, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(objectScales.get(obj.id)!, {
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
        Animated.timing(objectScales.get(objectId)!, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(objectScales.get(objectId)!, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      speak('Try the other one!');
      setIsProcessing(false);
    }
  }, [isProcessing, canTap, targetObject, objects, objectScales, objectOpacities]);

  useEffect(() => {
    if (rounds >= requiredRounds && !gameFinished) {
      finishGame();
    }
  }, [rounds, requiredRounds, gameFinished, finishGame]);

  useEffect(() => {
    try {
      speak('Touch the ball when it appears!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (glowTimeoutRef.current) {
        clearTimeout(glowTimeoutRef.current);
      }
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

  // Calculate positions for objects
  const getObjectPosition = (index: number, total: number) => {
    if (total === 2) {
      return {
        x: SCREEN_WIDTH * (0.3 + index * 0.4) - OBJECT_SIZE / 2,
        y: SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2,
      };
    } else {
      return {
        x: SCREEN_WIDTH * (0.2 + index * 0.3) - OBJECT_SIZE / 2,
        y: SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2,
      };
    }
  };

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
            <Text style={styles.title}>Touch the Ball</Text>
            <Text style={styles.subtitle}>
              {showInstruction ? `Touch the ${targetObject ? OBJECTS.find(o => o.name === targetObject)?.displayName : ''}` : 'Get ready...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Instruction Banner */}
          {showInstruction && targetObject && (
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
                colors={['#3B82F6', '#2563EB']}
                style={styles.instructionGradient}
              >
                <Ionicons name="megaphone" size={28} color="#FFFFFF" />
                <Text style={styles.instructionText}>
                  Touch the {OBJECTS.find(o => o.name === targetObject)?.displayName}
                </Text>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Objects */}
          {objects.map((obj, index) => {
            const position = getObjectPosition(index, objects.length);
            const scale = objectScales.get(obj.id) || new Animated.Value(0);
            const opacity = objectOpacities.get(obj.id) || new Animated.Value(0);
            const glowScale = glowScales.get(obj.id) || new Animated.Value(1);
            const glowOpacity = glowOpacities.get(obj.id) || new Animated.Value(0);
            const isGlowing = glowingObjectId === obj.id;

            return (
              <Pressable
                key={obj.id}
                onPress={() => handleObjectTap(obj.name, obj.id)}
                disabled={!canTap || isProcessing}
                style={[
                  styles.objectContainer,
                  {
                    left: position.x,
                    top: position.y,
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.object,
                    {
                      transform: [{ scale }],
                      opacity,
                    },
                  ]}
                >
                  {/* Glow effect */}
                  {isGlowing && (
                    <Animated.View
                      style={[
                        styles.glow,
                        {
                          transform: [{ scale: glowScale }],
                          opacity: glowOpacity,
                        },
                      ]}
                    />
                  )}
                  <LinearGradient
                    colors={obj.color as any as [string, string, ...string[]]}
                    style={styles.objectGradient}
                  >
                    <Text style={styles.objectEmoji}>{obj.emoji}</Text>
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
            <Text style={styles.celebrationText}>🎉 Great Job! 🎉</Text>
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
            <Ionicons name="ear" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Receptive Command</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="eye" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Object Identification</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="hand-right" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Instruction Following</Text>
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
    shadowColor: '#3B82F6',
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
  objectContainer: {
    position: 'absolute',
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
  },
  object: {
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
    borderRadius: OBJECT_SIZE / 2,
    position: 'relative',
  },
  glow: {
    position: 'absolute',
    width: OBJECT_SIZE + 40,
    height: OBJECT_SIZE + 40,
    borderRadius: (OBJECT_SIZE + 40) / 2,
    backgroundColor: '#FCD34D',
    top: -20,
    left: -20,
    shadowColor: '#FCD34D',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 20,
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
    fontSize: 70,
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

