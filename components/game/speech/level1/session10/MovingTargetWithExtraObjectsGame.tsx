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

const TARGET_SIZE = 150;
const DISTRACTION_SIZE = 120;
const DEFAULT_TTS_RATE = 0.75;
const MOVEMENT_DURATION_MS = 7000;
const TAP_TIMEOUT_MS = 12000;
const MIN_DISTANCE_BETWEEN_OBJECTS = 180; // Minimum distance to avoid overlap

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
  { emoji: '🎯', name: 'target', color: ['#EF4444', '#DC2626'] },
];

const DISTRACTIONS = [
  { emoji: '🔵', name: 'circle', color: ['#10B981', '#059669'] },
  { emoji: '🔶', name: 'triangle', color: ['#F59E0B', '#D97706'] },
  { emoji: '💎', name: 'diamond', color: ['#8B5CF6', '#7C3AED'] },
  { emoji: '🟣', name: 'purple', color: ['#A855F7', '#9333EA'] },
  { emoji: '🟡', name: 'yellow', color: ['#EAB308', '#CA8A04'] },
];

type MovementPath = { x: number; y: number }[];

// Generate dynamic movement paths
const generateMovementPath = (
  screenWidth: number,
  screenHeight: number,
  objectSize: number,
  pathType: 'smooth' | 'zigzag' | 'circular' | 'figure8' | 'wave' | 'random'
): MovementPath => {
  const margin = objectSize / 2 + 20;
  const minX = margin;
  const maxX = screenWidth - margin;
  const minY = margin + 100; // Account for header
  const maxY = screenHeight - margin - 150; // Account for footer
  
  const points: MovementPath = [];
  const numPoints = 5;
  
  switch (pathType) {
    case 'smooth': {
      // Smooth curved path
      for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const x = minX + (maxX - minX) * (0.2 + 0.6 * Math.sin(t * Math.PI));
        const y = minY + (maxY - minY) * (0.3 + 0.4 * Math.cos(t * Math.PI * 1.5));
        points.push({ x: x - objectSize / 2, y: y - objectSize / 2 });
      }
      break;
    }
    case 'zigzag': {
      // Zigzag pattern
      for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const x = minX + (maxX - minX) * t;
        const y = minY + (maxY - minY) * (0.3 + 0.4 * (i % 2));
        points.push({ x: x - objectSize / 2, y: y - objectSize / 2 });
      }
      break;
    }
    case 'circular': {
      // Circular path
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const radius = Math.min(maxX - centerX, maxY - centerY) * 0.6;
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / (numPoints - 1)) * Math.PI * 2;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        points.push({ x: x - objectSize / 2, y: y - objectSize / 2 });
      }
      break;
    }
    case 'figure8': {
      // Figure-8 pattern
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const radius = Math.min(maxX - centerX, maxY - centerY) * 0.4;
      for (let i = 0; i < numPoints; i++) {
        const t = (i / (numPoints - 1)) * Math.PI * 2;
        const x = centerX + Math.sin(t) * radius;
        const y = centerY + Math.sin(t * 2) * radius * 0.6;
        points.push({ x: x - objectSize / 2, y: y - objectSize / 2 });
      }
      break;
    }
    case 'wave': {
      // Wave pattern
      for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const x = minX + (maxX - minX) * t;
        const y = minY + (maxY - minY) * (0.4 + 0.3 * Math.sin(t * Math.PI * 3));
        points.push({ x: x - objectSize / 2, y: y - objectSize / 2 });
      }
      break;
    }
    case 'random':
    default: {
      // Random path with collision avoidance
      for (let i = 0; i < numPoints; i++) {
        let attempts = 0;
        let x: number, y: number;
        do {
          x = minX + Math.random() * (maxX - minX);
          y = minY + Math.random() * (maxY - minY);
          attempts++;
        } while (
          attempts < 20 &&
          points.some(p => {
            const distance = Math.sqrt(Math.pow(x - (p.x + objectSize / 2), 2) + Math.pow(y - (p.y + objectSize / 2), 2));
            return distance < MIN_DISTANCE_BETWEEN_OBJECTS;
          })
        );
        points.push({ x: x - objectSize / 2, y: y - objectSize / 2 });
      }
      break;
    }
  }
  
  return points;
};

export const MovingTargetWithExtraObjectsGame: React.FC<Props> = ({
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
  const [distractions, setDistractions] = useState<{ id: number; emoji: string; color: string[]; name: string }[]>([]);
  const [canTap, setCanTap] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [distractionTaps, setDistractionTaps] = useState(0);
  const [missedTaps, setMissedTaps] = useState(0);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [particlePosition, setParticlePosition] = useState({ x: 0, y: 0 });
  
  // Animations - Target
  const targetX = useRef(new Animated.Value(0)).current;
  const targetY = useRef(new Animated.Value(0)).current;
  const targetScale = useRef(new Animated.Value(0)).current;
  const targetOpacity = useRef(new Animated.Value(0)).current;
  const targetRotation = useRef(new Animated.Value(0)).current;
  const targetPulse = useRef(new Animated.Value(1)).current;
  const targetGlow = useRef(new Animated.Value(1)).current;
  const targetGlowOpacity = useRef(new Animated.Value(0)).current;
  
  // Animations - Distractions
  const distraction1X = useRef(new Animated.Value(0)).current;
  const distraction1Y = useRef(new Animated.Value(0)).current;
  const distraction1Scale = useRef(new Animated.Value(0)).current;
  const distraction1Opacity = useRef(new Animated.Value(0)).current;
  const distraction1Rotation = useRef(new Animated.Value(0)).current;
  
  const distraction2X = useRef(new Animated.Value(0)).current;
  const distraction2Y = useRef(new Animated.Value(0)).current;
  const distraction2Scale = useRef(new Animated.Value(0)).current;
  const distraction2Opacity = useRef(new Animated.Value(0)).current;
  const distraction2Rotation = useRef(new Animated.Value(0)).current;
  
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
  const movementTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const targetAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const distraction1AnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const distraction2AnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const startRoundRef = useRef<() => void>(undefined);
  const advanceToNextRoundRef = useRef<(nextRound: number) => void>(undefined);
  const pulseAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const glowAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  const finishGame = useCallback(async () => {
    if (movementTimeoutRef.current) {
      clearTimeout(movementTimeoutRef.current);
      movementTimeoutRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (targetAnimationRef.current) {
      targetAnimationRef.current.stop();
      targetAnimationRef.current = null;
    }
    if (distraction1AnimationRef.current) {
      distraction1AnimationRef.current.stop();
      distraction1AnimationRef.current = null;
    }
    if (distraction2AnimationRef.current) {
      distraction2AnimationRef.current.stop();
      distraction2AnimationRef.current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    if (glowAnimationRef.current) {
      glowAnimationRef.current.stop();
      glowAnimationRef.current = null;
    }
    
    setGameFinished(true);
    setShowRoundSuccess(false); // Clear animation when game finishes
    clearScheduledSpeech();

    const totalAttempts = correctTaps + distractionTaps + missedTaps;
    const accuracy = totalAttempts > 0 ? (correctTaps / totalAttempts) * 100 : 100;
    const xp = correctTaps * 44;

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
        type: 'moving-target-with-extra-objects',
        correct: correctTaps,
        total: totalAttempts || requiredRounds,
        accuracy,
        xpAwarded: xp,
        mode: 'therapy',
        skillTags: ['selective-attention', 'visual-filtering', 'game-based-learning', 'real-life-skills'],
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

  const createMovementAnimation = useCallback((
    xAnim: Animated.Value,
    yAnim: Animated.Value,
    path: MovementPath,
    duration: number
  ): Animated.CompositeAnimation => {
    if (path.length < 2) {
      // Return a no-op animation if path is too short
      return Animated.sequence([]);
    }
    
    // Set initial position
    xAnim.setValue(path[0].x);
    yAnim.setValue(path[0].y);
    
    // Create animations for each segment
    const animations = path.slice(1).map((point, i) => {
      return Animated.parallel([
        Animated.timing(xAnim, {
          toValue: point.x,
          duration: duration / (path.length - 1),
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(yAnim, {
          toValue: point.y,
          duration: duration / (path.length - 1),
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]);
    });
    
    // Loop back to start
    const loopAnimation = Animated.sequence([
      ...animations,
      Animated.parallel([
        Animated.timing(xAnim, {
          toValue: path[0].x,
          duration: duration / (path.length - 1),
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(yAnim, {
          toValue: path[0].y,
          duration: duration / (path.length - 1),
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    ]);
    
    return Animated.loop(loopAnimation);
  }, []);

  const startRound = useCallback(() => {
    // Clear timeouts and animations
    if (movementTimeoutRef.current) {
      clearTimeout(movementTimeoutRef.current);
      movementTimeoutRef.current = null;
    }
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (targetAnimationRef.current) {
      targetAnimationRef.current.stop();
      targetAnimationRef.current = null;
    }
    if (distraction1AnimationRef.current) {
      distraction1AnimationRef.current.stop();
      distraction1AnimationRef.current = null;
    }
    if (distraction2AnimationRef.current) {
      distraction2AnimationRef.current.stop();
      distraction2AnimationRef.current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    if (glowAnimationRef.current) {
      glowAnimationRef.current.stop();
      glowAnimationRef.current = null;
    }

    if (rounds >= requiredRounds) {
      return;
    }

    // Reset state
    setIsProcessing(false);
    setCanTap(false);
    
    // Select random target and distractions
    const randomTarget = TARGETS[Math.floor(Math.random() * TARGETS.length)];
    const shuffled = [...DISTRACTIONS].sort(() => Math.random() - 0.5);
    const selectedDistractions = shuffled.slice(0, 2).map((dist, idx) => ({
      id: idx,
      emoji: dist.emoji,
      color: dist.color,
      name: dist.name,
    }));
    
    setTarget(randomTarget);
    setDistractions(selectedDistractions);

    // Generate movement paths with different patterns
    const pathTypes: ('smooth' | 'zigzag' | 'circular' | 'figure8' | 'wave' | 'random')[] = 
      ['smooth', 'zigzag', 'circular', 'figure8', 'wave', 'random'];
    
    const targetPathType = pathTypes[Math.floor(Math.random() * pathTypes.length)];
    const targetPath = generateMovementPath(SCREEN_WIDTH, SCREEN_HEIGHT, TARGET_SIZE, targetPathType);
    
    // Generate distraction paths that avoid target path
    let dist1Path: MovementPath;
    let dist2Path: MovementPath;
    let attempts = 0;
    
    do {
      const dist1PathType = pathTypes[Math.floor(Math.random() * pathTypes.length)];
      const dist2PathType = pathTypes[Math.floor(Math.random() * pathTypes.length)];
      dist1Path = generateMovementPath(SCREEN_WIDTH, SCREEN_HEIGHT, DISTRACTION_SIZE, dist1PathType);
      dist2Path = generateMovementPath(SCREEN_WIDTH, SCREEN_HEIGHT, DISTRACTION_SIZE, dist2PathType);
      attempts++;
    } while (
      attempts < 10 &&
      (targetPath.some(tp => 
        dist1Path.some(dp => {
          const distance = Math.sqrt(
            Math.pow((tp.x + TARGET_SIZE / 2) - (dp.x + DISTRACTION_SIZE / 2), 2) +
            Math.pow((tp.y + TARGET_SIZE / 2) - (dp.y + DISTRACTION_SIZE / 2), 2)
          );
          return distance < MIN_DISTANCE_BETWEEN_OBJECTS;
        })
      ) ||
      targetPath.some(tp => 
        dist2Path.some(dp => {
          const distance = Math.sqrt(
            Math.pow((tp.x + TARGET_SIZE / 2) - (dp.x + DISTRACTION_SIZE / 2), 2) +
            Math.pow((tp.y + TARGET_SIZE / 2) - (dp.y + DISTRACTION_SIZE / 2), 2)
          );
          return distance < MIN_DISTANCE_BETWEEN_OBJECTS;
        })
      ))
    );

    // Reset animations
    targetScale.setValue(0);
    targetOpacity.setValue(0);
    targetRotation.setValue(0);
    targetPulse.setValue(1);
    targetGlow.setValue(1);
    targetGlowOpacity.setValue(0);
    
    distraction1Scale.setValue(0);
    distraction1Opacity.setValue(0);
    distraction1Rotation.setValue(0);
    
    distraction2Scale.setValue(0);
    distraction2Opacity.setValue(0);
    distraction2Rotation.setValue(0);
    
    celebrationScale.setValue(1);
    celebrationOpacity.setValue(0);
    warningScale.setValue(1);
    warningOpacity.setValue(0);
    particleOpacity.setValue(0);

    // Show all objects with spring animation
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
      Animated.spring(distraction1Scale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(distraction1Opacity, {
        toValue: 0.75,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.spring(distraction2Scale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(distraction2Opacity, {
        toValue: 0.75,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();

    // Start pulsing animation for target
    pulseAnimationRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(targetPulse, {
          toValue: 1.1,
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

    // Start glow animation for target
    glowAnimationRef.current = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(targetGlow, {
            toValue: 1.2,
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(targetGlowOpacity, {
            toValue: 0.5,
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
    );
    glowAnimationRef.current.start();

    speak(`Tap the ${randomTarget.name} only!`);

    // Allow tapping
    setCanTap(true);

    // Create and start movement animations
    const targetDuration = MOVEMENT_DURATION_MS + (Math.random() * 2000 - 1000); // Vary speed slightly
    const dist1Duration = MOVEMENT_DURATION_MS + (Math.random() * 2000 - 1000);
    const dist2Duration = MOVEMENT_DURATION_MS + (Math.random() * 2000 - 1000);
    
    targetAnimationRef.current = createMovementAnimation(targetX, targetY, targetPath, targetDuration);
    targetAnimationRef.current.start();
    
    distraction1AnimationRef.current = createMovementAnimation(distraction1X, distraction1Y, dist1Path, dist1Duration);
    distraction1AnimationRef.current.start();
    
    distraction2AnimationRef.current = createMovementAnimation(distraction2X, distraction2Y, dist2Path, dist2Duration);
    distraction2AnimationRef.current.start();

    // Continuous rotation for all objects
    Animated.loop(
      Animated.timing(targetRotation, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    Animated.loop(
      Animated.timing(distraction1Rotation, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    Animated.loop(
      Animated.timing(distraction2Rotation, {
        toValue: 1,
        duration: 1800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

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
        Animated.timing(distraction1Opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(distraction2Opacity, {
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
  }, [rounds, requiredRounds, SCREEN_WIDTH, SCREEN_HEIGHT, createMovementAnimation]);

  const handleTargetTap = useCallback(() => {
    if (isProcessing || !canTap) return;

    setIsProcessing(true);

    // Clear timeout
    if (tapTimeoutRef.current) {
      clearTimeout(tapTimeoutRef.current);
      tapTimeoutRef.current = null;
    }
    if (targetAnimationRef.current) {
      targetAnimationRef.current.stop();
      targetAnimationRef.current = null;
    }
    if (pulseAnimationRef.current) {
      pulseAnimationRef.current.stop();
      pulseAnimationRef.current = null;
    }
    if (glowAnimationRef.current) {
      glowAnimationRef.current.stop();
      glowAnimationRef.current = null;
    }

    // Correct tap
    setCorrectTaps(prev => prev + 1);
    setCanTap(false);

    // Get current target position for particles (read current values)
    const currentX = (targetX as any)._value || 0;
    const currentY = (targetY as any)._value || 0;
    setParticlePosition({ x: currentX + TARGET_SIZE / 2, y: currentY + TARGET_SIZE / 2 });

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Celebration with particles
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
        Animated.timing(distraction1Opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(distraction2Opacity, {
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

  const handleDistractionTap = useCallback((distractionId: number) => {
    if (isProcessing || !canTap) return;

    // Distraction tap
    setDistractionTaps(prev => prev + 1);

    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {}

    const distScale = distractionId === 0 ? distraction1Scale : distraction2Scale;

    // Warning
    Animated.parallel([
      Animated.sequence([
        Animated.timing(distScale, {
          toValue: 0.8,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(distScale, {
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

    speak(`Tap the ${target?.name}!`);

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
  }, [isProcessing, canTap, target, distraction1Scale, distraction2Scale]);

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
      speak('Tap the moving target, ignore the other objects!');
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
      if (targetAnimationRef.current) {
        targetAnimationRef.current.stop();
      }
      if (distraction1AnimationRef.current) {
        distraction1AnimationRef.current.stop();
      }
      if (distraction2AnimationRef.current) {
        distraction2AnimationRef.current.stop();
      }
      if (pulseAnimationRef.current) {
        pulseAnimationRef.current.stop();
      }
      if (glowAnimationRef.current) {
        glowAnimationRef.current.stop();
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

  const targetRot = targetRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const dist1Rot = distraction1Rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const dist2Rot = distraction2Rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const targetPulseScale = Animated.multiply(targetScale, targetPulse);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
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
            <Text style={styles.title}>Moving Target + Distractions</Text>
            <Text style={styles.subtitle}>
              {canTap ? `Tap the ${target.name} only!` : 'Get ready...'}
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
                left: targetX,
                top: targetY,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.target,
                {
                  transform: [
                    { scale: targetPulseScale },
                    { rotate: targetRot },
                  ],
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
            </Animated.View>
          </Pressable>

          {/* Distraction 1 */}
          {distractions[0] && (
            <Pressable
              onPress={() => handleDistractionTap(0)}
              disabled={!canTap || isProcessing}
              style={[
                styles.distractionContainer,
                {
                  left: distraction1X,
                  top: distraction1Y,
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.distraction,
                  {
                    transform: [
                      { scale: distraction1Scale },
                      { rotate: dist1Rot },
                    ],
                    opacity: distraction1Opacity,
                  },
                ]}
              >
                <LinearGradient
                  colors={distractions[0].color as [string, string, ...string[]]}
                  style={styles.distractionGradient}
                >
                  <Text style={styles.distractionEmoji}>{distractions[0].emoji}</Text>
                </LinearGradient>
              </Animated.View>
            </Pressable>
          )}

          {/* Distraction 2 */}
          {distractions[1] && (
            <Pressable
              onPress={() => handleDistractionTap(1)}
              disabled={!canTap || isProcessing}
              style={[
                styles.distractionContainer,
                {
                  left: distraction2X,
                  top: distraction2Y,
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.distraction,
                  {
                    transform: [
                      { scale: distraction2Scale },
                      { rotate: dist2Rot },
                    ],
                    opacity: distraction2Opacity,
                  },
                ]}
              >
                <LinearGradient
                  colors={distractions[1].color as [string, string, ...string[]]}
                  style={styles.distractionGradient}
                >
                  <Text style={styles.distractionEmoji}>{distractions[1].emoji}</Text>
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
            {[...Array(12)].map((_, i) => {
              const angle = (i * 30) * (Math.PI / 180);
              const distance = 100;
              return (
                <View
                  key={i}
                  style={[
                    styles.particle,
                    {
                      left: particlePosition.x,
                      top: particlePosition.y,
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
            <Text style={styles.skillText}>Visual Filtering</Text>
          </View>
          <View style={styles.skillItem}>
            <Ionicons name="game-controller" size={20} color="#0F172A" />
            <Text style={styles.skillText}>Game Learning</Text>
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
    width: TARGET_SIZE + 50,
    height: TARGET_SIZE + 50,
    borderRadius: (TARGET_SIZE + 50) / 2,
    backgroundColor: '#3B82F6',
    top: -25,
    left: -25,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 30,
  },
  targetGradient: {
    width: '100%',
    height: '100%',
    borderRadius: TARGET_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 20,
    borderWidth: 6,
    borderColor: '#FFFFFF',
    zIndex: 1,
  },
  targetEmoji: {
    fontSize: 80,
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
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  distractionEmoji: {
    fontSize: 60,
  },
  celebration: {
    position: 'absolute',
    top: '30%',
    alignItems: 'center',
  },
  celebrationText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#3B82F6',
    textShadowColor: 'rgba(59, 130, 246, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  particles: {
    position: 'absolute',
    width: 0,
    height: 0,
    zIndex: 12,
    pointerEvents: 'none',
  },
  particle: {
    position: 'absolute',
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -14,
    marginTop: -14,
  },
  particleEmoji: {
    fontSize: 24,
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
