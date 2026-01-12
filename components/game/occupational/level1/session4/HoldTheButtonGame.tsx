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
const BREAK_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const HOLD_DURATION_MS = 1800; // 1.8 seconds to fill ring
const RING_BREAK_THRESHOLD = 0.3; // If released before 30%, ring breaks

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

const HoldTheButtonGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playBreak = useSoundEffect(BREAK_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);

  // Initial speech on mount
  useEffect(() => {
    try {
      Speech.speak('Press and hold until the ring fills completely. Release when you see the green flash!', { rate: 0.78 });
    } catch {}
  }, []);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [ringBroken, setRingBroken] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [roundActive, setRoundActive] = useState(true);

  // Animation values
  const ringProgress = useSharedValue(0);
  const buttonScale = useSharedValue(1);
  const ringScale = useSharedValue(1);
  const ringRotation = useSharedValue(0);
  const flashOpacity = useSharedValue(0);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPressedRef = useRef(false);

  // Handle press start
  const handlePressIn = useCallback(() => {
    if (!roundActive || done || ringBroken) return;

    setIsPressed(true);
    isPressedRef.current = true;
    setRingBroken(false);
    setShowRelease(false);
    ringProgress.value = 0;
    ringScale.value = 1;
    ringRotation.value = 0;

    // Start filling ring
    const startTime = Date.now();
    const updateProgress = () => {
      if (!isPressedRef.current) return;
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setHoldProgress(progress);
      ringProgress.value = withTiming(progress, {
        duration: 50,
        easing: Easing.linear,
      });

      // Rotate ring while filling
      ringRotation.value = withTiming(progress * 360, {
        duration: 50,
        easing: Easing.linear,
      });

      if (progress < 1) {
        progressTimerRef.current = setTimeout(updateProgress, 50);
      } else {
        // Ring is full - show release cue
        setShowRelease(true);
        flashOpacity.value = withSequence(
          withTiming(1, { duration: 200, easing: Easing.out(Easing.ease) }),
          withTiming(0.3, { duration: 300, easing: Easing.inOut(Easing.ease) }),
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Speech.speak('Release now!', { rate: 0.85 });
      }
    };

    updateProgress();
  }, [roundActive, done, ringBroken, ringProgress, ringScale, ringRotation, flashOpacity]);

  // Handle release
  const handlePressOut = useCallback(async () => {
    if (!isPressedRef.current) return;

    setIsPressed(false);
    isPressedRef.current = false;
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    const progress = holdProgress;

    if (progress >= 0.95) {
      // Perfect release - success!
      setShowRelease(false);
      flashOpacity.value = withTiming(0, { duration: 200 });

      // Success animation
      buttonScale.value = withSequence(
        withTiming(1.2, { duration: 150, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 150, easing: Easing.in(Easing.ease) }),
      );

      // Record position for sparkle
      sparkleX.value = 50;
      sparkleY.value = 50;

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 800);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            setHoldProgress(0);
            ringProgress.value = 0;
            setRoundActive(true);
          }, 1000);
        }
        return newScore;
      });

      try {
        await playSuccess();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } else if (progress < RING_BREAK_THRESHOLD) {
      // Released too early - ring breaks
      setRingBroken(true);
      ringScale.value = withSequence(
        withTiming(1.3, { duration: 200, easing: Easing.out(Easing.ease) }),
        withTiming(0.8, { duration: 300, easing: Easing.in(Easing.ease) }),
      );
      ringRotation.value = withTiming(ringRotation.value + 45, {
        duration: 300,
        easing: Easing.out(Easing.ease),
      });

      try {
        await playBreak();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Speech.speak('Hold longer!', { rate: 0.78 });
      } catch {}

      setTimeout(() => {
        setRingBroken(false);
        setHoldProgress(0);
        ringProgress.value = 0;
        ringScale.value = 1;
        ringRotation.value = 0;
      }, 1500);
    } else {
      // Released too early but not broken
      setHoldProgress(0);
      ringProgress.value = withTiming(0, { duration: 300 });
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Speech.speak('Hold until the ring is full!', { rate: 0.78 });
      } catch {}
    }
  }, [isPressed, holdProgress, ringProgress, ringScale, ringRotation, flashOpacity, buttonScale, sparkleX, sparkleY, playSuccess, playBreak]);

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 16; // 16 XP per successful hold
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'holdTheButton',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['sustained-finger-pressure', 'proprioception', 'timing-control', 'finger-stability'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log hold the button game:', e);
      }

      Speech.speak('Great holding!', { rate: 0.78 });
    },
    [router],
  );

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const ringStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: ringScale.value },
      { rotate: `${ringRotation.value}deg` },
    ],
  }));

  const buttonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  // Calculate ring stroke dash for progress
  const ringCircumference = 2 * Math.PI * 80; // radius = 80
  const ringDashOffset = ringCircumference * (1 - holdProgress);

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>✅</Text>
            <Text style={styles.resultTitle}>Perfect holds!</Text>
            <Text style={styles.resultSubtitle}>
              You completed {finalStats.correct} out of {finalStats.total} perfect holds.
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
                setHoldProgress(0);
                setRingBroken(false);
                setShowRelease(false);
                setRoundActive(true);
                ringProgress.value = 0;
                ringScale.value = 1;
                ringRotation.value = 0;
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
        <Text style={styles.title}>Hold The Button</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ✅ Score: {score}
        </Text>
        <Text style={styles.helper}>
          Press and hold until the ring fills completely. Release when you see the green flash!
        </Text>
      </View>

      <View style={styles.playArea}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={styles.tapArea}
          disabled={!roundActive || done}
        >
          {/* Ring progress indicator */}
          <Animated.View style={[styles.ringContainer, ringStyle]}>
            <View style={styles.ringBackground} />
            <View
              style={[
                styles.ringProgress,
                {
                  transform: [
                    {
                      rotate: `${-90}deg`,
                    },
                  ],
                },
              ]}
            >
              <View
                style={[
                  styles.ringProgressFill,
                  {
                    width: `${holdProgress * 100}%`,
                  },
                ]}
              />
            </View>
          </Animated.View>

          {/* Main button */}
          <Animated.View style={[styles.buttonContainer, buttonStyle]}>
            <View
              style={[
                styles.button,
                {
                  backgroundColor: isPressed ? '#3B82F6' : '#60A5FA',
                  opacity: ringBroken ? 0.6 : 1,
                },
              ]}
            >
              {isPressed && (
                <Text style={styles.buttonText}>HOLDING...</Text>
              )}
              {showRelease && (
                <Text style={styles.releaseText}>RELEASE!</Text>
              )}
            </View>
          </Animated.View>

          {/* Green flash when ready */}
          {showRelease && (
            <Animated.View style={[styles.flashOverlay, flashStyle]}>
              <View style={styles.flashCircle} />
            </Animated.View>
          )}

          {/* Sparkle burst on success */}
          {score > 0 && !isPressed && !ringBroken && (
            <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
              <SparkleBurst />
            </Animated.View>
          )}

          {/* Ring broken indicator */}
          {ringBroken && (
            <View style={styles.breakIndicator}>
              <Text style={styles.breakText}>Hold longer! 💪</Text>
            </View>
          )}
        </Pressable>

        {/* Instruction text below button */}
        {!isPressed && !ringBroken && (
          <Text style={styles.instructionText}>PRESS & HOLD</Text>
        )}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: sustained finger pressure • proprioception • timing control • finger stability
        </Text>
        <Text style={styles.footerSub}>
          Hold the button until the ring fills completely. This builds finger strength and control!
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
  ringContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ringBackground: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 12,
    borderColor: 'rgba(148, 163, 184, 0.3)',
  },
  ringProgress: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    overflow: 'hidden',
  },
  ringProgressFill: {
    height: '100%',
    backgroundColor: '#22C55E',
    borderRadius: 100,
  },
  buttonContainer: {
    position: 'relative',
    zIndex: 2,
  },
  button: {
    width: 160,
    height: 160,
    borderRadius: 80,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '900',
    color: '#fff',
    textAlign: 'center',
  },
  releaseText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#22C55E',
    marginTop: 8,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  flashOverlay: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(34, 197, 94, 0.3)',
    zIndex: 1,
  },
  flashCircle: {
    width: '100%',
    height: '100%',
    borderRadius: 110,
    borderWidth: 4,
    borderColor: '#22C55E',
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 3,
  },
  breakIndicator: {
    position: 'absolute',
    top: '40%',
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  breakText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  instructionText: {
    marginTop: 20,
    fontSize: 18,
    fontWeight: '800',
    color: '#1F2937',
    textAlign: 'center',
    letterSpacing: 1,
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

export default HoldTheButtonGame;

