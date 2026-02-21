import CongratulationsScreen from '@/components/game/CongratulationsScreen';
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
const TOTAL_ROUNDS = 8;
const LARGE_SIZE = 180; // Large shape size
const SMALL_SIZE = 80; // Small shape size (much smaller)
const GLOW_DURATION_MS = 1500; // Small shape glows for 1.5 seconds

type Shape = {
  id: 'large' | 'small';
  x: number; // percentage
  y: number; // percentage
  color: string;
  scale: Animated.Value;
  glowOpacity: Animated.Value;
  shakeAnim: Animated.Value;
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

const TapOnlySmallTargetGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>([]);

  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#F472B6'];

  // Generate random positions for shapes, ensuring they don't overlap
  const generateShapePositions = useCallback((): { large: { x: number; y: number }; small: { x: number; y: number } } => {
    const margin = 20; // percentage margin from edges
    const minDistance = 25; // minimum distance between shapes (percentage)

    // Generate large shape position
    const largeX = margin + Math.random() * (100 - margin * 2);
    const largeY = margin + Math.random() * (100 - margin * 2);

    // Generate small shape position (ensure it's far enough from large)
    let smallX = 0;
    let smallY = 0;
    let attempts = 0;
    let validPosition = false;

    while (!validPosition && attempts < 50) {
      smallX = margin + Math.random() * (100 - margin * 2);
      smallY = margin + Math.random() * (100 - margin * 2);

      const dx = largeX - smallX;
      const dy = largeY - smallY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance >= minDistance) {
        validPosition = true;
      }
      attempts++;
    }

    return { large: { x: largeX, y: largeY }, small: { x: smallX, y: smallY } };
  }, []);

  // Start a new round
  const startRound = useCallback(() => {
    const positions = generateShapePositions();
    const largeColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    const smallColor = COLORS[Math.floor(Math.random() * COLORS.length)];

    const newShapes: Shape[] = [
      {
        id: 'large',
        x: positions.large.x,
        y: positions.large.y,
        color: largeColor,
        scale: new Animated.Value(1),
        glowOpacity: new Animated.Value(0),
        shakeAnim: new Animated.Value(0),
      },
      {
        id: 'small',
        x: positions.small.x,
        y: positions.small.y,
        color: smallColor,
        scale: new Animated.Value(1),
        glowOpacity: new Animated.Value(0),
        shakeAnim: new Animated.Value(0),
      },
    ];

    setShapes(newShapes);
    setRoundActive(true);

    // Make small shape glow briefly
    Animated.sequence([
      Animated.timing(newShapes[1].glowOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(newShapes[1].glowOpacity, {
        toValue: 0.6,
        duration: GLOW_DURATION_MS - 600,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(newShapes[1].glowOpacity, {
        toValue: 0,
        duration: 300,
        easing: Easing.in(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  }, [generateShapePositions]);

  // Handle shape tap
  const handleShapeTap = useCallback(
    async (shapeId: 'large' | 'small') => {
      if (!roundActive || done) return;

      const shape = shapes.find((s) => s.id === shapeId);
      if (!shape) return;

      const isCorrect = shapeId === 'small';

      if (isCorrect) {
        // Correct tap - success animation
        setRoundActive(false);
        Animated.parallel([
          Animated.sequence([
            Animated.timing(shape.scale, {
              toValue: 1.3,
              duration: 120,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(shape.scale, {
              toValue: 0,
              duration: 150,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(shape.glowOpacity, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
          }),
        ]).start();

        try {
          await playSuccess();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}

        setScore((s) => s + 1);

        // Next round or finish
        if (round >= TOTAL_ROUNDS) {
          endGame(score + 1);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            setTimeout(() => {
              startRound();
            }, 400);
          }, 600);
        }
      } else {
        // Wrong tap - shake animation
        Animated.sequence([
          Animated.timing(shape.shakeAnim, {
            toValue: 10,
            duration: 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shape.shakeAnim, {
            toValue: -10,
            duration: 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shape.shakeAnim, {
            toValue: 10,
            duration: 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shape.shakeAnim, {
            toValue: 0,
            duration: 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        try {
          await playError();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          speakTTS('Tap the small one!', 0.78 );
        } catch {}
      }
    },
    [roundActive, done, shapes, round, score, playSuccess, playError, startRound],
  );

  // End game
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 15; // 15 XP per correct tap
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
          type: 'tapOnlySmall',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['selective-targeting', 'inhibition', 'visual-discrimination'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap only small game:', e);
      }
    },
    [router],
  );

  // Initialize first round
  useEffect(() => {
    try {
      speakTTS('Watch for the small shape to glow, then tap only the small one!', { rate: 0.78 });
    } catch {}
    startRound();
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
        message="Excellent Targeting!"
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
        <Text style={styles.title}>Tap Only the Small Target</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎯 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Watch for the small shape to glow, then tap only the small one!
        </Text>
      </View>

      <View style={styles.playArea}>
        {shapes.map((shape) => {
          const isSmall = shape.id === 'small';
          const size = isSmall ? SMALL_SIZE : LARGE_SIZE;

          const shapeStyle = {
            left: `${shape.x}%`,
            top: `${shape.y}%`,
            transform: [
              { translateX: -size / 2 },
              { translateY: -size / 2 },
              { scale: shape.scale },
              {
                translateX: shape.shakeAnim.interpolate({
                  inputRange: [-10, 10],
                  outputRange: [-10, 10],
                }),
              },
            ],
          };

          const glowStyle = {
            opacity: shape.glowOpacity,
          };

          return (
            <Animated.View
              key={shape.id}
              style={[styles.shapeContainer, shapeStyle]}
              pointerEvents="auto"
            >
              {/* Glow effect for small shape */}
              {isSmall && (
                <Animated.View
                  style={[
                    styles.glowEffect,
                    {
                      backgroundColor: shape.color,
                      width: size + 40,
                      height: size + 40,
                      borderRadius: (size + 40) / 2,
                    },
                    glowStyle,
                  ]}
                />
              )}
              <Pressable
                onPress={() => handleShapeTap(shape.id)}
                style={[
                  styles.shape,
                  {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: shape.color,
                  },
                ]}
              >
                <View style={styles.shapeInner} />
              </Pressable>
            </Animated.View>
          );
        })}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: selective targeting • inhibition of large objects • visual discrimination
        </Text>
        <Text style={styles.footerSub}>
          Ignore the big shape and tap only the small glowing target.
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
  },
  shapeContainer: {
    position: 'absolute',
  },
  glowEffect: {
    position: 'absolute',
    top: -20,
    left: -20,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  shape: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  shapeInner: {
    width: '40%',
    height: '40%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
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

export default TapOnlySmallTargetGame;

