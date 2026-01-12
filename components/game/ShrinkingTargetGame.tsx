import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withTiming,
} from 'react-native-reanimated';

const POP_SOUND = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const TOTAL_TARGETS = 12; // Total targets to tap
const INITIAL_SIZE = 140; // Starting size (medium)
const MIN_SIZE = 50; // Smallest size
const MAX_SIZE = 180; // Largest size (if struggling)
const SIZE_DECREASE = 12; // How much to decrease each time
const SIZE_INCREASE = 15; // How much to increase if struggling
const MISS_THRESHOLD = 2; // Number of misses before increasing size

const usePopSound = () => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri: POP_SOUND },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load pop sound');
    }
  }, []);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      await ensureSound();
      if (soundRef.current) {
        await soundRef.current.replayAsync();
      }
    } catch {}
  }, [ensureSound]);

  return play;
};

const ShrinkingTargetGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playPop = usePopSound();

  const [score, setScore] = useState(0);
  const [currentSize, setCurrentSize] = useState(INITIAL_SIZE);
  const [missCount, setMissCount] = useState(0); // Track consecutive misses
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [targetPosition, setTargetPosition] = useState({ x: 50, y: 50 }); // percentage

  // Animation values
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#F472B6', '#06B6D4', '#EC4899'];

  // Generate random position for target - ensures target stays within bounds
  const generateRandomPosition = useCallback(() => {
    // Calculate safe margin as percentage based on target size
    // We need margin = (target radius + padding) as percentage
    // Since we translate by -currentSize/2, we need at least currentSize/2 + padding margin
    // Using a conservative approach: ensure at least 25% margin from edges
    // This accounts for the largest target size (180px) and ensures it never goes outside
    const minMargin = 25; // Minimum 25% margin from edges
    
    // For larger targets, increase margin proportionally
    const sizeBasedMargin = Math.max(minMargin, (currentSize / 4) + 15); // Scale margin with size
    const safeMargin = Math.min(sizeBasedMargin, 35); // Cap at 35% to keep target visible
    
    // Generate position within safe bounds
    const x = safeMargin + Math.random() * (100 - safeMargin * 2);
    const y = safeMargin + Math.random() * (100 - safeMargin * 2);
    
    // Additional safety: clamp to 20-80% range to ensure target is always fully visible
    const clampedX = Math.max(20, Math.min(80, x));
    const clampedY = Math.max(20, Math.min(80, y));
    
    return { x: clampedX, y: clampedY };
  }, [currentSize]);

  // Spawn new target
  const spawnTarget = useCallback(() => {
    const newPosition = generateRandomPosition();
    setTargetPosition(newPosition);
    scale.value = 0;
    opacity.value = 0;

    // Animate in
    scale.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.ease) });
    opacity.value = withTiming(1, { duration: 300 });
  }, [generateRandomPosition, scale, opacity]);

  // End game - defined before handleTap to avoid initialization error
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_TARGETS;
      const xp = finalScore * 12; // 12 XP per target
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'shrinkingTarget',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['graded-motor-control', 'progressive-precision', 'adaptability'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log shrinking target game:', e);
      }

      Speech.speak('Excellent precision!', { rate: 0.78 });
    },
    [router],
  );

  // Handle target tap
  const handleTap = useCallback(async () => {
    if (done) return;

    // Record tap position for sparkle
    sparkleX.value = targetPosition.x;
    sparkleY.value = targetPosition.y;

    // Pop animation
    scale.value = withSequence(
      withTiming(1.3, { duration: 120, easing: Easing.out(Easing.ease) }),
      withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) }, () => {
        runOnJS(setScore)((s) => s + 1);
        runOnJS(setMissCount)(0); // Reset miss count on success

        if (score + 1 >= TOTAL_TARGETS) {
          runOnJS(endGame)(score + 1);
        } else {
          // Decrease size for next target (progressive difficulty)
          runOnJS(setCurrentSize)((s) => Math.max(MIN_SIZE, s - SIZE_DECREASE));
          runOnJS(spawnTarget)();
        }
      }),
    );

    opacity.value = withTiming(0, { duration: 200 });

    try {
      await playPop();
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {}

    // Show sparkle burst
    setTimeout(() => {
      scale.value = 1;
      opacity.value = 1;
    }, 400);
  }, [done, score, targetPosition, scale, opacity, sparkleX, sparkleY, playPop, spawnTarget, endGame]);

  // Handle miss (tap outside target)
  const handleMiss = useCallback(() => {
    if (done) return;

    setMissCount((m) => {
      const newMissCount = m + 1;

      // If struggling (multiple misses), increase target size
      if (newMissCount >= MISS_THRESHOLD) {
        setCurrentSize((s) => Math.min(MAX_SIZE, s + SIZE_INCREASE));
        setMissCount(0); // Reset after adapting
        Speech.speak('Target is bigger now!', { rate: 0.78 });
      }

      return newMissCount;
    });

    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch {}
  }, [done]);

  // Initialize first target
  useEffect(() => {
    try {
      Speech.speak('Tap the target! It gets smaller each time. If you struggle, it grows bigger to help you.', { rate: 0.78 });
    } catch {}
    spawnTarget();
    
    // Cleanup: Stop speech when component unmounts
    return () => {
      try {
        Speech.stop();
      } catch (e) {
        // Ignore errors
      }
      stopAllSpeech();
      cleanupSounds();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  const handleBack = useCallback(() => {
    try {
      Speech.stop();
    } catch (e) {
      // Ignore errors
    }
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const targetStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  // Result screen
  if (done && finalStats) {
    const accuracyPct = Math.round((finalStats.correct / finalStats.total) * 100);
    return (
      <SafeAreaView style={styles.container}>
        <LinearGradient
          colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.resultContainer}>
          <ResultCard
            correct={finalStats.correct}
            total={finalStats.total}
            xpAwarded={finalStats.xp}
            accuracy={accuracyPct}
            logTimestamp={logTimestamp}
            onHome={() => {
              stopAllSpeech();
              cleanupSounds();
              onBack?.();
            }}
            onPlayAgain={() => {
              setScore(0);
              setCurrentSize(INITIAL_SIZE);
              setMissCount(0);
              setDone(false);
              setFinalStats(null);
              setLogTimestamp(null);
              spawnTarget();
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const currentColor = COLORS[score % COLORS.length];
  const sizePercentage = ((currentSize / INITIAL_SIZE) * 100).toFixed(0);

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
        style={StyleSheet.absoluteFillObject}
      />
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <LinearGradient
          colors={['#1E293B', '#0F172A']}
          style={styles.backChipGradient}
        >
          <Text style={styles.backChipText}>← Back</Text>
        </LinearGradient>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>🎯 Shrinking Target 🎯</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBadge}>
            <Text style={styles.statLabel}>Target</Text>
            <Text style={styles.statValue}>{score + 1}/{TOTAL_TARGETS}</Text>
          </View>
          <View style={[styles.statBadge, styles.statBadgeAccent]}>
            <Text style={styles.statLabel}>Size</Text>
            <Text style={styles.statValue}>{sizePercentage}%</Text>
          </View>
        </View>
        <Text style={styles.helper}>
          Tap the target! It gets smaller each time. If you struggle, it grows bigger to help you. ✨
        </Text>
      </View>

      <View style={styles.playArea}>
        <LinearGradient
          colors={['#F0FDF4', '#DCFCE7', '#BBF7D0']}
          style={StyleSheet.absoluteFillObject}
        />
        <Pressable style={StyleSheet.absoluteFillObject} onPress={handleMiss}>
          <Animated.View
            style={[
              styles.targetContainer,
              {
                left: `${targetPosition.x}%`,
                top: `${targetPosition.y}%`,
                transform: [{ translateX: -currentSize / 2 }, { translateY: -currentSize / 2 }],
              },
              targetStyle,
            ]}
          >
            <Pressable
              onPress={handleTap}
              style={styles.targetPressable}
            >
              <LinearGradient
                colors={[currentColor, `${currentColor}DD`, `${currentColor}AA`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.target,
                  {
                    width: currentSize,
                    height: currentSize,
                    borderRadius: currentSize / 2,
                  },
                ]}
              >
                <View style={styles.targetInner} />
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </Pressable>

        {/* Sparkle burst on tap */}
        {score > 0 && (
          <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
            <SparkleBurst />
          </Animated.View>
        )}
      </View>

      <View style={styles.footerBox}>
        <LinearGradient
          colors={['#FFFFFF', '#FEF3C7']}
          style={styles.footerGradient}
        >
          <Text style={styles.footerMain}>
            Skills: graded motor control • progressive finger precision • adaptability
          </Text>
          <Text style={styles.footerSub}>
            The target shrinks as you succeed, building precision. If you miss, it grows to help you!
          </Text>
        </LinearGradient>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  backChipGradient: {
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#78350F',
    marginBottom: 12,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 18,
    alignItems: 'center',
    minWidth: 100,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  statBadgeAccent: {
    backgroundColor: '#FEF3C7',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 15,
    color: '#92400E',
    textAlign: 'center',
    paddingHorizontal: 18,
    fontWeight: '600',
  },
  playArea: {
    flex: 1,
    position: 'relative',
    marginBottom: 16,
    borderRadius: 24,
    overflow: 'hidden',
    marginHorizontal: 8,
    borderWidth: 3,
    borderColor: '#A7F3D0',
  },
  targetContainer: {
    position: 'absolute',
  },
  targetPressable: {
    overflow: 'hidden',
  },
  target: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  targetInner: {
    width: '40%',
    height: '40%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    shadowColor: '#fff',
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
  },
  footerBox: {
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  footerGradient: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  footerMain: {
    fontSize: 15,
    fontWeight: '800',
    color: '#78350F',
    textAlign: 'center',
    marginBottom: 6,
  },
  footerSub: {
    fontSize: 13,
    color: '#92400E',
    textAlign: 'center',
    fontWeight: '500',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    padding: 32,
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  resultTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#78350F',
    marginBottom: 12,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  resultSubtitle: {
    fontSize: 18,
    color: '#64748B',
    marginBottom: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
    fontSize: 15,
  },
  resultContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
});

export default ShrinkingTargetGame;

