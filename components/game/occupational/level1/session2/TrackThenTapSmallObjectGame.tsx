import { SparkleBurst } from '@/components/game/FX';
import CongratulationsScreen from '@/components/game/CongratulationsScreen';
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
const MISS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const OBJECT_SIZE = 50; // Small object size
const MOVE_DURATION_MS = 3000; // 3 seconds to move across screen
const STOP_DURATION_MS = 2000; // 2 seconds to tap after stopping
const MOVE_SPEED = 0.3; // Slow movement speed

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

type ObjectType = 'bee' | 'dot' | 'star';

const OBJECT_EMOJIS: Record<ObjectType, string> = {
  bee: '🐝',
  dot: '⚫',
  star: '⭐',
};

const OBJECT_COLORS: Record<ObjectType, string> = {
  bee: '#FCD34D',
  dot: '#3B82F6',
  star: '#F59E0B',
};

const TrackThenTapSmallObjectGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playMiss = useSoundEffect(MISS_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [roundActive, setRoundActive] = useState(false);
  const [objectType, setObjectType] = useState<ObjectType>('bee');
  const [hasStopped, setHasStopped] = useState(false);
  const [missed, setMissed] = useState(false);

  // Animation values
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const pulseScale = useSharedValue(1);

  // Generate random path for object movement
  const generatePath = useCallback(() => {
    const margin = 20; // percentage margin
    const startX = margin + Math.random() * (100 - margin * 2);
    const startY = margin + Math.random() * (100 - margin * 2);
    const endX = margin + Math.random() * (100 - margin * 2);
    const endY = margin + Math.random() * (100 - margin * 2);

    // Ensure path is visible (not too short)
    const distance = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
    if (distance < 30) {
      // If too short, make end point opposite side
      return {
        startX,
        startY,
        endX: 100 - startX,
        endY: 100 - startY,
      };
    }

    return { startX, startY, endX, endY };
  }, []);

  // Start a new round
  const startRound = useCallback(() => {
    setRoundActive(true);
    setHasStopped(false);
    setMissed(false);
    opacity.value = 1;
    scale.value = 1;

    // Random object type
    const types: ObjectType[] = ['bee', 'dot', 'star'];
    const randomType = types[Math.floor(Math.random() * types.length)];
    setObjectType(randomType);

    const path = generatePath();

    // Start position
    x.value = path.startX;
    y.value = path.startY;

    // Move to end position slowly
    x.value = withTiming(
      path.endX,
      {
        duration: MOVE_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
      },
      () => {
        // When movement completes, object stops
        runOnJS(setHasStopped)(true);
        runOnJS(setRoundActive)(false);

        // Pulse animation when stopped (indicates it's ready to tap)
        pulseScale.value = withSequence(
          withTiming(1.2, { duration: 300, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 300, easing: Easing.in(Easing.ease) }),
        );

        // After stop duration, mark as missed if not tapped
        setTimeout(() => {
          runOnJS(handleTimeout)();
        }, STOP_DURATION_MS);
      },
    );
    y.value = withTiming(path.endY, {
      duration: MOVE_DURATION_MS,
      easing: Easing.inOut(Easing.ease),
    });
  }, [x, y, opacity, scale, pulseScale, generatePath]);

  // Handle timeout (object stopped but not tapped)
  const handleTimeout = useCallback(() => {
    if (!hasStopped || done) return;
    setMissed(true);
    setRoundActive(false);

    // Fade out animation
    opacity.value = withTiming(0, { duration: 400 });
    scale.value = withTiming(0.5, { duration: 400 });

    try {
      playMiss();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      speakTTS('Follow it and tap when it stops!', 0.78 );
    } catch {}

    // Next round or finish
    setTimeout(() => {
      if (round >= TOTAL_ROUNDS) {
        endGame(score);
      } else {
        setRound((r) => r + 1);
        setTimeout(() => {
          startRound();
        }, 800);
      }
    }, 600);
  }, [hasStopped, done, round, score, opacity, scale, playMiss, startRound]);

  // Handle object tap
  const handleTap = useCallback(async () => {
    if (!hasStopped || done || missed) return;

    // Record tap position for sparkle
    sparkleX.value = x.value;
    sparkleY.value = y.value;

    // Success animation
    scale.value = withSequence(
      withTiming(1.5, { duration: 150, easing: Easing.out(Easing.ease) }),
      withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) }, () => {
        runOnJS(setScore)((s) => s + 1);
        runOnJS(setRoundActive)(false);

        if (round >= TOTAL_ROUNDS) {
          runOnJS(endGame)(score + 1);
        } else {
          runOnJS(setRound)((r) => r + 1);
          setTimeout(() => {
            runOnJS(startRound)();
          }, 600);
        }
      }),
    );

    opacity.value = withTiming(0, { duration: 200 });

    try {
      await playSuccess();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {}

    // Show sparkle burst
    setTimeout(() => {
      scale.value = 1;
      opacity.value = 1;
    }, 400);
  }, [hasStopped, done, missed, round, score, x, y, scale, opacity, sparkleX, sparkleY, playSuccess, startRound]);

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 14; // 14 XP per successful tap
      const accuracy = (finalScore / total) * 100;

      // Set all states together FIRST (like CatchTheBouncingStar)
      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setShowCongratulations(true);
      
      speakTTS('Amazing work! You completed the game!', 0.78);

      // Log game in background (don't wait for it)
      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'trackThenTap',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['visual-tracking', 'fine-motor-coordination', 'timing-precision', 'aac-targeting'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log track then tap game:', e);
      }

      speakTTS('Great tracking and tapping!', 0.78 );
    },
    [router],
  );

  // Initialize first round
  useEffect(() => {
    try {
      speakTTS('Follow the object with your eyes. When it stops, tap it quickly!', { rate: 0.78 });
    } catch {}
    startRound();
  }, []);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const objectStyle = useAnimatedStyle(() => ({
    left: `${x.value}%`,
    top: `${y.value}%`,
    transform: [
      { translateX: -OBJECT_SIZE / 2 },
      { translateY: -OBJECT_SIZE / 2 },
      { scale: scale.value * pulseScale.value },
    ],
    opacity: opacity.value,
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Excellent Tracking!"
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
        <Text style={styles.title}>Track Then Tap</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎯 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Follow the {objectType} with your eyes. When it stops, tap it quickly!
        </Text>
      </View>

      <View style={styles.playArea}>
        <Pressable
          onPress={handleTap}
          style={styles.tapArea}
          disabled={!hasStopped || missed}
        >
          <Animated.View
            style={[
              styles.objectContainer,
              objectStyle,
            ]}
          >
            <View
              style={[
                styles.object,
                {
                  width: OBJECT_SIZE,
                  height: OBJECT_SIZE,
                  borderRadius: OBJECT_SIZE / 2,
                  backgroundColor: OBJECT_COLORS[objectType],
                },
              ]}
            >
              <Text style={styles.objectEmoji}>{OBJECT_EMOJIS[objectType]}</Text>
            </View>
          </Animated.View>

          {/* Sparkle burst on tap */}
          {score > 0 && (
            <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
              <SparkleBurst />
            </Animated.View>
          )}

          {/* Instruction overlay when stopped */}
          {hasStopped && !missed && (
            <View style={styles.stopIndicator}>
              <Text style={styles.stopText}>Tap now! 👆</Text>
            </View>
          )}

          {/* Miss indicator */}
          {missed && (
            <View style={styles.missIndicator}>
              <Text style={styles.missText}>Missed! Follow and tap when it stops.</Text>
            </View>
          )}
        </Pressable>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: visual tracking • fine motor coordination • timing & precision • AAC targeting
        </Text>
        <Text style={styles.footerSub}>
          Follow the moving object with your eyes, then tap it when it stops. This builds skills for AAC buttons!
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
  objectContainer: {
    position: 'absolute',
  },
  object: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  objectEmoji: {
    fontSize: 28,
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
  },
  stopIndicator: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -60 }, { translateY: -20 }],
    backgroundColor: 'rgba(34, 197, 94, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  stopText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  missIndicator: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -100 }, { translateY: -20 }],
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  missText: {
    color: '#fff',
    fontSize: 14,
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

export default TrackThenTapSmallObjectGame;

