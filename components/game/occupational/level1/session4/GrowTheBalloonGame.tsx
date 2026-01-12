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
    useAnimatedStyle,
    useSharedValue,
    withTiming
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const FLOAT_SOUND = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const TOTAL_ROUNDS = 8;
const INFLATE_DURATION_MS = 2000; // 2 seconds to fully inflate
const MIN_SIZE_FOR_REWARD = 0.7; // 70% size needed for reward

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

const GrowTheBalloonGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playFloat = useSoundEffect(FLOAT_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);

  // Initial speech on mount
  useEffect(() => {
    try {
      Speech.speak('Press and hold to inflate the balloon. Release when it\'s big to make it float!', { rate: 0.78 });
    } catch {}
  }, []);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const [inflateProgress, setInflateProgress] = useState(0);
  const [isFloating, setIsFloating] = useState(false);
  const [roundActive, setRoundActive] = useState(true);

  // Animation values
  const balloonScale = useSharedValue(0.3); // Start small
  const balloonY = useSharedValue(50); // Start at 50% from top
  const balloonOpacity = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPressedRef = useRef(false);
  const isFloatingRef = useRef(false);

  // Handle press start
  const handlePressIn = useCallback(() => {
    if (!roundActive || done || isFloatingRef.current) return;

    setIsPressed(true);
    isPressedRef.current = true;
    setInflateProgress(0);
    balloonScale.value = 0.3;
    balloonY.value = 50;

    // Start inflating
    const startTime = Date.now();
    const updateProgress = () => {
      if (!isPressedRef.current || isFloatingRef.current) return;
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / INFLATE_DURATION_MS, 1);
      setInflateProgress(progress);

      // Scale balloon from 0.3 to 1.0
      const scale = 0.3 + (progress * 0.7);
      balloonScale.value = withTiming(scale, {
        duration: 50,
        easing: Easing.out(Easing.ease),
      });

      if (progress < 1) {
        progressTimerRef.current = setTimeout(updateProgress, 50);
      }
    };

    updateProgress();
  }, [roundActive, done, balloonScale, balloonY]);

  // Handle release
  const handlePressOut = useCallback(async () => {
    if (!isPressedRef.current || isFloatingRef.current) return;

    setIsPressed(false);
    isPressedRef.current = false;
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    const finalSize = inflateProgress;
    const gotReward = finalSize >= MIN_SIZE_FOR_REWARD;

    if (gotReward) {
      // Big balloon - float up!
      setIsFloating(true);
      isFloatingRef.current = true;
      balloonY.value = withTiming(-20, {
        duration: 2000,
        easing: Easing.out(Easing.ease),
      });
      balloonOpacity.value = withTiming(0, {
        duration: 2000,
        easing: Easing.in(Easing.ease),
      });

      // Record position for sparkle
      sparkleX.value = 50;
      sparkleY.value = 30;

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 2500);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            setInflateProgress(0);
            setIsFloating(false);
            isFloatingRef.current = false;
            balloonScale.value = 0.3;
            balloonY.value = 50;
            balloonOpacity.value = 1;
            setRoundActive(true);
          }, 2500);
        }
        return newScore;
      });

      try {
        await playFloat();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } else {
      // Tiny balloon - no reward
      balloonScale.value = withTiming(0.3, {
        duration: 300,
        easing: Easing.in(Easing.ease),
      });
      setInflateProgress(0);

      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Speech.speak('Hold longer for a bigger balloon!', { rate: 0.78 });
      } catch {}
    }
  }, [isPressed, isFloating, inflateProgress, balloonScale, balloonY, balloonOpacity, sparkleX, sparkleY, playFloat]);

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18; // 18 XP per successful balloon
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'growTheBalloon',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['visual-motor-mapping', 'finger-endurance', 'graded-force-control'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log grow the balloon game:', e);
      }

      Speech.speak('Amazing balloons!', { rate: 0.78 });
    },
    [router],
  );

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const balloonStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: balloonScale.value },
      { translateY: `${balloonY.value - 50}%` },
    ],
    opacity: balloonOpacity.value,
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🎈</Text>
            <Text style={styles.resultTitle}>Balloon master!</Text>
            <Text style={styles.resultSubtitle}>
              You grew {finalStats.correct} big balloons out of {finalStats.total}!
            </Text>
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
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setInflateProgress(0);
                setIsFloating(false);
                setRoundActive(true);
                balloonScale.value = 0.3;
                balloonY.value = 50;
                balloonOpacity.value = 1;
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
        <Text style={styles.title}>Grow The Balloon</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎈 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Press and hold to inflate the balloon. Release when it's big to make it float!
        </Text>
      </View>

      <View style={styles.playArea}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={styles.tapArea}
          disabled={!roundActive || done || isFloating}
        >
          {/* Balloon */}
          <Animated.View style={[styles.balloonContainer, balloonStyle]}>
            <View
              style={[
                styles.balloon,
                {
                  backgroundColor: inflateProgress > 0.5 ? '#EF4444' : '#F87171',
                },
              ]}
            />
            {/* Balloon string */}
            <View style={styles.balloonString} />
          </Animated.View>

          {/* Sparkle burst on float */}
          {isFloating && (
            <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
              <SparkleBurst />
            </Animated.View>
          )}

          {/* Size indicator */}
          {isPressed && !isFloating && (
            <View style={styles.sizeIndicator}>
              <Text style={styles.sizeText}>
                {Math.round(inflateProgress * 100)}% inflated
              </Text>
            </View>
          )}
        </Pressable>

        {/* Instruction - below button */}
        {!isPressed && !isFloating && (
          <View style={styles.instructionBox}>
            <Text style={styles.instructionText}>
              Press and hold to inflate! 💨
            </Text>
          </View>
        )}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: visual-motor mapping • finger endurance • graded force control
        </Text>
        <Text style={styles.footerSub}>
          Hold longer to make a bigger balloon! This builds finger strength and control.
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
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    position: 'relative',
  },
  tapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  balloonContainer: {
    position: 'absolute',
    alignItems: 'center',
  },
  balloon: {
    width: 120,
    height: 140,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  balloonEmoji: {
    fontSize: 60,
  },
  balloonString: {
    width: 2,
    height: 80,
    backgroundColor: '#64748B',
    marginTop: -10,
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 3,
  },
  sizeIndicator: {
    position: 'absolute',
    top: '60%',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  sizeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  instructionBox: {
    marginTop: 24,
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
    alignSelf: 'center',
  },
  instructionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
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

export default GrowTheBalloonGame;

