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

const OBJECT_SIZE = 130;
const DEFAULT_TTS_RATE = 0.75;
const MOVEMENT_DURATION_MS = 6000; // 6 seconds slow movement
const TAP_DURATION_MS = 3000; // How long object is tappable after stopping

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
  { emoji: '🐢', name: 'turtle', color: ['#22C55E', '#16A34A'], trail: '#D1FAE5' },
  { emoji: '🐌', name: 'snail', color: ['#8B5CF6', '#7C3AED'], trail: '#EDE9FE' },
  { emoji: '🦋', name: 'butterfly', color: ['#EC4899', '#DB2777'], trail: '#FCE7F3' },
  { emoji: '🐘', name: 'elephant', color: ['#94A3B8', '#64748B'], trail: '#F1F5F9' },
  { emoji: '🐼', name: 'panda', color: ['#0F172A', '#1E293B'], trail: '#E2E8F0' },
  { emoji: '🦄', name: 'unicorn', color: ['#F472B6', '#EC4899'], trail: '#FCE7F3' },
];

const SHAPES = [
  { emoji: '🔵', name: 'circle', color: ['#3B82F6', '#2563EB'] },
  { emoji: '🔶', name: 'triangle', color: ['#F59E0B', '#D97706'] },
  { emoji: '🔷', name: 'diamond', color: ['#8B5CF6', '#7C3AED'] },
  { emoji: '⭐', name: 'star', color: ['#FCD34D', '#FBBF24'] },
];

export const FollowSlowMovementGame: React.FC<Props> = ({
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
  const [objectType, setObjectType] = useState<'animal' | 'shape'>('animal');
  const [phase, setPhase] = useState<'waiting' | 'moving' | 'stopped' | 'completed'>('waiting');
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
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
  const stopIndicatorScale = useRef(new Animated.Value(0)).current;
  const stopIndicatorOpacity = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const trailOpacity = useRef(new Animated.Value(0)).current;
  
  // Timeouts
  const movementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
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
    const xp = correctTaps * 32;

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
        type: 'follow-slow-movement',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['extended-attention', 'eye-tracking', 'visual-patience', 'sustained-focus'],
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
    }, 800);
  }, [requiredRounds]);

  const startRound = useCallback(() => {
    // Clear all timeouts and animations
    if (movementTimeoutRef.current) {
      clearTimeout(movementTimeoutRef.current);
      movementTimeoutRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
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
    
    // Reset animations - position object at start (account for object size to center it)
    objectX.setValue(SCREEN_WIDTH * 0.1 - OBJECT_SIZE / 2);
    objectY.setValue(SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2);
    objectScale.setValue(1);
    objectRotation.setValue(0);
    objectOpacity.setValue(0);
    stopIndicatorScale.setValue(0);
    stopIndicatorOpacity.setValue(0);
    pulseScale.setValue(1);
    trailOpacity.setValue(0);

    // Randomly choose animal or shape
    const useAnimal = Math.random() > 0.5;
    setObjectType(useAnimal ? 'animal' : 'shape');
    
    const objIndex = Math.floor(Math.random() * (useAnimal ? MOVING_OBJECTS.length : SHAPES.length));
    setCurrentObject(objIndex);

    speak('Follow the movement...');

    // Animate object appearance
    Animated.parallel([
      Animated.timing(objectOpacity, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(trailOpacity, {
        toValue: 0.3,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();

    // Start gentle rotation
    rotationAnimationRef.current = Animated.loop(
      Animated.timing(objectRotation, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    rotationAnimationRef.current.start();

    // Start slow movement after brief delay
    setTimeout(() => {
      setPhase('moving');
      
      // Random movement direction and path
      const directions = [
        'left-to-right',
        'right-to-left',
        'top-to-bottom',
        'bottom-to-top',
        'diagonal-up',
        'diagonal-down',
        'curved-left',
        'curved-right',
      ];
      const direction = directions[Math.floor(Math.random() * directions.length)];
      
      let startX: number, startY: number, endX: number, endY: number;
      let keyframes: { x: number; y: number; progress: number }[];
      
      // Define paths based on random direction
      switch (direction) {
        case 'left-to-right':
          startX = SCREEN_WIDTH * 0.1 - OBJECT_SIZE / 2;
          startY = SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2;
          endX = SCREEN_WIDTH * 0.8 - OBJECT_SIZE / 2;
          endY = SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2;
          keyframes = [
            { x: startX, y: startY, progress: 0 },
            { x: endX, y: endY, progress: 1 },
          ];
          break;
        case 'right-to-left':
          startX = SCREEN_WIDTH * 0.8 - OBJECT_SIZE / 2;
          startY = SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2;
          endX = SCREEN_WIDTH * 0.1 - OBJECT_SIZE / 2;
          endY = SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2;
          keyframes = [
            { x: startX, y: startY, progress: 0 },
            { x: endX, y: endY, progress: 1 },
          ];
          break;
        case 'top-to-bottom':
          startX = SCREEN_WIDTH * 0.5 - OBJECT_SIZE / 2;
          startY = SCREEN_HEIGHT * 0.2 - OBJECT_SIZE / 2;
          endX = SCREEN_WIDTH * 0.5 - OBJECT_SIZE / 2;
          endY = SCREEN_HEIGHT * 0.7 - OBJECT_SIZE / 2;
          keyframes = [
            { x: startX, y: startY, progress: 0 },
            { x: endX, y: endY, progress: 1 },
          ];
          break;
        case 'bottom-to-top':
          startX = SCREEN_WIDTH * 0.5 - OBJECT_SIZE / 2;
          startY = SCREEN_HEIGHT * 0.7 - OBJECT_SIZE / 2;
          endX = SCREEN_WIDTH * 0.5 - OBJECT_SIZE / 2;
          endY = SCREEN_HEIGHT * 0.2 - OBJECT_SIZE / 2;
          keyframes = [
            { x: startX, y: startY, progress: 0 },
            { x: endX, y: endY, progress: 1 },
          ];
          break;
        case 'diagonal-up':
          startX = SCREEN_WIDTH * 0.15 - OBJECT_SIZE / 2;
          startY = SCREEN_HEIGHT * 0.7 - OBJECT_SIZE / 2;
          endX = SCREEN_WIDTH * 0.75 - OBJECT_SIZE / 2;
          endY = SCREEN_HEIGHT * 0.3 - OBJECT_SIZE / 2;
          keyframes = [
            { x: startX, y: startY, progress: 0 },
            { x: endX, y: endY, progress: 1 },
          ];
          break;
        case 'diagonal-down':
          startX = SCREEN_WIDTH * 0.15 - OBJECT_SIZE / 2;
          startY = SCREEN_HEIGHT * 0.3 - OBJECT_SIZE / 2;
          endX = SCREEN_WIDTH * 0.75 - OBJECT_SIZE / 2;
          endY = SCREEN_HEIGHT * 0.7 - OBJECT_SIZE / 2;
          keyframes = [
            { x: startX, y: startY, progress: 0 },
            { x: endX, y: endY, progress: 1 },
          ];
          break;
        case 'curved-left':
          startX = SCREEN_WIDTH * 0.8 - OBJECT_SIZE / 2;
          startY = SCREEN_HEIGHT * 0.3 - OBJECT_SIZE / 2;
          endX = SCREEN_WIDTH * 0.2 - OBJECT_SIZE / 2;
          endY = SCREEN_HEIGHT * 0.6 - OBJECT_SIZE / 2;
          keyframes = [
            { x: startX, y: startY, progress: 0 },
            { x: startX + (endX - startX) * 0.5, y: startY + 40, progress: 0.5 },
            { x: endX, y: endY, progress: 1 },
          ];
          break;
        case 'curved-right':
        default:
          startX = SCREEN_WIDTH * 0.1 - OBJECT_SIZE / 2;
          startY = SCREEN_HEIGHT * 0.5 - OBJECT_SIZE / 2;
          endX = SCREEN_WIDTH * 0.8 - OBJECT_SIZE / 2;
          endY = SCREEN_HEIGHT * 0.4 - OBJECT_SIZE / 2;
          keyframes = [
            { x: startX, y: startY, progress: 0 },
            { x: startX + (endX - startX) * 0.3, y: startY - 30, progress: 0.3 },
            { x: startX + (endX - startX) * 0.6, y: endY, progress: 0.6 },
            { x: endX, y: endY, progress: 1 },
          ];
          break;
      }

      // Set initial position
      objectX.setValue(startX);
      objectY.setValue(startY);

      const animations = keyframes.map((kf, i) => {
        if (i === 0) return null;
        const prev = keyframes[i - 1];
        return Animated.parallel([
          Animated.timing(objectX, {
            toValue: kf.x,
            duration: MOVEMENT_DURATION_MS * (kf.progress - prev.progress),
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false, // Must be false for left/top positioning
          }),
          Animated.timing(objectY, {
            toValue: kf.y,
            duration: MOVEMENT_DURATION_MS * (kf.progress - prev.progress),
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false, // Must be false for left/top positioning
          }),
        ]);
      }).filter(Boolean) as Animated.CompositeAnimation[];

      Animated.sequence(animations).start();

      // After movement completes, object stops
      movementTimeoutRef.current = (setTimeout(() => {
        setPhase('stopped');
        
        // Stop rotation
        if (rotationAnimationRef.current) {
          rotationAnimationRef.current.stop();
          rotationAnimationRef.current = null;
        }
        objectRotation.setValue(0);

        // Show stop indicator
        Animated.parallel([
          Animated.spring(stopIndicatorScale, {
            toValue: 1,
            tension: 50,
            friction: 7,
            useNativeDriver: true,
          }),
          Animated.timing(stopIndicatorOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]).start();

        // Pulse animation
        pulseAnimationRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(pulseScale, {
              toValue: 1.15,
              duration: 700,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulseScale, {
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

        // Object expires after duration
        tapTimeoutRef.current = (setTimeout(() => {
          if (canTap && !isProcessing) {
            setMissedTaps(prev => prev + 1);
            speak('Time\'s up!');
          }
          
          // Hide and advance
          Animated.parallel([
            Animated.timing(objectOpacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(stopIndicatorOpacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
            Animated.timing(trailOpacity, {
              toValue: 0,
              duration: 300,
              useNativeDriver: true,
            }),
          ]).start(() => {
            setRounds(prev => {
              const nextRound = prev + 1;
              advanceToNextRoundRef.current?.(nextRound);
              return nextRound;
            });
          });
          
          tapTimeoutRef.current = null;
        }, TAP_DURATION_MS)) as unknown as NodeJS.Timeout;
        
        movementTimeoutRef.current = null;
      }, MOVEMENT_DURATION_MS)) as unknown as NodeJS.Timeout;
    }, 500);
  }, [rounds, requiredRounds, canTap, isProcessing, SCREEN_WIDTH, SCREEN_HEIGHT]);

  const handleObjectTap = useCallback(() => {
    if (isProcessing) return;

    // Clear timeouts
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }

    // Stop animations
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }

    setIsProcessing(true);

    if (phase === 'stopped' && canTap) {
      // Correct tap
      setCorrectTaps(prev => prev + 1);
      setCanTap(false);
      setPhase('completed');

      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}

      // Celebration animation
      Animated.sequence([
        Animated.parallel([
          Animated.timing(objectScale, {
            toValue: 1.4,
            duration: 250,
            useNativeDriver: true,
          }),
          Animated.timing(pulseScale, {
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
          Animated.timing(pulseScale, {
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

      // Hide and advance
      Animated.parallel([
        Animated.timing(objectOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(stopIndicatorOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(trailOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setRounds(prev => {
          const nextRound = prev + 1;
          advanceToNextRoundRef.current?.(nextRound);
          return nextRound;
        });
      });
    } else if (phase === 'moving') {
      // Early tap
      setEarlyTaps(prev => prev + 1);

      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}

      // Gentle feedback
      Animated.sequence([
        Animated.timing(objectScale, {
          toValue: 0.9,
          duration: 100,
          useNativeDriver: true,
        }),
        Animated.timing(objectScale, {
          toValue: 1,
          duration: 100,
          useNativeDriver: true,
        }),
      ]).start();

      speak('Wait for it to stop!');
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
      speak('Follow the slow movement, then tap when it stops!');
    } catch {}
    startRoundRef.current?.();
    return () => {
      clearScheduledSpeech();
      stopAllSpeech();
      cleanupSounds();
      if (movementTimeoutRef.current) {
        clearTimeout(movementTimeoutRef.current);
      }
      if (tapTimeoutRef.current) {
        clearTimeout(tapTimeoutRef.current);
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

  const objectPulseScale = Animated.multiply(objectScale, pulseScale);
  const object = objectType === 'animal' ? MOVING_OBJECTS[currentObject] : SHAPES[currentObject];

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0FDF4', '#DCFCE7']}
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
            <Text style={styles.title}>Follow the Slow Movement</Text>
            <Text style={styles.subtitle}>
              {phase === 'moving' ? 'Watch it move...' : phase === 'stopped' ? 'Tap when it stops!' : 'Get ready...'}
            </Text>
          </View>
        </View>

        <View style={styles.playArea}>
          {/* Stop Indicator - Always at center */}
          {phase === 'stopped' && (
            <Animated.View
              style={[
                styles.stopIndicator,
                {
                  left: SCREEN_WIDTH / 2 - 40,
                  top: SCREEN_HEIGHT / 2 - 40,
                  transform: [{ scale: stopIndicatorScale }],
                  opacity: stopIndicatorOpacity,
                },
              ]}
            >
              <View style={styles.stopCircle}>
                <Text style={styles.stopText}>✓</Text>
              </View>
            </Animated.View>
          )}

          {/* Moving Object */}
          <Pressable
            onPress={handleObjectTap}
            disabled={isProcessing && phase !== 'stopped'}
            style={styles.objectContainer}
          >
            <Animated.View
              style={[
                styles.object,
                {
                  left: objectX,
                  top: objectY,
                  transform: [
                    { scale: phase === 'stopped' ? objectPulseScale : objectScale },
                    { rotate: rotation },
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
              </LinearGradient>
            </Animated.View>
          </Pressable>

          {/* Trail Effect - Follows object position (only show during movement) */}
          {phase === 'moving' && (
            <Animated.View
              style={[
                styles.trail,
                {
                  left: objectX,
                  top: objectY,
                  opacity: trailOpacity,
                },
              ]}
            />
          )}

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
            <Ionicons name="eye" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Extended Attention</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="move" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Eye Tracking</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="hourglass" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Visual Patience</Text>
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
  stopIndicator: {
    position: 'absolute',
    width: 80,
    height: 80,
    zIndex: 10,
  },
  stopCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 15,
  },
  stopText: {
    fontSize: 40,
    color: '#FFFFFF',
    fontWeight: 'bold',
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
    fontSize: 70,
  },
  trail: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#D1FAE5',
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

