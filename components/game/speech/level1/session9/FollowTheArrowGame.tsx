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

const OBJECT_SIZE = 150;
const ARROW_SIZE = 120;
const DEFAULT_TTS_RATE = 0.75;
const ARROW_ANIMATION_DURATION_MS = 800;
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

const OBJECTS = [
  { emoji: '⚽', name: 'ball', color: ['#3B82F6', '#2563EB'] },
  { emoji: '🍎', name: 'apple', color: ['#EF4444', '#DC2626'] },
  { emoji: '🚗', name: 'car', color: ['#F59E0B', '#D97706'] },
  { emoji: '🐶', name: 'dog', color: ['#8B5CF6', '#7C3AED'] },
  { emoji: '🐱', name: 'cat', color: ['#EC4899', '#DB2777'] },
  { emoji: '📱', name: 'phone', color: ['#10B981', '#059669'] },
  { emoji: '🎈', name: 'balloon', color: ['#F472B6', '#EC4899'] },
  { emoji: '🎮', name: 'game', color: ['#6366F1', '#4F46E5'] },
];

export const FollowTheArrowGame: React.FC<Props> = ({
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
  const [leftObject, setLeftObject] = useState<typeof OBJECTS[0] | null>(null);
  const [rightObject, setRightObject] = useState<typeof OBJECTS[0] | null>(null);
  const [targetSide, setTargetSide] = useState<'left' | 'right' | null>(null);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [incorrectTaps, setIncorrectTaps] = useState(0);
  const [showInstruction, setShowInstruction] = useState(false);
  const [showArrow, setShowArrow] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  
  // Animations
  const leftScale = useRef(new Animated.Value(0)).current;
  const leftOpacity = useRef(new Animated.Value(0)).current;
  const rightScale = useRef(new Animated.Value(0)).current;
  const rightOpacity = useRef(new Animated.Value(0)).current;
  const arrowScale = useRef(new Animated.Value(0)).current;
  const arrowOpacity = useRef(new Animated.Value(0)).current;
  const arrowBounce = useRef(new Animated.Value(1)).current;
  const instructionScale = useRef(new Animated.Value(0)).current;
  const instructionOpacity = useRef(new Animated.Value(0)).current;
  const celebrationScale = useRef(new Animated.Value(1)).current;
  const celebrationOpacity = useRef(new Animated.Value(0)).current;
  
  // Timeouts
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const arrowBounceRef = useRef<Animated.CompositeAnimation | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);

  const finishGame = useCallback(async () => {
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (arrowBounceRef.current) {
      arrowBounceRef.current.stop();
      arrowBounceRef.current = null;
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
        type: 'follow-the-arrow',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['instruction-following', 'gestural-cue', 'nonverbal-communication', 'aac-preparation'],
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
    if (arrowBounceRef.current) {
      arrowBounceRef.current.stop();
      arrowBounceRef.current = null;
    }

    if (rounds >= requiredRounds) {
      return;
    }

    // Reset state
    setIsProcessing(false);
    setCanTap(false);
    setShowInstruction(false);
    setShowArrow(false);
    setTargetSide(null);
    
    // Select two random objects
    const shuffled = [...OBJECTS].sort(() => Math.random() - 0.5);
    const left = shuffled[0];
    const right = shuffled[1];
    
    // Randomly choose which side to target
    const target = Math.random() > 0.5 ? 'left' : 'right';
    
    setLeftObject(left);
    setRightObject(right);
    setTargetSide(target);

    // Reset animations
    leftScale.setValue(0);
    leftOpacity.setValue(0);
    rightScale.setValue(0);
    rightOpacity.setValue(0);
    arrowScale.setValue(0);
    arrowOpacity.setValue(0);
    arrowBounce.setValue(1);
    instructionScale.setValue(0);
    instructionOpacity.setValue(0);
    celebrationScale.setValue(1);
    celebrationOpacity.setValue(0);

    // Show objects
    Animated.parallel([
      Animated.spring(leftScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(leftOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(rightScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(rightOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    // Show arrow after objects appear
    setTimeout(() => {
      setShowArrow(true);
      
      // Arrow animation
      Animated.parallel([
        Animated.spring(arrowScale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(arrowOpacity, {
          toValue: 1,
          duration: ARROW_ANIMATION_DURATION_MS,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();

      // Arrow bounce animation
      arrowBounceRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(arrowBounce, {
            toValue: 1.15,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(arrowBounce, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      arrowBounceRef.current.start();

      // Show instruction after arrow appears
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
        speak('Tap here');

        // Allow tapping
        setCanTap(true);

        // Timeout for missed tap
        tapTimeoutRef.current = (setTimeout(() => {
          if (canTap && !isProcessing) {
            setIncorrectTaps(prev => prev + 1);
            speak('Try again!');
          }
          
          // Hide and advance
          Animated.parallel([
            Animated.timing(leftOpacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(rightOpacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(arrowOpacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(instructionOpacity, {
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
    }, 800);
  }, [rounds, requiredRounds, canTap, isProcessing]);

  const handleObjectTap = useCallback((side: 'left' | 'right') => {
    if (isProcessing || !canTap) return;

    setIsProcessing(true);

    // Clear timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (arrowBounceRef.current) {
      arrowBounceRef.current.stop();
      arrowBounceRef.current = null;
    }

    if (side === targetSide) {
      // Correct tap
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Celebration animation
      const targetScale = side === 'left' ? leftScale : rightScale;
      Animated.parallel([
        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 1.4,
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
          Animated.timing(leftOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(rightOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.timing(arrowOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: true,
          }),
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
      const wrongScale = side === 'left' ? leftScale : rightScale;
      Animated.sequence([
        Animated.timing(wrongScale, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(wrongScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      speak('Follow the arrow!');
      setIsProcessing(false);
    }
  }, [isProcessing, canTap, targetSide, leftScale, rightScale]);

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
      speak('Follow the arrow and tap the object it points to!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
      }
      if (arrowBounceRef.current) {
        arrowBounceRef.current.stop();
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

  if (!leftObject || !rightObject || !targetSide) return null;

  // Calculate arrow position
  const arrowX = targetSide === 'left' 
    ? SCREEN_WIDTH * 0.25 - ARROW_SIZE / 2
    : SCREEN_WIDTH * 0.75 - ARROW_SIZE / 2;
  const arrowY = SCREEN_HEIGHT * 0.3 - ARROW_SIZE / 2;
  const arrowRotation = targetSide === 'left' ? '180deg' : '0deg';

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FDF2F8', '#FCE7F3']}
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
            <Text style={styles.title}>Follow the Arrow</Text>
            <Text style={styles.subtitle}>
              {showInstruction ? 'Tap here!' : 'Watch the arrow...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Arrow */}
          {showArrow && (
            <Animated.View
              style={[
                styles.arrowContainer,
                {
                  left: arrowX,
                  top: arrowY,
                  transform: [
                    { scale: Animated.multiply(arrowScale, arrowBounce) },
                    { rotate: arrowRotation },
                  ],
                  opacity: arrowOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={['#EC4899', '#DB2777']}
                style={styles.arrow}
              >
                <Ionicons name="arrow-down" size={60} color="#FFFFFF" />
              </LinearGradient>
            </Animated.View>
          )}

          {/* Instruction Banner */}
          {showInstruction && (
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
                colors={['#EC4899', '#DB2777']}
                style={styles.instructionGradient}
              >
                <Ionicons name="hand-right" size={28} color="#FFFFFF" />
                <Text style={styles.instructionText}>Tap here</Text>
              </LinearGradient>
            </Animated.View>
          )}

          {/* Left Object */}
          <Pressable
            onPress={() => handleObjectTap('left')}
            disabled={!canTap || isProcessing}
            style={[
              styles.objectContainer,
              {
                left: SCREEN_WIDTH * 0.25 - OBJECT_SIZE / 2,
                top: SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.object,
                {
                  transform: [{ scale: leftScale }],
                  opacity: leftOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={leftObject.color as [string, string, ...string[]]}
                style={styles.objectGradient}
              >
                <Text style={styles.objectEmoji}>{leftObject.emoji}</Text>
              </LinearGradient>
            </Animated.View>
          </Pressable>

          {/* Right Object */}
          <Pressable
            onPress={() => handleObjectTap('right')}
            disabled={!canTap || isProcessing}
            style={[
              styles.objectContainer,
              {
                left: SCREEN_WIDTH * 0.75 - OBJECT_SIZE / 2,
                top: SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.object,
                {
                  transform: [{ scale: rightScale }],
                  opacity: rightOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={rightObject.color as [string, string, ...string[]]}
                style={styles.objectGradient}
              >
                <Text style={styles.objectEmoji}>{rightObject.emoji}</Text>
              </LinearGradient>
            </Animated.View>
          </Pressable>

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
            <Ionicons name="arrow-forward" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Instruction Following</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="hand-left" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Gestural Cue</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="chatbubbles" size={20} color="#0F172A" />
            <Text style={styles.skillText}>AAC Preparation</Text>
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
  arrowContainer: {
    position: 'absolute',
    width: ARROW_SIZE,
    height: ARROW_SIZE,
    zIndex: 5,
  },
  arrow: {
    width: '100%',
    height: '100%',
    borderRadius: ARROW_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 15,
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
    shadowColor: '#EC4899',
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
    fontSize: 75,
  },
  celebration: {
    position: 'absolute',
    top: '30%',
    alignItems: 'center',
  },
  celebrationText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#EC4899',
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

