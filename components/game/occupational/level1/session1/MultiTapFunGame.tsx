import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { SparkleBurst } from '@/components/game/FX';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const POP_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const BALLOONS_PER_ROUND = 5;
const TOTAL_ROUNDS = 3;
const BALLOON_SIZE = 100;
const BALLOON_COLORS = ['#EF4444', '#3B82F6', '#22C55E', '#F59E0B', '#8B5CF6', '#F472B6', '#06B6D4', '#EC4899'];

type Balloon = {
  id: string;
  x: number; // percentage
  y: number; // percentage
  color: string;
  scale: Animated.Value;
  opacity: Animated.Value;
  popped: boolean;
};

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

const MultiTapFunGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

  const [round, setRound] = useState(1);
  const [balloons, setBalloons] = useState<Balloon[]>([]);
  const [poppedCount, setPoppedCount] = useState(0);
  const [totalPopped, setTotalPopped] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [sparkleKey, setSparkleKey] = useState(0);

  const playPop = useSoundEffect(POP_SOUND);

  // Generate random positions for balloons, avoiding edges and overlaps
  const generateBalloonPositions = useCallback((): Array<{ x: number; y: number }> => {
    const positions: Array<{ x: number; y: number }> = [];
    const margin = 15; // percentage margin from edges
    const minDistance = 20; // minimum distance between balloons (percentage)

    for (let i = 0; i < BALLOONS_PER_ROUND; i++) {
      let attempts = 0;
      let validPosition = false;
      let x = 0;
      let y = 0;

      while (!validPosition && attempts < 50) {
        x = margin + Math.random() * (100 - margin * 2);
        y = margin + Math.random() * (100 - margin * 2);

        // Check distance from existing positions
        validPosition = positions.every((pos) => {
          const dx = pos.x - x;
          const dy = pos.y - y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          return distance >= minDistance;
        });

        attempts++;
      }

      positions.push({ x, y });
    }

    return positions;
  }, []);

  // End game - defined first to avoid initialization order issues
  const endGame = useCallback(
    async (finalPopped: number) => {
      const total = TOTAL_ROUNDS * BALLOONS_PER_ROUND;
      const xp = finalPopped * 10; // 10 XP per balloon
      const accuracy = (finalPopped / total) * 100;

      const stats = { correct: finalPopped, total, xp };
      
      // Set all states together FIRST (like CatchTheBouncingStar)
      setFinalStats(stats);
      setDone(true);
      setShowCongratulations(true);
      
      Speech.speak('Amazing work! You completed the game!', { rate: 0.78 });

      // Log game in background (don't wait for it)
      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'multiTap' as any,
          correct: finalPopped,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['repetitive-motor', 'coordination', 'finger-precision'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log multi-tap game:', e);
      }
    },
    [router],
  );

  // Spawn balloons for a round
  const spawnBalloons = useCallback(() => {
    const positions = generateBalloonPositions();
    const newBalloons: Balloon[] = positions.map((pos, index) => ({
      id: `balloon-${round}-${index}`,
      x: pos.x,
      y: pos.y,
      color: BALLOON_COLORS[index % BALLOON_COLORS.length],
      scale: new Animated.Value(1),
      opacity: new Animated.Value(1),
      popped: false,
    }));

    setBalloons(newBalloons);
    setPoppedCount(0);
  }, [round, generateBalloonPositions]);

  // Handle balloon tap
  const handleBalloonTap = useCallback(
    async (balloon: Balloon) => {
      if (balloon.popped || done) return;

      // Mark as popped
      const updatedBalloons = balloons.map((b) =>
        b.id === balloon.id ? { ...b, popped: true } : b,
      );
      setBalloons(updatedBalloons);

      // Animate pop
      Animated.parallel([
        Animated.sequence([
          Animated.timing(balloon.scale, {
            toValue: 1.3,
            duration: 100,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(balloon.scale, {
            toValue: 0,
            duration: 150,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(balloon.opacity, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();

      // Feedback
      try {
        await playPop();
        await Haptics.selectionAsync();
      } catch {}

      setSparkleKey(Date.now());
      const newPoppedCount = poppedCount + 1;
      setPoppedCount(newPoppedCount);
      
      const newTotalPopped = totalPopped + 1;
      setTotalPopped(newTotalPopped);

      // Check if round is complete
      if (newPoppedCount >= BALLOONS_PER_ROUND) {
        // Round complete
        if (round >= TOTAL_ROUNDS) {
          // Game complete
          endGame(newTotalPopped);
        } else {
          // Next round
          setTimeout(() => {
            setRound((r) => r + 1);
            setTimeout(() => {
              spawnBalloons();
            }, 400);
          }, 600);
        }
      }
    },
    [balloons, poppedCount, round, done, totalPopped, playPop, spawnBalloons, endGame],
  );

  // Initialize first round
  useEffect(() => {
    try {
      Speech.speak('Tap all the balloons! Tap each balloon one by one.', { rate: 0.78 });
    } catch {}
    spawnBalloons();
    return () => {
      // Cleanup: Stop speech when component unmounts
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Congratulations screen FIRST (like CatchTheBouncingStar)
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="All Balloons Popped!"
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
      <LinearGradient
        colors={['#FDF2F8', '#FCE7F3', '#FBCFE8']}
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
        <Text style={styles.title}>🎈 Multi-Tap Fun 🎈</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBadge}>
            <Text style={styles.statLabel}>Round</Text>
            <Text style={styles.statValue}>{round}/{TOTAL_ROUNDS}</Text>
          </View>
          <View style={[styles.statBadge, styles.popBadge]}>
            <Text style={styles.statLabel}>🎈 Popped</Text>
            <Text style={styles.statValue}>{totalPopped}</Text>
          </View>
        </View>
        <Text style={styles.helper}>
          Tap all {BALLOONS_PER_ROUND} balloons! {BALLOONS_PER_ROUND - poppedCount} left in this round. ✨
        </Text>
      </View>

      <View style={styles.playArea}>
        <LinearGradient
          colors={['#F0FDF4', '#DCFCE7', '#BBF7D0']}
          style={StyleSheet.absoluteFillObject}
        />
        {balloons.map((balloon) => (
          <Animated.View
            key={balloon.id}
            style={[
              styles.balloonContainer,
              {
                left: `${balloon.x}%`,
                top: `${balloon.y}%`,
                transform: [
                  { translateX: -BALLOON_SIZE / 2 },
                  { translateY: -BALLOON_SIZE / 2 },
                  { scale: balloon.scale },
                ],
                opacity: balloon.opacity,
              },
            ]}
            pointerEvents={balloon.popped ? 'none' : 'auto'}
          >
            <Pressable
              onPress={() => handleBalloonTap(balloon)}
              style={styles.balloonPressable}
              disabled={balloon.popped}
            >
              <LinearGradient
                colors={[balloon.color, `${balloon.color}DD`, `${balloon.color}AA`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.balloon}
              >
                <Text style={styles.balloonEmoji}>🎈</Text>
                <View style={styles.balloonGlow} />
              </LinearGradient>
            </Pressable>
          </Animated.View>
        ))}

        {/* Sparkle effect */}
        <SparkleBurst key={sparkleKey} visible={sparkleKey > 0} color="#EC4899" count={20} size={8} />
      </View>

      <View style={styles.footerBox}>
        <LinearGradient
          colors={['#FFFFFF', '#FDF2F8']}
          style={styles.footerGradient}
        >
          <Text style={styles.footerMain}>
            Skills: repetitive motor practice • coordination in multiple locations • finger precision
          </Text>
          <Text style={styles.footerSub}>
            Tap each balloon one by one to build intentional touch skills.
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
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  backChipGradient: {
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    fontSize: 28,
    fontWeight: '900',
    color: '#9F1239',
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
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  popBadge: {
    backgroundColor: '#FCE7F3',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 15,
    color: '#9F1239',
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
    borderColor: '#FBCFE8',
  },
  balloonContainer: {
    position: 'absolute',
    width: BALLOON_SIZE,
    height: BALLOON_SIZE,
  },
  balloonPressable: {
    width: BALLOON_SIZE,
    height: BALLOON_SIZE,
  },
  balloon: {
    width: BALLOON_SIZE,
    height: BALLOON_SIZE,
    borderRadius: BALLOON_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  balloonGlow: {
    position: 'absolute',
    width: '40%',
    height: '40%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    top: '20%',
    left: '30%',
  },
  balloonEmoji: {
    fontSize: 52,
    zIndex: 1,
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
    color: '#9F1239',
    textAlign: 'center',
    marginBottom: 6,
  },
  footerSub: {
    fontSize: 13,
    color: '#EC4899',
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
    color: '#9F1239',
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
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default MultiTapFunGame;

