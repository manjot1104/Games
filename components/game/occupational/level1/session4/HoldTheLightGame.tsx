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
    withRepeat,
    withSequence,
    withTiming
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const FLICKER_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 6;
const HOLD_DURATION_MS = 1800; // 1.8 seconds to fully glow
const PERFECT_WINDOW_START = 0.9; // 90% to 100% is perfect
const TOO_LATE_THRESHOLD = 1.1; // If held past 110%, bulb flickers

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

const HoldTheLightGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playFlicker = useSoundEffect(FLICKER_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const [glowProgress, setGlowProgress] = useState(0);
  const [isFlickering, setIsFlickering] = useState(false);
  const [roundActive, setRoundActive] = useState(true);

  // Animation values
  const bulbGlow = useSharedValue(0); // 0 to 1 (dim to bright)
  const bulbScale = useSharedValue(1);
  const bulbOpacity = useSharedValue(1);
  const flickerOpacity = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const holdStartTimeRef = useRef<number | null>(null);
  const isPressedRef = useRef(false);
  const isFlickeringRef = useRef(false);
  const glowProgressRef = useRef(0);

  // Handle press start
  const handlePressIn = useCallback(() => {
    if (!roundActive || done || isFlickeringRef.current) return;

    setIsPressed(true);
    isPressedRef.current = true;
    setGlowProgress(0);
    setIsFlickering(false);
    isFlickeringRef.current = false;
    bulbGlow.value = 0;
    flickerOpacity.value = 1;
    holdStartTimeRef.current = Date.now();

    // Start glowing
    const startTime = Date.now();
    const updateProgress = () => {
      if (!isPressedRef.current || isFlickeringRef.current) return;
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / HOLD_DURATION_MS, TOO_LATE_THRESHOLD);
      setGlowProgress(progress);
      glowProgressRef.current = progress; // Update ref for immediate access

      // Glow from 0 to 1 (or beyond for flicker)
      const glowValue = Math.min(progress, 1);
      bulbGlow.value = withTiming(glowValue, {
        duration: 50,
        easing: Easing.out(Easing.ease),
      });

      if (progress >= TOO_LATE_THRESHOLD) {
        // Held too long - flicker!
        setIsFlickering(true);
        isFlickeringRef.current = true;
        flickerOpacity.value = withRepeat(
          withSequence(
            withTiming(0.3, { duration: 100, easing: Easing.ease }),
            withTiming(1, { duration: 100, easing: Easing.ease }),
          ),
          5,
          false,
        );

        try {
          playFlicker();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          speakTTS('Release now!', 0.78 );
        } catch {}

        setTimeout(() => {
          setIsFlickering(false);
          isFlickeringRef.current = false;
          setGlowProgress(0);
          glowProgressRef.current = 0;
          bulbGlow.value = 0;
          flickerOpacity.value = 1;
        }, 2000);
      } else {
        progressTimerRef.current = setTimeout(updateProgress, 50);
      }
    };

    updateProgress();
  }, [roundActive, done, bulbGlow, flickerOpacity, playFlicker]);

  // End game - defined before handlePressOut to avoid initialization error
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 17; // 17 XP per perfect hold
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'holdTheLight',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['timing-modulation', 'sustained-attention', 'fine-motor-precision'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log hold the light game:', e);
      }

      speakTTS('Perfect lighting!', 0.78 );
    },
    [router],
  );

  // Handle release
  const handlePressOut = useCallback(async () => {
    if (!isPressedRef.current) return;

    setIsPressed(false);
    isPressedRef.current = false;
    if (progressTimerRef.current) {
      clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    if (isFlickeringRef.current) {
      // If flickering, reset after delay
      setTimeout(() => {
        setRoundActive(true);
      }, 2000);
      return;
    }

    // Use ref value for accurate progress reading
    const progress = glowProgressRef.current;

    if (progress >= PERFECT_WINDOW_START && progress <= 1) {
      // Perfect release - bulb shines fully!
      setRoundActive(false); // Disable input during animation
      
      bulbScale.value = withSequence(
        withTiming(1.2, { duration: 200, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 200, easing: Easing.in(Easing.ease) }),
      );

      // Record position for sparkle
      sparkleX.value = 50;
      sparkleY.value = 50;

      try {
        await playSuccess();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            setGlowProgress(0);
            glowProgressRef.current = 0;
            bulbGlow.value = 0;
            bulbScale.value = 1;
            setRoundActive(true);
          }, 1000);
        }
        return newScore;
      });
    } else if (progress < PERFECT_WINDOW_START) {
      // Released too early - dim and allow retry
      setRoundActive(false); // Brief pause
      bulbGlow.value = withTiming(0, { duration: 500 });
      setGlowProgress(0);
      glowProgressRef.current = 0;

      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        speakTTS('Hold longer for full brightness!', 0.78 );
      } catch {}

      // Re-enable after brief delay
      setTimeout(() => {
        setRoundActive(true);
      }, 800);
    }
  }, [bulbGlow, bulbScale, sparkleX, sparkleY, playSuccess, endGame]);

  // Initial instruction - only once
  useEffect(() => {
    try {
      speakTTS('Press and hold to make the bulb glow brighter. Release at full brightness!', 0.78 );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Reset round state
  useEffect(() => {
    if (roundActive && !done) {
      setGlowProgress(0);
      glowProgressRef.current = 0;
      setIsPressed(false);
      isPressedRef.current = false;
      setIsFlickering(false);
      isFlickeringRef.current = false;
      bulbGlow.value = 0;
      bulbScale.value = 1;
      flickerOpacity.value = 1;
    }
  }, [round, roundActive, done, score]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const bulbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: bulbScale.value }],
    opacity: flickerOpacity.value,
  }));

  const glowStyle = useAnimatedStyle(() => {
    const glowIntensity = bulbGlow.value;
    return {
      opacity: glowIntensity * 0.8,
      shadowOpacity: glowIntensity * 0.6,
    };
  });

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  // Calculate glow color based on progress
  const getGlowColor = () => {
    if (glowProgress < 0.3) return '#FCD34D'; // Dim yellow
    if (glowProgress < 0.7) return '#FBBF24'; // Medium yellow
    if (glowProgress < PERFECT_WINDOW_START) return '#F59E0B'; // Bright yellow
    return '#FCD34D'; // Full bright yellow
  };

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>💡</Text>
            <Text style={styles.resultTitle}>Light master!</Text>
            <Text style={styles.resultSubtitle}>
              You lit {finalStats.correct} bulbs perfectly out of {finalStats.total}!
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
                setGlowProgress(0);
                glowProgressRef.current = 0;
                setIsFlickering(false);
                isFlickeringRef.current = false;
                setRoundActive(true);
                bulbGlow.value = 0;
                bulbScale.value = 1;
                flickerOpacity.value = 1;
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
        <Text style={styles.title}>Hold The Light</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 💡 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Press and hold to make the bulb glow brighter. Release at full brightness!
        </Text>
      </View>

      <View style={styles.playArea}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={styles.tapArea}
          disabled={!roundActive || done || isFlickering}
        >
          {/* Glow effect */}
          <Animated.View style={[styles.glowContainer, glowStyle]}>
            <View
              style={[
                styles.glowCircle,
                {
                  backgroundColor: getGlowColor(),
                  shadowColor: getGlowColor(),
                },
              ]}
            />
          </Animated.View>

          {/* Light bulb */}
          <Animated.View style={[styles.bulbContainer, bulbStyle]}>
            <View style={styles.bulb}>
              <Text style={styles.bulbEmoji}>💡</Text>
            </View>
            <View style={styles.bulbBase} />
          </Animated.View>

          {/* Sparkle burst on success */}
          {score > 0 && !isPressed && !isFlickering && (
            <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
              <SparkleBurst />
            </Animated.View>
          )}

          {/* Brightness indicator */}
          {isPressed && !isFlickering && (
            <View style={styles.brightnessIndicator}>
              <Text style={styles.brightnessText}>
                {Math.round(glowProgress * 100)}% bright
              </Text>
            </View>
          )}

          {/* Flicker indicator */}
          {isFlickering && (
            <View style={styles.flickerIndicator}>
              <Text style={styles.flickerText}>Release now! ⚡</Text>
            </View>
          )}

          {/* Instruction */}
          {!isPressed && !isFlickering && (
            <View style={styles.instructionBox}>
              <Text style={styles.instructionText}>
                Press and hold to glow! ✨
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: timing modulation • sustained attention • fine motor precision
        </Text>
        <Text style={styles.footerSub}>
          Hold until the bulb is fully bright, then release! This builds timing and attention.
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
  glowContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    shadowRadius: 50,
    shadowOffset: { width: 0, height: 0 },
  },
  bulbContainer: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 2,
  },
  bulb: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bulbEmoji: {
    fontSize: 80,
  },
  bulbBase: {
    width: 40,
    height: 20,
    backgroundColor: '#64748B',
    borderRadius: 4,
    marginTop: -5,
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 3,
  },
  brightnessIndicator: {
    position: 'absolute',
    top: '60%',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  brightnessText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  flickerIndicator: {
    position: 'absolute',
    top: '60%',
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
  flickerText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  instructionBox: {
    position: 'absolute',
    top: '70%',
    backgroundColor: 'rgba(251, 191, 36, 0.9)',
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

export default HoldTheLightGame;

