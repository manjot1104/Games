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
    withSequence,
    withTiming
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const LAUNCH_SOUND = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const TOTAL_ROUNDS = 8;
const FUEL_DURATION_MS = 2000; // 2 seconds to fill fuel bar

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

const LaunchRocketGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playLaunch = useSoundEffect(LAUNCH_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);

  // Initial speech on mount
  useEffect(() => {
    try {
      Speech.speak('Press and hold to fill the fuel bar. Release when full to launch!', { rate: 0.78 });
    } catch {}
  }, []);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const [fuelProgress, setFuelProgress] = useState(0);
  const [isLaunching, setIsLaunching] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [roundActive, setRoundActive] = useState(true);

  // Animation values
  const fuelBarHeight = useSharedValue(0);
  const rocketY = useSharedValue(50); // Start at 50% from top
  const rocketScale = useSharedValue(1);
  const rocketOpacity = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const releaseFlash = useSharedValue(0);

  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPressedRef = useRef(false);
  const isLaunchingRef = useRef(false);

  // Handle press start
  const handlePressIn = useCallback(() => {
    if (!roundActive || done || isLaunchingRef.current) return;

    setIsPressed(true);
    isPressedRef.current = true;
    setFuelProgress(0);
    setShowRelease(false);
    fuelBarHeight.value = 0;
    releaseFlash.value = 0;

    // Start filling fuel
    const startTime = Date.now();
    const updateProgress = () => {
      if (!isPressedRef.current || isLaunchingRef.current) return;
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / FUEL_DURATION_MS, 1);
      setFuelProgress(progress);

      // Fill fuel bar (0 to 100% height)
      fuelBarHeight.value = withTiming(progress * 100, {
        duration: 50,
        easing: Easing.linear,
      });

      if (progress >= 1) {
        // Fuel bar is full - show release cue
        setShowRelease(true);
        releaseFlash.value = withSequence(
          withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) }),
          withTiming(0.3, { duration: 300, easing: Easing.inOut(Easing.ease) }),
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Speech.speak('Release to launch!', { rate: 0.85 });
      } else {
        progressTimerRef.current = setTimeout(updateProgress, 50);
      }
    };

    updateProgress();
  }, [roundActive, done, fuelBarHeight, releaseFlash]);

  // Handle release
  const handlePressOut = useCallback(async () => {
    if (!isPressedRef.current || isLaunchingRef.current) return;

    setIsPressed(false);
    isPressedRef.current = false;
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    const progress = fuelProgress;

    if (progress >= 0.95) {
      // Perfect release - launch rocket!
      setIsLaunching(true);
      isLaunchingRef.current = true;
      setShowRelease(false);
      releaseFlash.value = withTiming(0, { duration: 200 });

      // Launch animation
      rocketY.value = withTiming(-30, {
        duration: 2000,
        easing: Easing.out(Easing.ease),
      });
      rocketOpacity.value = withTiming(0, {
        duration: 2000,
        easing: Easing.in(Easing.ease),
      });
      rocketScale.value = withTiming(1.5, {
        duration: 2000,
        easing: Easing.out(Easing.ease),
      });

      // Record position for sparkle
      sparkleX.value = 50;
      sparkleY.value = 20;

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 2500);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            setFuelProgress(0);
            setIsLaunching(false);
            isLaunchingRef.current = false;
            fuelBarHeight.value = 0;
            rocketY.value = 50;
            rocketOpacity.value = 1;
            rocketScale.value = 1;
            setRoundActive(true);
          }, 2500);
        }
        return newScore;
      });

      try {
        await playLaunch();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } else {
      // Released too early
      fuelBarHeight.value = withTiming(0, { duration: 300 });
      setFuelProgress(0);
      setShowRelease(false);
      releaseFlash.value = withTiming(0, { duration: 200 });

      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Speech.speak('Fill the fuel bar completely!', { rate: 0.78 });
      } catch {}
    }
  }, [isPressed, isLaunching, fuelProgress, fuelBarHeight, releaseFlash, rocketY, rocketOpacity, rocketScale, sparkleX, sparkleY, playLaunch]);

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18; // 18 XP per successful launch
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'launchRocket',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['force-duration-control', 'delayed-gratification', 'impulse-inhibition'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log launch rocket game:', e);
      }

      Speech.speak('Amazing launches!', { rate: 0.78 });
    },
    [router],
  );

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const fuelBarStyle = useAnimatedStyle(() => ({
    height: `${fuelBarHeight.value}%`,
  }));

  const rocketStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: `${rocketY.value - 50}%` },
      { scale: rocketScale.value },
    ],
    opacity: rocketOpacity.value,
  }));

  const flashStyle = useAnimatedStyle(() => ({
    opacity: releaseFlash.value,
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🚀</Text>
            <Text style={styles.resultTitle}>Rocket master!</Text>
            <Text style={styles.resultSubtitle}>
              You launched {finalStats.correct} rockets out of {finalStats.total}!
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
                setFuelProgress(0);
                setIsLaunching(false);
                setRoundActive(true);
                fuelBarHeight.value = 0;
                rocketY.value = 50;
                rocketOpacity.value = 1;
                rocketScale.value = 1;
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
        <Text style={styles.title}>Launch Rocket</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🚀 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Press and hold to fill the fuel bar. Release when full to launch!
        </Text>
      </View>

      <View style={styles.playArea}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={styles.tapArea}
          disabled={!roundActive || done || isLaunching}
        >
          {/* Fuel bar container */}
          <View style={styles.fuelBarContainer}>
            <View style={styles.fuelBarBackground} />
            <Animated.View style={[styles.fuelBarFill, fuelBarStyle]} />
            <Text style={styles.fuelLabel}>FUEL</Text>
          </View>

          {/* Rocket */}
          <Animated.View style={[styles.rocketContainer, rocketStyle]} pointerEvents="none">
            <View style={styles.rocket}>
              <Text style={styles.rocketEmoji} selectable={false}>🚀</Text>
            </View>
          </Animated.View>

          {/* Release flash */}
          {showRelease && (
            <Animated.View style={[styles.flashOverlay, flashStyle]}>
              <View style={styles.flashCircle} />
            </Animated.View>
          )}

          {/* Sparkle burst on launch */}
          {isLaunching && (
            <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
              <SparkleBurst />
            </Animated.View>
          )}

          {/* Instruction */}
          {!isPressed && !isLaunching && (
            <View style={styles.instructionBox}>
              <Text style={styles.instructionText}>
                Press and hold to fill fuel! ⛽
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: force + duration control • delayed gratification • impulse inhibition
        </Text>
        <Text style={styles.footerSub}>
          Hold until the fuel bar is full, then release to launch! This builds patience and control.
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
  fuelBarContainer: {
    position: 'absolute',
    left: '10%',
    top: '20%',
    width: 40,
    height: '50%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  fuelBarBackground: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(148, 163, 184, 0.3)',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#64748B',
  },
  fuelBarFill: {
    width: '100%',
    backgroundColor: '#F59E0B',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D97706',
  },
  fuelLabel: {
    position: 'absolute',
    top: -25,
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
  },
  rocketContainer: {
    position: 'absolute',
    alignItems: 'center',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  rocket: {
    width: 80,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  rocketEmoji: {
    fontSize: 80,
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  flashOverlay: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(34, 197, 94, 0.3)',
    zIndex: 1,
  },
  flashCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 100,
    borderWidth: 4,
    borderColor: '#22C55E',
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 3,
  },
  instructionBox: {
    position: 'absolute',
    top: '70%',
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
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

export default LaunchRocketGame;

