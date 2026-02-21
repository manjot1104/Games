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
    Animated, Easing,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const POP_SOUND = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const TOTAL_ROUNDS = 5; // 5 rounds of multiple targets
const TARGETS_PER_ROUND = 4; // 3-4 small dots per round
const DOT_SIZE = 45; // Small dot size
const MIN_DISTANCE = 15; // Minimum distance between dots (percentage)

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

type Dot = {
  id: string;
  x: number; // percentage
  y: number; // percentage
  scale: Animated.Value;
  opacity: Animated.Value;
  color: string;
  tapped: boolean;
};

const MultipleSmallTargetsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playPop = usePopSound();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [dots, setDots] = useState<Dot[]>([]);
  const [sparklePositions, setSparklePositions] = useState<Array<{ x: number; y: number; key: number }>>([]);

  const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#F472B6', '#06B6D4', '#EC4899'];

  // Generate random positions for dots, ensuring they don't overlap
  const generateDotPositions = useCallback((): Array<{ x: number; y: number }> => {
    const margin = 12; // percentage margin from edges
    const positions: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < TARGETS_PER_ROUND; i++) {
      let attempts = 0;
      let validPosition = false;
      let newX = 0;
      let newY = 0;

      while (!validPosition && attempts < 100) {
        newX = margin + Math.random() * (100 - margin * 2);
        newY = margin + Math.random() * (100 - margin * 2);

        // Check distance from existing positions
        validPosition = positions.every((pos) => {
          const dx = pos.x - newX;
          const dy = pos.y - newY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          return distance >= MIN_DISTANCE;
        });

        attempts++;
      }

      positions.push({ x: newX, y: newY });
    }

    return positions;
  }, []);

  // Spawn new round of dots
  const spawnDots = useCallback(() => {
    const positions = generateDotPositions();
    const newDots: Dot[] = positions.map((pos, index) => {
      const scale = new Animated.Value(0);
      const opacity = new Animated.Value(0);

      // Animate in
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 1,
          duration: 300,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      return {
        id: `dot-${round}-${index}`,
        x: pos.x,
        y: pos.y,
        scale,
        opacity,
        color: COLORS[index % COLORS.length],
        tapped: false,
      };
    });

    setDots(newDots);
  }, [round, generateDotPositions]);

  // Handle dot tap
  const handleDotTap = useCallback(
    async (dot: Dot) => {
      if (dot.tapped || done) return;

      // Mark as tapped
      dot.tapped = true;
      setDots((prev) => prev.map((d) => (d.id === dot.id ? dot : d)));

      // Record position for sparkle
      setSparklePositions((prev) => [...prev, { x: dot.x, y: dot.y, key: Date.now() }]);

      // Pop animation
      Animated.sequence([
        Animated.timing(dot.scale, {
          toValue: 1.4,
          duration: 120,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(dot.scale, {
          toValue: 0,
          duration: 200,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start(() => {
        setScore((s) => s + 1);
      });

      Animated.timing(dot.opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();

      try {
        await playPop();
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}

      // Remove sparkle after animation
      setTimeout(() => {
        setSparklePositions((prev) => prev.slice(1));
      }, 500);

      // Check if all dots are tapped
      const allTapped = dots.every((d) => d.id === dot.id || d.tapped);
      if (allTapped) {
        // All dots cleared, next round
        if (round >= TOTAL_ROUNDS) {
          endGame(score + 1);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            setTimeout(() => {
              spawnDots();
            }, 500);
          }, 600);
        }
      }
    },
    [dots, round, score, done, playPop, spawnDots],
  );

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS * TARGETS_PER_ROUND;
      const xp = finalScore * 10; // 10 XP per dot
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
          type: 'multipleSmallTargets',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['refined-tapping', 'scanning-precision', 'sustained-motor-activity', 'finger-isolation'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log multiple small targets game:', e);
      }

      speakTTS('Excellent precision!', 0.78 );
    },
    [router],
  );

  // Initialize first round
  useEffect(() => {
    try {
      speakTTS('Tap all the small dots to clear the screen!', 0.78 );
    } catch {}
    spawnDots();
  }, []);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Perfect Precision!"
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

  const remainingDots = dots.filter((d) => !d.tapped).length;
  const totalDotsThisRound = dots.length;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Multiple Small Targets</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎯 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Tap all {totalDotsThisRound} small dots to clear the screen! {remainingDots} remaining.
        </Text>
      </View>

      <View style={styles.playArea}>
        {dots.map((dot) => (
          <Animated.View
            key={dot.id}
            style={[
              styles.dotContainer,
              {
                left: `${dot.x}%`,
                top: `${dot.y}%`,
                transform: [
                  { translateX: -DOT_SIZE / 2 },
                  { translateY: -DOT_SIZE / 2 },
                  { scale: dot.scale },
                ],
                opacity: dot.opacity,
              },
            ]}
          >
            <Pressable
              onPress={() => handleDotTap(dot)}
              style={[
                styles.dot,
                {
                  width: DOT_SIZE,
                  height: DOT_SIZE,
                  borderRadius: DOT_SIZE / 2,
                  backgroundColor: dot.color,
                },
              ]}
            >
              <View style={styles.dotInner} />
            </Pressable>
          </Animated.View>
        ))}

        {/* Sparkle bursts on tap */}
        {sparklePositions.map((sparkle) => (
          <View
            key={sparkle.key}
            style={[
              styles.sparkleContainer,
              {
                left: `${sparkle.x}%`,
                top: `${sparkle.y}%`,
                transform: [{ translateX: -20 }, { translateY: -20 }],
              },
            ]}
            pointerEvents="none"
          >
            <SparkleBurst />
          </View>
        ))}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: refined tapping • scanning + precision • sustained motor activity • finger isolation
        </Text>
        <Text style={styles.footerSub}>
          Tap each small dot carefully. This builds precise finger control and scanning skills!
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
  dotContainer: {
    position: 'absolute',
  },
  dot: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  dotInner: {
    width: '35%',
    height: '35%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
  },
  sparkleContainer: {
    position: 'absolute',
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

export default MultipleSmallTargetsGame;

