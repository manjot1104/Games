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
    Animated,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const SLOW_BLINK_INTERVAL = 1500; // 1.5 seconds - slow
const FAST_BLINK_INTERVAL = 400; // 0.4 seconds - fast
const TAPS_TO_SWITCH = 5; // After 5 taps, switch speed
const TOTAL_TAPS_REQUIRED = 20; // Total taps to complete game
const CIRCLE_SIZE = 180;

type SpeedMode = 'slow' | 'fast';

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

const SlowThenFastGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [speedMode, setSpeedMode] = useState<SpeedMode>('slow');
  const [isLit, setIsLit] = useState(false);
  const [tapsInCurrentMode, setTapsInCurrentMode] = useState(0);
  const [missed, setMissed] = useState(false);

  // Animation values
  const glowAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const modeTransitionAnim = useRef(new Animated.Value(0)).current;

  // Get current blink interval based on mode
  const currentBlinkInterval = speedMode === 'slow' ? SLOW_BLINK_INTERVAL : FAST_BLINK_INTERVAL;

  // Blink animation loop
  // Initial instruction - only once
  useEffect(() => {
    try {
      Speech.speak(`Tap when the circle lights up. After ${TAPS_TO_SWITCH} taps, the speed will switch!`, { rate: 0.78 });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  useEffect(() => {
    if (done) return;

    const blinkLoop = () => {
      // Turn on (light up)
      setIsLit(true);
      setMissed(false);
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: speedMode === 'slow' ? 200 : 100,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.7,
          duration: currentBlinkInterval - (speedMode === 'slow' ? 600 : 300),
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: speedMode === 'slow' ? 200 : 100,
          easing: Easing.in(Easing.ease),
          useNativeDriver: false,
        }),
      ]).start(() => {
        setIsLit(false);
      });
    };

    // Start blinking
    blinkLoop();
    const interval = setInterval(blinkLoop, currentBlinkInterval);

    return () => clearInterval(interval);
  }, [currentBlinkInterval, speedMode, done, glowAnim]);

  // Handle speed mode switch animation
  useEffect(() => {
    Animated.sequence([
      Animated.timing(modeTransitionAnim, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(modeTransitionAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.in(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  }, [speedMode, modeTransitionAnim]);

  // Handle circle tap
  const handleTap = useCallback(async () => {
    if (done) return;

    const wasJustLit = isLit;

    if (wasJustLit) {
      // Correct tap
      setTapsInCurrentMode((prev) => {
        const newCount = prev + 1;

        // Switch speed after TAPS_TO_SWITCH taps
        if (newCount >= TAPS_TO_SWITCH) {
          setSpeedMode((current) => (current === 'slow' ? 'fast' : 'slow'));
          setTapsInCurrentMode(0);
          Speech.speak(speedMode === 'slow' ? 'Now tap fast!' : 'Now tap slowly!', { rate: 0.78 });
        }

        return newCount;
      });

      setScore((s) => {
        const newScore = s + 1;

        // Success animation
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.2,
            duration: 120,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 120,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        if (newScore >= TOTAL_TAPS_REQUIRED) {
          setTimeout(() => {
            endGame(newScore);
          }, 500);
        }

        return newScore;
      });

      setIsLit(false);
      glowAnim.setValue(0);

      try {
        await playSuccess();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } else {
      // Wrong tap - tapped when not lit
      setMissed(true);

      // Shake animation
      Animated.sequence([
        Animated.timing(shakeAnim, {
          toValue: 10,
          duration: 50,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: -10,
          duration: 50,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shakeAnim, {
          toValue: 0,
          duration: 50,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();

      try {
        await playError();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Speech.speak('Wait for it to light up!', { rate: 0.78 });
      } catch {}
    }
  }, [done, isLit, speedMode, scaleAnim, glowAnim, shakeAnim, playSuccess, playError]);

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_TAPS_REQUIRED;
      const xp = finalScore * 12; // 12 XP per tap
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'slowThenFast',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['cognitive-flexibility', 'motor-pattern-switching', 'impulse-control'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log slow then fast game:', e);
      }

      Speech.speak('Excellent switching!', { rate: 0.78 });
    },
    [router],
  );

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Glow animation style
  const glowStyle = {
    opacity: glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.8],
    }),
  };

  // Mode transition animation
  const modeTransitionStyle = {
    opacity: modeTransitionAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    }),
    transform: [
      {
        scale: modeTransitionAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.9, 1.1],
        }),
      },
    ],
  };

  const shakeStyle = {
    transform: [
      {
        translateX: shakeAnim.interpolate({
          inputRange: [-10, 10],
          outputRange: [-10, 10],
        }),
      },
    ],
  };

  const circleColor = speedMode === 'slow' ? '#22C55E' : '#F59E0B';
  const glowColor = speedMode === 'slow' ? '#22C55E' : '#F59E0B';

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🔄</Text>
            <Text style={styles.resultTitle}>Perfect switching!</Text>
            <Text style={styles.resultSubtitle}>
              You tapped {finalStats.correct} out of {finalStats.total} times, switching between slow and fast.
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setScore(0);
                setSpeedMode('slow');
                setTapsInCurrentMode(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setIsLit(false);
                glowAnim.setValue(0);
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
        <Animated.View style={[styles.modeIndicator, modeTransitionStyle]}>
          <Text style={[styles.modeText, { color: circleColor }]}>
            {speedMode.toUpperCase()}
          </Text>
        </Animated.View>
        <Text style={styles.title}>Slow Then Fast</Text>
        <Text style={styles.subtitle}>
          Taps: {score}/{TOTAL_TAPS_REQUIRED} • Mode: {speedMode} ({tapsInCurrentMode}/{TAPS_TO_SWITCH})
        </Text>
        <Text style={styles.helper}>
          Tap when the circle lights up. After {TAPS_TO_SWITCH} taps, the speed will switch!
        </Text>
      </View>

      <View style={styles.playArea}>
        <Pressable onPress={handleTap} style={styles.tapArea}>
          <Animated.View
            style={[
              styles.circleContainer,
              {
                transform: [{ scale: scaleAnim }],
              },
              shakeStyle,
            ]}
          >
            {/* Glow effect */}
            <Animated.View
              style={[
                styles.glowEffect,
                {
                  width: CIRCLE_SIZE + 60,
                  height: CIRCLE_SIZE + 60,
                  borderRadius: (CIRCLE_SIZE + 60) / 2,
                  backgroundColor: glowColor,
                },
                glowStyle,
              ]}
            />

            {/* Main circle */}
            <View
              style={[
                styles.circle,
                {
                  width: CIRCLE_SIZE,
                  height: CIRCLE_SIZE,
                  borderRadius: CIRCLE_SIZE / 2,
                  backgroundColor: circleColor,
                },
              ]}
            >
              <View style={styles.circleInner} />
              {isLit && (
                <Text style={styles.tapText}>TAP!</Text>
              )}
            </View>
          </Animated.View>

          {/* Sparkle burst on tap */}
          {score > 0 && isLit && (
            <View style={styles.sparkleContainer} pointerEvents="none">
              <SparkleBurst />
            </View>
          )}

          {/* Miss indicator */}
          {missed && (
            <View style={styles.missIndicator}>
              <Text style={styles.missText}>Wait for it to light up! ⏳</Text>
            </View>
          )}
        </Pressable>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: cognitive flexibility • motor pattern switching • impulse control
        </Text>
        <Text style={styles.footerSub}>
          Switch between slow and fast tapping. This builds flexible motor control!
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
  modeIndicator: {
    backgroundColor: '#fff',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  modeText: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 2,
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
  },
  tapArea: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  circleContainer: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowEffect: {
    position: 'absolute',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  circle: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  circleInner: {
    width: '50%',
    height: '50%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  tapText: {
    position: 'absolute',
    fontSize: 20,
    fontWeight: '900',
    color: '#fff',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  sparkleContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -20 }, { translateY: -20 }],
  },
  missIndicator: {
    position: 'absolute',
    top: '70%',
    left: '50%',
    transform: [{ translateX: -100 }, { translateY: -20 }],
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
  missText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
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
    marginBottom: 8,
    textAlign: 'center',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default SlowThenFastGame;

