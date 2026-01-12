import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
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
    withTiming
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const GOAL_SOUND = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const TOTAL_ROUNDS = 10;
const SLOW_SPEED = 2; // pixels per tap (slow movement)
const FAST_SPEED = 8; // pixels per tap (fast movement)
const GOAL_DISTANCE = 300; // pixels to reach goal
const SLOW_ROUNDS = 5; // First 5 rounds are slow
const FAST_ROUNDS = 5; // Last 5 rounds are fast

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

const RaceTheDotGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playGoal = useSoundEffect(GOAL_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [dotPosition, setDotPosition] = useState(0); // Position along path (0 to GOAL_DISTANCE)
  const [isFastMode, setIsFastMode] = useState(false);
  const [showGoal, setShowGoal] = useState(false);

  // Animation values
  const dotX = useSharedValue(50); // Start at 50% of screen width
  const dotY = useSharedValue(50); // Start at 50% of screen height
  const pathProgress = useSharedValue(0); // 0 to 1 (0% to 100% of path)
  const dotScale = useSharedValue(1);
  const dotOpacity = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const goalScale = useSharedValue(1);

  // Determine if current round is fast mode
  useEffect(() => {
    setIsFastMode(round > SLOW_ROUNDS);
  }, [round]);

  // Start a new round
  const startRound = useCallback(() => {
    setRoundActive(true);
    setDotPosition(0);
    setShowGoal(false);
    pathProgress.value = 0;
    dotScale.value = 1;
    dotOpacity.value = 1;
    goalScale.value = 1;

    // Reset dot position to start
    dotX.value = 50; // Start at left side (50% - will be adjusted)
    dotY.value = 50;

    // Animate goal appearance
    goalScale.value = withSequence(
      withTiming(1.2, { duration: 200, easing: Easing.out(Easing.ease) }),
      withTiming(1, { duration: 200, easing: Easing.in(Easing.ease) }),
    );
    setShowGoal(true);
  }, [isFastMode, pathProgress, dotScale, dotOpacity, dotX, dotY, goalScale]);

  // Handle tap - move dot forward
  const handleTap = useCallback(async () => {
    if (!roundActive || done) return;

    const speed = isFastMode ? FAST_SPEED : SLOW_SPEED;
    const newPosition = Math.min(dotPosition + speed, GOAL_DISTANCE);
    setDotPosition(newPosition);

    // Update progress (0 to 1)
    const progress = newPosition / GOAL_DISTANCE;
    pathProgress.value = withTiming(progress, {
      duration: 100,
      easing: Easing.out(Easing.ease),
    });

    // Move dot along path (simple horizontal path for now)
    // Start at 20% of screen, move to 80%
    const startX = 20;
    const endX = 80;
    const currentX = startX + (endX - startX) * progress;
    dotX.value = withTiming(currentX, {
      duration: 100,
      easing: Easing.out(Easing.ease),
    });

    // Tap animation
    dotScale.value = withSequence(
      withTiming(1.3, { duration: 100, easing: Easing.out(Easing.ease) }),
      withTiming(1, { duration: 100, easing: Easing.in(Easing.ease) }),
    );

    // Check if reached goal
    if (newPosition >= GOAL_DISTANCE) {
      setRoundActive(false);
      setShowGoal(false);

      // Record tap position for sparkle
      sparkleX.value = dotX.value;
      sparkleY.value = dotY.value;

      // Success animation
      dotScale.value = withSequence(
        withTiming(1.5, { duration: 200, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 300, easing: Easing.in(Easing.ease) }, () => {
          runOnJS(setScore)((s) => s + 1);
          runOnJS(setRoundActive)(false);

          if (round >= TOTAL_ROUNDS) {
            runOnJS(endGame)(score + 1);
          } else {
            runOnJS(setRound)((r) => r + 1);
            setTimeout(() => {
              runOnJS(startRound)();
            }, 1000);
          }
        }),
      );

      dotOpacity.value = withTiming(0, { duration: 300 });

      try {
        await playGoal();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } else {
      try {
        await playSuccess();
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
    }
  }, [roundActive, done, dotPosition, isFastMode, round, score, pathProgress, dotScale, dotOpacity, dotX, dotY, sparkleX, sparkleY, playSuccess, playGoal, startRound]);

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 15; // 15 XP per successful round
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'raceTheDot',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['visual-tracking', 'speed-modulation', 'motor-planning', 'timing'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log race the dot game:', e);
      }

      Speech.speak('Great racing!', { rate: 0.78 });
    },
    [router],
  );

  // Initialize first round
  useEffect(() => {
    try {
      Speech.speak(isFastMode ? 'Tap fast repeatedly to race the dot to the goal!' : 'Tap to keep the dot moving slowly toward the goal!', { rate: 0.78 });
    } catch {}
    startRound();
  }, []);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const dotStyle = useAnimatedStyle(() => ({
    left: `${dotX.value}%`,
    top: `${dotY.value}%`,
    transform: [
      { translateX: -15 },
      { translateY: -15 },
      { scale: dotScale.value },
    ],
    opacity: dotOpacity.value,
  }));

  const pathStyle = useAnimatedStyle(() => ({
    width: `${pathProgress.value * 100}%`,
  }));

  const goalStyle = useAnimatedStyle(() => ({
    transform: [{ scale: goalScale.value }],
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
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <View style={styles.resultCard}>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🏁</Text>
            <Text style={styles.resultTitle}>Race complete!</Text>
            <Text style={styles.resultSubtitle}>
              You reached the goal {finalStats.correct} out of {finalStats.total} times!
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                startRound();
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Race The Dot</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🏁 Score: {score}
        </Text>
        <Text style={styles.helper}>
          {isFastMode
            ? 'Tap fast repeatedly to race the dot to the goal!'
            : 'Tap to keep the dot moving slowly toward the goal!'}
        </Text>
      </View>

      <View style={styles.playArea}>
        <Pressable onPress={handleTap} style={styles.tapArea} disabled={!roundActive || done}>
          {/* Visual path */}
          <View style={styles.pathContainer}>
            <Animated.View style={[styles.path, pathStyle]} />
          </View>

          {/* Goal indicator */}
          {showGoal && (
            <Animated.View style={[styles.goalContainer, goalStyle]}>
              <View style={styles.goal}>
                <Text style={styles.goalText}>🏁</Text>
                <Text style={styles.goalLabel}>GOAL</Text>
              </View>
            </Animated.View>
          )}

          {/* Dot */}
          <Animated.View style={[styles.dotContainer, dotStyle]}>
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: isFastMode ? '#F59E0B' : '#3B82F6',
                },
              ]}
            >
              <View style={styles.dotInner} />
            </View>
          </Animated.View>

          {/* Sparkle burst on goal */}
          {score > 0 && !roundActive && (
            <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
              <SparkleBurst />
            </Animated.View>
          )}

          {/* Progress indicator */}
          <View style={styles.progressContainer}>
            <Text style={styles.progressText}>
              {Math.round((dotPosition / GOAL_DISTANCE) * 100)}% to goal
            </Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: visual tracking • speed modulation • motor planning • timing
        </Text>
        <Text style={styles.footerSub}>
          {isFastMode
            ? 'Tap fast to race! This builds speed control and motor planning.'
            : 'Tap to keep moving! This builds visual tracking and timing.'}
        </Text>
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
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    position: 'relative',
    marginBottom: 16,
  },
  tapArea: {
    flex: 1,
    position: 'relative',
  },
  pathContainer: {
    position: 'absolute',
    top: '50%',
    left: '10%',
    right: '10%',
    height: 8,
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  path: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 4,
  },
  goalContainer: {
    position: 'absolute',
    top: '50%',
    right: '10%',
    transform: [{ translateX: -30 }, { translateY: -30 }],
  },
  goal: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#22C55E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  goalText: {
    fontSize: 28,
  },
  goalLabel: {
    position: 'absolute',
    bottom: -20,
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  dotContainer: {
    position: 'absolute',
  },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  dotInner: {
    width: '50%',
    height: '50%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
  },
  progressContainer: {
    position: 'absolute',
    top: '30%',
    left: '50%',
    transform: [{ translateX: -60 }],
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  progressText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  resultTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 16,
    textAlign: 'center',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default RaceTheDotGame;

