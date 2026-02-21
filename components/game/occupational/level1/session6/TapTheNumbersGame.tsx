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
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withTiming
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const CIRCLE_SIZE = 100;
const SEQUENCE = [1, 2, 3];

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

const TapTheNumbersGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [currentSequenceIndex, setCurrentSequenceIndex] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [showCongratulations, setShowCongratulations] = useState(false);

  // Animation values for each circle
  const circle1Scale = useSharedValue(1);
  const circle1X = useSharedValue(0);
  const circle2Scale = useSharedValue(1);
  const circle2X = useSharedValue(0);
  const circle3Scale = useSharedValue(1);
  const circle3X = useSharedValue(0);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  // End game function (defined before use)
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18; // 18 XP per successful sequence
      const accuracy = (finalScore / total) * 100;

      // Set all states together FIRST (like CatchTheBouncingStar)
      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);
      setShowCongratulations(true);
      
      speakTTS('Amazing work! You completed the game!', 0.78);

      // Log game in background (don't wait for it)
      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'tapTheNumbers',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['early-sequencing', 'number-order-foundation', 'working-memory'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap the numbers game:', e);
      }
    },
    [router],
  );

  // Handle tap
  const handleTap = useCallback(async (number: number) => {
    if (!roundActive || done || isShaking) return;

    const expectedNumber = SEQUENCE[currentSequenceIndex];

    if (number === expectedNumber) {
      // Correct tap!
      const scaleAnim = number === 1 ? circle1Scale : number === 2 ? circle2Scale : circle3Scale;
      scaleAnim.value = withSequence(
        withTiming(1.3, { duration: 150, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 150, easing: Easing.in(Easing.ease) }),
      );

      const newIndex = currentSequenceIndex + 1;

      if (newIndex >= SEQUENCE.length) {
        // Sequence complete!
        sparkleX.value = 50;
        sparkleY.value = 50;

        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              setCurrentSequenceIndex(0);
              setRoundActive(true);
            }, 1500);
          }
          return newScore;
        });

        try {
          playSuccess();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          speakTTS('Perfect sequence!', 0.78 );
        } catch {}
      } else {
        setCurrentSequenceIndex(newIndex);
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {}
      }
    } else {
      // Wrong tap - shake!
      setIsShaking(true);
      const shakeAnim = number === 1 ? circle1X : number === 2 ? circle2X : circle3X;
      shakeAnim.value = withSequence(
        withTiming(-10, { duration: 50 }),
        withTiming(10, { duration: 50 }),
        withTiming(-10, { duration: 50 }),
        withTiming(10, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );

      // Reset sequence
      setCurrentSequenceIndex(0);

      try {
        playError();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        speakTTS('Try again! Tap 1, then 2, then 3.', { rate: 0.78 });
      } catch {}

      setTimeout(() => {
        setIsShaking(false);
      }, 500);
    }
  }, [roundActive, done, isShaking, currentSequenceIndex, playSuccess, playError, endGame]);

  // Reset sequence when round changes
  useEffect(() => {
    if (!done && roundActive) {
      if (round === 1 || currentSequenceIndex === 0) {
        try {
          speakTTS('Tap the numbers in order: 1, then 2, then 3!', { rate: 0.78 });
        } catch {}
      }
      setCurrentSequenceIndex(0);
    }
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round, done, roundActive]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const circle1Style = useAnimatedStyle(() => ({
    transform: [
      { scale: circle1Scale.value },
      { translateX: circle1X.value },
    ],
  }));

  const circle2Style = useAnimatedStyle(() => ({
    transform: [
      { scale: circle2Scale.value },
      { translateX: circle2X.value },
    ],
  }));

  const circle3Style = useAnimatedStyle(() => ({
    transform: [
      { scale: circle3Scale.value },
      { translateX: circle3X.value },
    ],
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  // Get expected number for highlighting
  const expectedNumber = SEQUENCE[currentSequenceIndex];

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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🔢</Text>
            <Text style={styles.resultTitle}>Number master!</Text>
            <Text style={styles.resultSubtitle}>
              You completed {finalStats.correct} sequences out of {finalStats.total}!
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
                setCurrentSequenceIndex(0);
                setRoundActive(true);
                circle1Scale.value = 1;
                circle2Scale.value = 1;
                circle3Scale.value = 1;
                circle1X.value = 0;
                circle2X.value = 0;
                circle3X.value = 0;
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
        <Text style={styles.title}>Tap The Numbers</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🔢 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Tap the numbers in order: 1, then 2, then 3!
        </Text>
      </View>

      <View style={styles.playArea}>
        <View style={styles.circlesContainer}>
          {/* Circle 1 */}
          <Animated.View style={[styles.circleContainer, circle1Style]}>
            <Pressable
              onPress={() => handleTap(1)}
              style={[
                styles.circle,
                {
                  backgroundColor: expectedNumber === 1 ? '#22C55E' : '#3B82F6',
                  borderColor: expectedNumber === 1 ? '#16A34A' : '#2563EB',
                  borderWidth: expectedNumber === 1 ? 4 : 2,
                },
              ]}
              disabled={!roundActive || done || isShaking}
            >
              <Text style={styles.circleNumber}>1</Text>
            </Pressable>
          </Animated.View>

          {/* Circle 2 */}
          <Animated.View style={[styles.circleContainer, circle2Style]}>
            <Pressable
              onPress={() => handleTap(2)}
              style={[
                styles.circle,
                {
                  backgroundColor: expectedNumber === 2 ? '#22C55E' : '#3B82F6',
                  borderColor: expectedNumber === 2 ? '#16A34A' : '#2563EB',
                  borderWidth: expectedNumber === 2 ? 4 : 2,
                },
              ]}
              disabled={!roundActive || done || isShaking}
            >
              <Text style={styles.circleNumber}>2</Text>
            </Pressable>
          </Animated.View>

          {/* Circle 3 */}
          <Animated.View style={[styles.circleContainer, circle3Style]}>
            <Pressable
              onPress={() => handleTap(3)}
              style={[
                styles.circle,
                {
                  backgroundColor: expectedNumber === 3 ? '#22C55E' : '#3B82F6',
                  borderColor: expectedNumber === 3 ? '#16A34A' : '#2563EB',
                  borderWidth: expectedNumber === 3 ? 4 : 2,
                },
              ]}
              disabled={!roundActive || done || isShaking}
            >
              <Text style={styles.circleNumber}>3</Text>
            </Pressable>
          </Animated.View>
        </View>

        {/* Progress indicator */}
        <View style={styles.progressContainer}>
          <Text style={styles.progressText}>
            Tap {expectedNumber} next
          </Text>
          <View style={styles.progressDots}>
            {SEQUENCE.map((num, idx) => (
              <View
                key={num}
                style={[
                  styles.progressDot,
                  {
                    backgroundColor: idx < currentSequenceIndex ? '#22C55E' : idx === currentSequenceIndex ? '#3B82F6' : '#E2E8F0',
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {/* Sparkle burst on success */}
        {score > 0 && !isShaking && (
          <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
            <SparkleBurst />
          </Animated.View>
        )}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: early sequencing • number-order foundation • working memory
        </Text>
        <Text style={styles.footerSub}>
          Tap 1, then 2, then 3 in order! This is the most fundamental OT sequencing game.
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
  circlesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    flexWrap: 'wrap',
  },
  circleContainer: {
    margin: 10,
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  circleNumber: {
    fontSize: 48,
    fontWeight: '900',
    color: '#fff',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  progressContainer: {
    marginTop: 40,
    alignItems: 'center',
  },
  progressText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12,
  },
  progressDots: {
    flexDirection: 'row',
    gap: 12,
  },
  progressDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
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

export default TapTheNumbersGame;

