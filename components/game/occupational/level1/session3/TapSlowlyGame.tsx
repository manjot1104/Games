import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
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
const INITIAL_BLINK_INTERVAL = 1500; // 1.5 seconds
const MIN_BLINK_INTERVAL = 800; // Fastest speed (0.8 seconds)
const SPEED_INCREASE = 100; // Decrease interval by 100ms each time
const CORRECT_TAPS_FOR_SPEED_UP = 4; // After 4 correct taps, speed increases
const TOTAL_TAPS_REQUIRED = 15; // Total taps to complete game
const CIRCLE_SIZE = 180;

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

const TapSlowlyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [isLit, setIsLit] = useState(false);
  const [blinkInterval, setBlinkInterval] = useState(INITIAL_BLINK_INTERVAL);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);
  const [lastTapTime, setLastTapTime] = useState<number | null>(null);
  const [missed, setMissed] = useState(false);

  // Animation values
  const glowAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Initial instruction - only once
  useEffect(() => {
    try {
      speakTTS('Wait for the circle to light up, then tap! Tap only when it\'s glowing.', { rate: 0.78 });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Blink animation loop
  useEffect(() => {
    if (done) return;

    const blinkLoop = () => {
      // Turn on (light up)
      setIsLit(true);
      setMissed(false);
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.7,
          duration: blinkInterval - 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.ease),
          useNativeDriver: false,
        }),
      ]).start(() => {
        setIsLit(false);
      });
    };

    // Start blinking
    blinkLoop();
    const interval = setInterval(blinkLoop, blinkInterval);

    return () => clearInterval(interval);
  }, [blinkInterval, done, glowAnim]);

  // Handle circle tap
  const handleTap = useCallback(async () => {
    if (done) return;

    const now = Date.now();
    const wasJustLit = isLit;

    if (wasJustLit) {
      // Correct tap - only when lit
      setConsecutiveCorrect((prev) => {
        const newCount = prev + 1;

        // Increase speed after CORRECT_TAPS_FOR_SPEED_UP correct taps
        if (newCount >= CORRECT_TAPS_FOR_SPEED_UP) {
          setBlinkInterval((current) => Math.max(MIN_BLINK_INTERVAL, current - SPEED_INCREASE));
          setConsecutiveCorrect(0); // Reset counter
        }

        return newCount;
      });

      setScore((s) => {
        const newScore = s + 1;

        // Success animation
        Animated.sequence([
          Animated.timing(scaleAnim, {
            toValue: 1.2,
            duration: 150,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 150,
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

      setLastTapTime(now);
    } else {
      // Wrong tap - tapped when not lit
      setMissed(true);
      setConsecutiveCorrect(0); // Reset consecutive correct count

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
          toValue: 10,
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
        speakTTS('Wait for it to light up!', 0.78 );
      } catch {}
    }
  }, [done, isLit, scaleAnim, glowAnim, shakeAnim, playSuccess, playError]);

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_TAPS_REQUIRED;
      const xp = finalScore * 12; // 12 XP per correct tap
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'tapSlowly',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['slow-motor-control', 'motor-inhibition', 'rhythm-synchronization', 'visual-motor-mapping'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap slowly game:', e);
      }

      speakTTS('Great slow control!', 0.78 );
    },
    [router],
  );

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Calculate speed percentage (faster = higher percentage)
  const speedPercentage = Math.round(((INITIAL_BLINK_INTERVAL - blinkInterval) / (INITIAL_BLINK_INTERVAL - MIN_BLINK_INTERVAL)) * 100);

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>⏱️</Text>
            <Text style={styles.resultTitle}>Excellent rhythm control!</Text>
            <Text style={styles.resultSubtitle}>
              You tapped {finalStats.correct} out of {finalStats.total} times correctly.
            </Text>
            <Text style={styles.resultSubtitle}>
              Final speed: {speedPercentage}% faster
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
                setScore(0);
                setBlinkInterval(INITIAL_BLINK_INTERVAL);
                setConsecutiveCorrect(0);
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

  // Glow animation style
  const glowStyle = {
    opacity: glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 0.8],
    }),
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

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Tap Slowly</Text>
        <Text style={styles.subtitle}>
          Taps: {score}/{TOTAL_TAPS_REQUIRED} • Speed: {speedPercentage}%
        </Text>
        <Text style={styles.helper}>
          Wait for the circle to light up, then tap! Tap only when it's glowing.
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
                  backgroundColor: isLit ? '#22C55E' : '#3B82F6',
                },
              ]}
            >
              <View style={styles.circleInner} />
              {isLit && (
                <Text style={styles.tapText}>TAP NOW!</Text>
              )}
            </View>
          </Animated.View>

          {/* Sparkle burst on correct tap */}
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
          Skills: slow motor control • motor inhibition • rhythm synchronization • visual-motor mapping
        </Text>
        <Text style={styles.footerSub}>
          Control your tapping speed. Wait for the circle to light up before tapping!
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
    backgroundColor: '#22C55E',
    shadowColor: '#22C55E',
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
    fontSize: 18,
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

export default TapSlowlyGame;

