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
    withSequence,
    withSpring,
    withTiming
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const SPLAT_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 10;
const MAX_COMPRESSION = 0.5; // Jelly can compress to 50% of original size
const SPLAT_THRESHOLD = 0.3; // If compressed below 30%, it splats

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

const SquishTheJellyGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playSplat = useSoundEffect(SPLAT_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);

  // Initial speech on mount
  useEffect(() => {
    try {
      speakTTS('Press and hold to compress the jelly. Release to let it spring back!', 0.78 );
    } catch {}
  }, []);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const [compression, setCompression] = useState(1); // 1 = normal, 0.5 = max compressed
  const [isSplatted, setIsSplatted] = useState(false);
  const [roundActive, setRoundActive] = useState(true);

  // Animation values
  const jellyScaleY = useSharedValue(1);
  const jellyScaleX = useSharedValue(1);
  const jellyY = useSharedValue(50); // Start at 50% from top
  const jellyOpacity = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const splatScale = useSharedValue(1);

  const compressionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPressedRef = useRef(false);
  const isSplattedRef = useRef(false);

  // Handle press start
  const handlePressIn = useCallback(() => {
    if (!roundActive || done || isSplattedRef.current) return;

    setIsPressed(true);
    isPressedRef.current = true;
    setCompression(1);
    setIsSplatted(false);
    isSplattedRef.current = false;

    // Start compressing jelly
    const startTime = Date.now();
    const updateCompression = () => {
      if (!isPressedRef.current || isSplattedRef.current) return;
      const elapsed = Date.now() - startTime;
      const compressionAmount = Math.min(elapsed / 1000, 1); // Compress over 1 second
      const newCompression = 1 - (compressionAmount * (1 - MAX_COMPRESSION));
      setCompression(newCompression);

      // Animate compression (squish vertically, expand horizontally)
      jellyScaleY.value = withTiming(newCompression, {
        duration: 50,
        easing: Easing.out(Easing.ease),
      });
      jellyScaleX.value = withTiming(1 + (1 - newCompression) * 0.3, {
        duration: 50,
        easing: Easing.out(Easing.ease),
      });
      jellyY.value = withTiming(50 + (1 - newCompression) * 10, {
        duration: 50,
        easing: Easing.out(Easing.ease),
      });

      if (newCompression <= SPLAT_THRESHOLD) {
        // Too much pressure - splat!
        setIsSplatted(true);
        isSplattedRef.current = true;
        splatScale.value = withSequence(
          withTiming(1.5, { duration: 200, easing: Easing.out(Easing.ease) }),
          withTiming(1.2, { duration: 300, easing: Easing.in(Easing.ease) }),
        );
        jellyScaleY.value = withTiming(0.2, { duration: 200 });
        jellyScaleX.value = withTiming(1.8, { duration: 200 });

        try {
          playSplat();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          speakTTS('Too much pressure!', 0.78 );
        } catch {}

        setTimeout(() => {
          setIsSplatted(false);
          isSplattedRef.current = false;
          setCompression(1);
          jellyScaleY.value = withSpring(1, { damping: 10, stiffness: 100 });
          jellyScaleX.value = withSpring(1, { damping: 10, stiffness: 100 });
          jellyY.value = withSpring(50, { damping: 10, stiffness: 100 });
          splatScale.value = 1;
        }, 2000);
      } else {
        compressionTimerRef.current = setTimeout(updateCompression, 50);
      }
    };

    updateCompression();
  }, [roundActive, done, jellyScaleY, jellyScaleX, jellyY, splatScale, playSplat]);

  // Handle release
  const handlePressOut = useCallback(async () => {
    if (!isPressedRef.current) return;

    setIsPressed(false);
    isPressedRef.current = false;
    if (compressionTimerRef.current) {
      clearTimeout(compressionTimerRef.current);
      compressionTimerRef.current = null;
    }

    if (isSplattedRef.current) return; // Already handled in press in

    // Spring back animation
    jellyScaleY.value = withSpring(1, { damping: 10, stiffness: 100 });
    jellyScaleX.value = withSpring(1, { damping: 10, stiffness: 100 });
    jellyY.value = withSpring(50, { damping: 10, stiffness: 100 });

    // Check if good compression (between 0.5 and 0.7)
    const finalCompression = compression;
    if (finalCompression >= 0.5 && finalCompression <= 0.7) {
      // Good squish!
      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            setCompression(1);
            setRoundActive(true);
          }, 1000);
        }
        return newScore;
      });

      // Record position for sparkle
      sparkleX.value = 50;
      sparkleY.value = 50;

      try {
        await playSuccess();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    } else {
      // Not quite right
      setCompression(1);
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
    }
  }, [isPressed, isSplatted, compression, jellyScaleY, jellyScaleX, jellyY, sparkleX, sparkleY, playSuccess]);

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 16; // 16 XP per successful squish
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'squishTheJelly',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['proprioception', 'force-regulation', 'sensory-feedback'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log squish the jelly game:', e);
      }

      speakTTS('Great squishing!', 0.78 );
    },
    [router],
  );

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const jellyStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleY: jellyScaleY.value },
      { scaleX: jellyScaleX.value },
      { translateY: `${jellyY.value - 50}%` },
    ],
    opacity: jellyOpacity.value,
  }));

  const splatStyle = useAnimatedStyle(() => ({
    transform: [{ scale: splatScale.value }],
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🍮</Text>
            <Text style={styles.resultTitle}>Jelly master!</Text>
            <Text style={styles.resultSubtitle}>
              You squished {finalStats.correct} jellies perfectly out of {finalStats.total}!
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
                setCompression(1);
                setIsSplatted(false);
                setRoundActive(true);
                jellyScaleY.value = 1;
                jellyScaleX.value = 1;
                jellyY.value = 50;
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
        <Text style={styles.title}>Squish The Jelly</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🍮 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Press and hold to compress the jelly. Release to let it spring back!
        </Text>
      </View>

      <View style={styles.playArea}>
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={styles.tapArea}
          disabled={!roundActive || done || isSplatted}
        >
          {/* Jelly blob */}
          <Animated.View style={[styles.jellyContainer, jellyStyle]} pointerEvents="none">
            <View
              style={[
                styles.jelly,
                {
                  backgroundColor: isSplatted ? '#EF4444' : '#8B5CF6',
                },
              ]}
            >
              <Text style={styles.jellyEmoji} selectable={false}>
                {isSplatted ? '💥' : '🍮'}
              </Text>
            </View>
          </Animated.View>

          {/* Splat effect */}
          {isSplatted && (
            <Animated.View style={[styles.splatContainer, splatStyle]} pointerEvents="none">
              <View style={styles.splatEffect} />
            </Animated.View>
          )}

          {/* Sparkle burst on success */}
          {score > 0 && !isPressed && !isSplatted && (
            <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
              <SparkleBurst />
            </Animated.View>
          )}

          {/* Instruction */}
          {!isPressed && !isSplatted && (
            <View style={styles.instructionBox}>
              <Text style={styles.instructionText}>
                Press and hold to squish! 👆
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: proprioception • force regulation • sensory feedback
        </Text>
        <Text style={styles.footerSub}>
          Squish the jelly gently! Too much pressure makes it splat. This builds force control!
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
  jellyContainer: {
    position: 'absolute',
    alignItems: 'center',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  jelly: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  jellyEmoji: {
    fontSize: 80,
    userSelect: 'none',
    WebkitUserSelect: 'none',
  },
  splatContainer: {
    position: 'absolute',
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splatEffect: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 4,
    borderColor: '#EF4444',
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 3,
  },
  instructionBox: {
    position: 'absolute',
    top: '70%',
    backgroundColor: 'rgba(139, 92, 246, 0.9)',
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

export default SquishTheJellyGame;

