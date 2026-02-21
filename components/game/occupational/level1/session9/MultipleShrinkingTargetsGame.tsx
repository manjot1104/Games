import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { SparkleBurst } from '@/components/game/FX';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withTiming,
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const INITIAL_SIZE = 120;
const MIN_SIZE = 40;
const NUM_TARGETS = 3;
const SHRINK_DURATION_FAST = 4000; // Fast shrink - slow and visible
const SHRINK_DURATION_MEDIUM = 5000; // Medium shrink - slow and visible
const SHRINK_DURATION_SLOW = 6000; // Slow shrink - slow and visible
const GLOW_STOP_DELAY = 500; // Delay before correct target stops glowing

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

// Target component for animated rendering
const TargetComponent: React.FC<{
  target: Target;
  onPress: () => void;
  disabled: boolean;
}> = ({ target, onPress, disabled }) => {
  const targetAnimatedStyle = useAnimatedStyle(() => {
    return {
      width: target.size.value,
      height: target.size.value,
      transform: [
        { scale: target.scale.value },
      ],
    };
  });

  const glowAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: Math.max(0.6, target.glow.value), // Higher minimum opacity for more visible glow
      transform: [{ scale: target.glow.value }],
    };
  });

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.targetContainer,
        {
          left: `${target.x}%`,
          top: `${target.y}%`,
        },
      ]}
      disabled={disabled}
    >
      <Animated.View
        style={[
          styles.target,
          targetAnimatedStyle,
          { backgroundColor: '#3B82F6' }, // Same color for all balls
        ]}
      >
        <Animated.View style={[styles.glowRing, glowAnimatedStyle]} />
      </Animated.View>
    </Pressable>
  );
};

type Target = {
  id: string;
  x: number; // percentage
  y: number; // percentage
  size: Animated.SharedValue<number>;
  glow: Animated.SharedValue<number>;
  scale: Animated.SharedValue<number>;
  isCorrect: boolean;
  shrinkDuration: number;
};

const MultipleShrinkingTargetsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [lastResult, setLastResult] = useState<'hit' | 'miss' | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [sparkleKey, setSparkleKey] = useState(0);
  const [sparkleX, setSparkleX] = useState(0);
  const [sparkleY, setSparkleY] = useState(0);
  const [showCongratulations, setShowCongratulations] = useState(false);

  const animationRefs = useRef<any[]>([]);
  const roundActiveRef = useRef(false);
  const roundRef = useRef(1);
  const scoreRef = useRef(0);
  const correctTargetIdRef = useRef<string | null>(null);
  const feedbackOpacity = useSharedValue(0);
  const timeoutRefs = useRef<NodeJS.Timeout[]>([]);

  // Create shared values for targets at component level (reused across rounds)
  const target1Size = useSharedValue(INITIAL_SIZE);
  const target1Glow = useSharedValue(1);
  const target1Scale = useSharedValue(1);
  const target2Size = useSharedValue(INITIAL_SIZE);
  const target2Glow = useSharedValue(1);
  const target2Scale = useSharedValue(1);
  const target3Size = useSharedValue(INITIAL_SIZE);
  const target3Glow = useSharedValue(1);
  const target3Scale = useSharedValue(1);

  // Keep refs in sync
  useEffect(() => {
    roundRef.current = round;
    scoreRef.current = score;
  }, [round, score]);

  // End game function
  const endGame = useCallback(async () => {
    if (done) return;
    setDone(true);
    setRoundActive(false);
    roundActiveRef.current = false;

    animationRefs.current.forEach(ref => ref?.stop());

    const finalScore = scoreRef.current;
    const totalRounds = TOTAL_ROUNDS;
    const xp = Math.floor((finalScore / totalRounds) * 50);

    try {
      const timestamp = await recordGame({
        type: 'multipleShrinkingTargets',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
      });

      await logGameAndAward({
        gameType: 'multipleShrinkingTargets',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
        xp,
      });

      setFinalStats({
        correct: finalScore,
        total: totalRounds,
        xp,
      });
      setLogTimestamp(timestamp);
      setShowCongratulations(true);
      speakTTS('Amazing work! You completed the game!', 0.78);
    } catch (error) {
      console.error('Failed to save game result:', error);
      // Still show congratulations even if logging fails
      setShowCongratulations(true);
      speakTTS('Amazing work! You completed the game!', 0.78);
    }
  }, [done]);

  // Start round ref for handleMiss
  const startRoundRef = useRef<() => void>();

  // Handle miss
  const handleMiss = useCallback(async () => {
    if (!roundActiveRef.current || done) return;

    setLastResult('miss');
    setShowFeedback(true);
    setRoundActive(false);
    roundActiveRef.current = false;

    animationRefs.current.forEach(ref => ref?.stop());

    feedbackOpacity.value = withTiming(1, { duration: 200 });

    try {
      await playError();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speakTTS('Tap the one that stops glowing!', 0.78 );
    } catch {}

    const timeout1 = setTimeout(() => {
      setShowFeedback(false);
      feedbackOpacity.value = 0;
      const timeout2 = setTimeout(() => {
        if (startRoundRef.current) {
          startRoundRef.current();
        }
      }, 500);
      timeoutRefs.current.push(timeout2);
    }, 1500);
    timeoutRefs.current.push(timeout1);
  }, [done, feedbackOpacity, playError]);

  // Start a new round
  const startRound = useCallback(() => {
    if (done) return;

    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    feedbackOpacity.value = 0;
    correctTargetIdRef.current = null;

    // Generate 3 targets at random positions
    const newTargets: Target[] = [];
    const margin = 15;
    const positions: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < NUM_TARGETS; i++) {
      let attempts = 0;
      let validPosition = false;
      let newX = 0;
      let newY = 0;

      while (!validPosition && attempts < 100) {
        newX = margin + Math.random() * (100 - margin * 2);
        newY = margin + Math.random() * (100 - margin * 2);

        validPosition = positions.every((pos) => {
          const dx = newX - pos.x;
          const dy = newY - pos.y;
          return Math.sqrt(dx * dx + dy * dy) > 20; // Minimum distance
        });

        attempts++;
      }

      positions.push({ x: newX, y: newY });

      const shrinkDurations = [SHRINK_DURATION_FAST, SHRINK_DURATION_MEDIUM, SHRINK_DURATION_SLOW];
      const shrinkDuration = shrinkDurations[i % shrinkDurations.length];

      // Use pre-created shared values
      let size, glow, scale;
      if (i === 0) {
        size = target1Size;
        glow = target1Glow;
        scale = target1Scale;
      } else if (i === 1) {
        size = target2Size;
        glow = target2Glow;
        scale = target2Scale;
      } else {
        size = target3Size;
        glow = target3Glow;
        scale = target3Scale;
      }

      // Reset shared values
      size.value = INITIAL_SIZE;
      glow.value = 1;
      scale.value = 1;

      const target: Target = {
        id: `target-${i}`,
        x: newX,
        y: newY,
        size,
        glow,
        scale,
        isCorrect: false,
        shrinkDuration,
      };

      newTargets.push(target);
    }

    // Randomly select one target as correct
    const correctIndex = Math.floor(Math.random() * NUM_TARGETS);
    newTargets[correctIndex].isCorrect = true;
    correctTargetIdRef.current = newTargets[correctIndex].id;

    setTargets(newTargets);

    // Start shrinking animations for all targets
    animationRefs.current = newTargets.map((target, index) => {
      const shrinkAnim = withTiming(
        MIN_SIZE,
        {
          duration: target.shrinkDuration,
          easing: Easing.linear, // Linear for consistent, clearly visible shrinking
        },
        (finished) => {
          if (finished && target.isCorrect && roundActiveRef.current) {
            // Correct target finished shrinking - stop glowing after delay
            runOnJS(() => {
              const glowTimeout = setTimeout(() => {
                if (roundActiveRef.current && correctTargetIdRef.current === target.id) {
                  target.glow.value = withTiming(0, { duration: 300 });
                }
              }, GLOW_STOP_DELAY);
              timeoutRefs.current.push(glowTimeout);
            })();
          }
        }
      );

      target.size.value = shrinkAnim;

      // Glow animation (pulsing) - all targets glow initially with stronger effect
      const glowAnim = withSequence(
        withTiming(1.8, { duration: 500, easing: Easing.inOut(Easing.ease) }), // Increased from 1.2 to 1.8
        withTiming(1.2, { duration: 500, easing: Easing.inOut(Easing.ease) }) // Increased from 0.8 to 1.2
      );
      target.glow.value = glowAnim;

      return { stop: () => {
        target.size.value = withTiming(MIN_SIZE, { duration: 0 });
        target.glow.value = withTiming(0, { duration: 0 });
      }};
    });
  }, [done, feedbackOpacity, handleMiss]);

  // Handle target tap
  const handleTargetTap = useCallback(async (targetId: string, targetX: number, targetY: number) => {
    if (!roundActiveRef.current || done) return;

    if (targetId === correctTargetIdRef.current) {
      // Correct target tapped
      setLastResult('hit');
      setShowFeedback(true);
      setRoundActive(false);
      roundActiveRef.current = false;
      setScore((s) => s + 1);

      animationRefs.current.forEach(ref => ref?.stop());

      // Find target and animate success
      const target = targets.find(t => t.id === targetId);
      if (target) {
        target.scale.value = withSequence(
          withTiming(1.5, { duration: 150, easing: Easing.out(Easing.ease) }),
          withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) })
        );
      }

      feedbackOpacity.value = withTiming(1, { duration: 200 });

      setSparkleX(targetX);
      setSparkleY(targetY);
      setSparkleKey((k) => k + 1);

      try {
        await playSuccess();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        speakTTS('Perfect!', 0.78 );
      } catch {}

      if (roundRef.current >= TOTAL_ROUNDS) {
        const timeout1 = setTimeout(() => {
          endGame();
        }, 1500);
        timeoutRefs.current.push(timeout1);
      } else {
        const timeout1 = setTimeout(() => {
          setShowFeedback(false);
          feedbackOpacity.value = 0;
          setRound((r) => r + 1);
          const timeout2 = setTimeout(() => {
            startRound();
          }, 500);
          timeoutRefs.current.push(timeout2);
        }, 1500);
        timeoutRefs.current.push(timeout1);
      }
    } else {
      // Wrong target tapped
      handleMiss();
    }
  }, [done, targets, playSuccess, endGame, startRound, handleMiss]);

  // Set ref after startRound is defined
  useEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  // Start first round
  useEffect(() => {
    startRound();
    return () => {
      // Clear all timeouts
      timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
      timeoutRefs.current = [];
      // Stop TTS and sounds
      stopAllSpeech();
      cleanupSounds();
      // Stop animations
      animationRefs.current.forEach(ref => ref?.stop());
    };
  }, []);

  // Animated styles
  const feedbackStyle = useAnimatedStyle(() => {
    return {
      opacity: feedbackOpacity.value,
    };
  });

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Tap the shrinking targets!', 0.78 );
      } catch {}
    }
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    // Clear all timeouts
    timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
    timeoutRefs.current = [];
    // Stop animations
    animationRefs.current.forEach(ref => ref?.stop());
    // Stop round activity
    roundActiveRef.current = false;
    setRoundActive(false);
    // Stop TTS and sounds
    stopAllSpeech();
    cleanupSounds();
    if (onBack) {
      onBack();
    } else {
      // Safe fallback: try to go back, but catch errors
      try {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/(tabs)/Games');
        }
      } catch (error) {
        try {
          router.replace('/(tabs)/Games');
        } catch (e) {
          console.warn('Navigation error:', e);
        }
      }
    }
  }, [onBack, router]);

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Discrimination Master!"
        showButtons={true}
        onContinue={() => {
          // Continue - go back to games (no ResultCard screen needed)
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
        onHome={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  // Prevent any rendering when game is done but congratulations hasn't shown yet
  if (done && finalStats && !showCongratulations) {
    return null; // Wait for showCongratulations to be set
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Multiple Shrinking Targets</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.helper}>
          Watch all 3 shapes! Tap the one that stops glowing!
        </Text>
      </View>

      {/* Play area */}
      <View style={styles.playArea}>
        {targets.map((target) => (
          <TargetComponent
            key={target.id}
            target={target}
            onPress={() => handleTargetTap(target.id, target.x, target.y)}
            disabled={!roundActive || done}
          />
        ))}

        {/* Feedback */}
        {showFeedback && lastResult && (
          <Animated.View style={[styles.feedbackContainer, feedbackStyle]}>
            <Text style={[
              styles.feedbackText,
              lastResult === 'hit' ? styles.feedbackSuccess : styles.feedbackError,
            ]}>
              {lastResult === 'hit' ? 'Perfect!' : 'Tap the one that stops glowing!'}
            </Text>
          </Animated.View>
        )}

        {/* Sparkle effect */}
        {sparkleKey > 0 && (
          <SparkleBurst
            key={sparkleKey}
            x={sparkleX}
            y={sparkleY}
          />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F4F8',
  },
  backChip: {
    alignSelf: 'flex-start',
    margin: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  backChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  headerBlock: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748B',
    marginBottom: 8,
  },
  helper: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
  },
  playArea: {
    flex: 1,
    position: 'relative',
    margin: 20,
  },
  targetContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  target: {
    borderRadius: 1000,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: '150%', // Increased from 120% to 150% for larger glow
    height: '150%', // Increased from 120% to 150% for larger glow
    borderRadius: 1000,
    borderWidth: 6, // Increased from 3 to 6 for thicker glow
    borderColor: '#FCD34D',
    shadowColor: '#FCD34D', // Add shadow for extra glow effect
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8, // Strong shadow opacity
    shadowRadius: 10, // Large shadow radius for glow
    elevation: 8, // Android shadow
  },
  feedbackContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -100 }, { translateY: -20 }],
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  feedbackText: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  feedbackSuccess: {
    color: '#22C55E',
  },
  feedbackError: {
    color: '#EF4444',
  },
  scrollContent: {
    padding: 20,
  },
});

export default MultipleShrinkingTargetsGame;

