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
const LARGE_SIZE = 180; // Large circle size
const SMALL_SIZE = 80; // Small circle size
const GLOW_DURATION_MS = 1500; // Big circle glows for 1.5 seconds

type Circle = {
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

const TapTheBigOneGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [showCongratulations, setShowCongratulations] = useState(false);

  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#F472B6'];

  // Generate random positions for circles, ensuring they don't overlap
  const generateCirclePositions = useCallback((): { large: { x: number; y: number }; small: { x: number; y: number } } => {
    const margin = 20; // percentage margin from edges
    const minDistance = 25; // minimum distance between circles (percentage)

    // Generate large circle position
    const largeX = margin + Math.random() * (100 - margin * 2);
    const largeY = margin + Math.random() * (100 - margin * 2);

    // Generate small circle position (ensure it's far enough from large)
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

  // End game function
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 15; // 15 XP per correct tap
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
          type: 'tapTheBigOne' as any,
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['size-discrimination', 'target-accuracy', 'inhibition-of-distractor'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap the big one game:', e);
      }
    },
    [router],
  );

  // Start a new round
  const startRound = useCallback(() => {
    const positions = generateCirclePositions();
    const largeColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    const smallColor = COLORS[Math.floor(Math.random() * COLORS.length)];

    const newCircles: Circle[] = [
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

    setCircles(newCircles);
    setRoundActive(true);

    // Make big circle glow briefly
    Animated.sequence([
      Animated.timing(newCircles[0].glowOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(newCircles[0].glowOpacity, {
        toValue: 0.6,
        duration: GLOW_DURATION_MS - 600,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.timing(newCircles[0].glowOpacity, {
        toValue: 0,
        duration: 300,
        easing: Easing.in(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  }, [generateCirclePositions]);

  // Handle circle tap
  const handleCircleTap = useCallback(
    async (circleId: 'large' | 'small') => {
      if (!roundActive || done) return;

      const circle = circles.find((c) => c.id === circleId);
      if (!circle) return;

      const isCorrect = circleId === 'large';

      if (isCorrect) {
        // Correct tap - success animation
        setRoundActive(false);
        Animated.parallel([
          Animated.sequence([
            Animated.timing(circle.scale, {
              toValue: 1.3,
              duration: 120,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(circle.scale, {
              toValue: 0,
              duration: 150,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
          Animated.timing(circle.glowOpacity, {
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
          Animated.timing(circle.shakeAnim, {
            toValue: 10,
            duration: 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(circle.shakeAnim, {
            toValue: -10,
            duration: 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(circle.shakeAnim, {
            toValue: 10,
            duration: 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(circle.shakeAnim, {
            toValue: 0,
            duration: 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start();

        try {
          await playError();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          speakTTS('Try the big one!', 0.78 );
        } catch {}

        // Retry - don't advance round
        setTimeout(() => {
          circle.shakeAnim.setValue(0);
        }, 500);
      }
    },
    [roundActive, done, circles, round, score, startRound, endGame, playSuccess, playError],
  );

  // Start first round
  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Tap the big circle!', 0.78 );
      } catch {}
      startRound();
    }
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
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
        message="Size Master!"
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
        <Text style={styles.title}>Tap The Big One</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎯 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Watch the big circle glow, then tap it!
        </Text>
      </View>

      <View style={styles.playArea}>
        {circles.map((circle) => {
          const glowOpacity = circle.glowOpacity.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 0.8],
          });

          const shakeTranslateX = circle.shakeAnim.interpolate({
            inputRange: [-10, 10],
            outputRange: [-10, 10],
          });

          return (
            <Animated.View
              key={circle.id}
              style={[
                styles.circleContainer,
                {
                  left: `${circle.x}%`,
                  top: `${circle.y}%`,
                  transform: [
                    { scale: circle.scale },
                    { translateX: shakeTranslateX },
                  ],
                },
              ]}
            >
              <Pressable
                onPress={() => handleCircleTap(circle.id)}
                style={[
                  styles.circle,
                  {
                    width: circle.id === 'large' ? LARGE_SIZE : SMALL_SIZE,
                    height: circle.id === 'large' ? LARGE_SIZE : SMALL_SIZE,
                    borderRadius: circle.id === 'large' ? LARGE_SIZE / 2 : SMALL_SIZE / 2,
                    backgroundColor: circle.color,
                  },
                ]}
                disabled={!roundActive || done}
              >
                <Animated.View
                  style={[
                    styles.glowOverlay,
                    {
                      width: circle.id === 'large' ? LARGE_SIZE : SMALL_SIZE,
                      height: circle.id === 'large' ? LARGE_SIZE : SMALL_SIZE,
                      borderRadius: circle.id === 'large' ? LARGE_SIZE / 2 : SMALL_SIZE / 2,
                      opacity: glowOpacity,
                    },
                  ]}
                />
              </Pressable>
            </Animated.View>
          );
        })}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: size discrimination • target accuracy • inhibition of distractor
        </Text>
        <Text style={styles.footerSub}>
          Tap the big circle when it glows! This builds size discrimination and target accuracy.
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
  circleContainer: {
    position: 'absolute',
    transform: [{ translateX: -LARGE_SIZE / 2 }, { translateY: -LARGE_SIZE / 2 }],
  },
  circle: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  glowOverlay: {
    position: 'absolute',
    backgroundColor: '#FCD34D',
    top: 0,
    left: 0,
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
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  savedText: {
    marginTop: 16,
    fontSize: 14,
    color: '#22C55E',
    fontWeight: '600',
  },
});

export default TapTheBigOneGame;

