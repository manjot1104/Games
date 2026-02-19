import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
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

const POP_SOUND = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const TARGETS_TO_POP = 15; // Total targets to pop
const CIRCLE_SIZE_PCT = 12; // 12% of screen (between 10-15% as specified)
const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#F472B6', '#06B6D4'];

const usePopSound = () => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri: POP_SOUND },
        { volume: 0.5, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load pop sound');
    }
  }, []);

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

const SmallCircleTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playPop = usePopSound();

  const [score, setScore] = useState(0);
  const [targetsLeft, setTargetsLeft] = useState(TARGETS_TO_POP);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [sparkleKey, setSparkleKey] = useState(0);

  // Animation values
  const targetX = useSharedValue(50);
  const targetY = useSharedValue(50);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  // Random color for each target
  const [color, setColor] = useState(COLORS[0]);

  const randomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  // Spawn a new target at random position
  const spawnTarget = useCallback(() => {
    const radiusPct = CIRCLE_SIZE_PCT / 2;
    const margin = radiusPct + 8; // Avoid edges with margin
    const x = margin + Math.random() * (100 - margin * 2);
    const y = margin + Math.random() * (100 - margin * 2);

    targetX.value = withTiming(x, { duration: 200, easing: Easing.out(Easing.ease) });
    targetY.value = withTiming(y, { duration: 200, easing: Easing.out(Easing.ease) });
    scale.value = withTiming(1, { duration: 180 });
    opacity.value = withTiming(1, { duration: 180 });
    setColor(randomColor());
  }, [targetX, targetY, scale, opacity]);

  // Handle tap on target
  const handleTap = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
    playPop();

    // Pop animation
    scale.value = withSequence(
      withTiming(1.3, { duration: 80, easing: Easing.out(Easing.ease) }),
      withTiming(0, { duration: 120, easing: Easing.in(Easing.ease) }),
    );
    opacity.value = withTiming(0, { duration: 140 });

    setSparkleKey(Date.now());
    setScore((s) => s + 1);
    setTargetsLeft((t) => {
      const next = t - 1;
      if (next <= 0) {
        runOnJS(setDone)(true);
      } else {
        // Spawn next target after a brief delay
        setTimeout(() => {
          runOnJS(spawnTarget)();
        }, 300);
      }
      return next;
    });
  }, [scale, opacity, playPop, spawnTarget]);

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TARGETS_TO_POP;
      const xp = finalScore * 12; // 12 XP per target
      const accuracy = 100; // All targets are correct if popped

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'smallCircleTap' as any,
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['finger-isolation', 'precision-motor', 'attention'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log small circle tap game:', e);
      }

      speakTTS('Great precision!', 0.78 );
    },
    [router],
  );

  // Initialize first target
  useEffect(() => {
    try {
      speakTTS('Use your index finger to tap the small circle. Be precise!', 0.78 );
    } catch {}
    spawnTarget();
  }, [spawnTarget]);

  // End game when done
  useEffect(() => {
    if (done && score > 0 && !finalStats) {
      endGame(score);
    }
  }, [done, score, finalStats, endGame]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated style for target circle
  const circleStyle = useAnimatedStyle(() => ({
    width: `${CIRCLE_SIZE_PCT}%`,
    height: `${CIRCLE_SIZE_PCT}%`,
    borderRadius: 999,
    left: `${targetX.value}%`,
    top: `${targetY.value}%`,
    transform: [
      { translateX: -(CIRCLE_SIZE_PCT / 2) + '%' as any },
      { translateY: -(CIRCLE_SIZE_PCT / 2) + '%' as any },
      { scale: scale.value },
    ],
    opacity: opacity.value,
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
          <LinearGradient
            colors={['#FFFFFF', '#EFF6FF']}
            style={styles.resultCard}
          >
            <Text style={{ fontSize: 72, marginBottom: 20 }}>🎯✨</Text>
            <Text style={styles.resultTitle}>Excellent Precision! 🎉</Text>
            <Text style={styles.resultSubtitle}>
              You tapped {finalStats.correct} out of {finalStats.total} targets! ⭐
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setScore(0);
                setTargetsLeft(TARGETS_TO_POP);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                spawnTarget();
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </LinearGradient>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#EFF6FF', '#DBEAFE', '#BFDBFE']}
        style={StyleSheet.absoluteFillObject}
      />
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <LinearGradient
          colors={['#1E293B', '#0F172A']}
          style={styles.backChipGradient}
        >
          <Text style={styles.backChipText}>← Back</Text>
        </LinearGradient>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>🎯 Small Circle Tap 🎯</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBadge}>
            <Text style={styles.statLabel}>Tapped</Text>
            <Text style={styles.statValue}>{score}/{TARGETS_TO_POP}</Text>
          </View>
          <View style={[styles.statBadge, styles.statBadgeAccent]}>
            <Text style={styles.statLabel}>Left</Text>
            <Text style={styles.statValue}>{targetsLeft}</Text>
          </View>
        </View>
        <Text style={styles.helper}>
          Use your index finger to tap the small circle. Be precise! ✨
        </Text>
      </View>

      <View style={styles.playArea}>
        <LinearGradient
          colors={['#F0FDF4', '#DCFCE7', '#BBF7D0']}
          style={StyleSheet.absoluteFillObject}
        />
        <Animated.View style={[circleStyle]}>
          <Pressable
            onPress={handleTap}
            style={styles.circlePressable}
          >
            <LinearGradient
              colors={[color, `${color}DD`, `${color}AA`]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.circle}
            >
              <View style={styles.circleInner} />
            </LinearGradient>
          </Pressable>
        </Animated.View>

        {/* Sparkle effect */}
        <SparkleBurst key={sparkleKey} visible={sparkleKey > 0} color={color} count={15} size={8} />
      </View>

      <View style={styles.footerBox}>
        <LinearGradient
          colors={['#FFFFFF', '#EFF6FF']}
          style={styles.footerGradient}
        >
          <Text style={styles.footerMain}>
            Skills: finger isolation • precision motor control • attention to small objects
          </Text>
          <Text style={styles.footerSub}>
            Level 2 focuses on isolated index finger tapping for AAC and writing readiness.
          </Text>
        </LinearGradient>
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
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  backChipGradient: {
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#1E40AF',
    marginBottom: 12,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 18,
    alignItems: 'center',
    minWidth: 100,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  statBadgeAccent: {
    backgroundColor: '#DBEAFE',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 15,
    color: '#1E40AF',
    textAlign: 'center',
    paddingHorizontal: 18,
    fontWeight: '600',
  },
  playArea: {
    flex: 1,
    position: 'relative',
    borderRadius: 24,
    overflow: 'hidden',
    marginHorizontal: 8,
    borderWidth: 3,
    borderColor: '#A7F3D0',
  },
  circlePressable: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  circle: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  circleInner: {
    width: '40%',
    height: '40%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    shadowColor: '#fff',
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  footerBox: {
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  footerGradient: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  footerMain: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E40AF',
    textAlign: 'center',
    marginBottom: 6,
  },
  footerSub: {
    fontSize: 13,
    color: '#3B82F6',
    textAlign: 'center',
    fontWeight: '500',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    padding: 32,
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  resultTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#1E40AF',
    marginBottom: 12,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  resultSubtitle: {
    fontSize: 18,
    color: '#64748B',
    marginBottom: 24,
    textAlign: 'center',
    fontWeight: '600',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
    fontSize: 15,
  },
});

export default SmallCircleTapGame;

