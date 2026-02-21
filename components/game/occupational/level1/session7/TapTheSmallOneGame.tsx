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
const LARGE_SIZE = 160; // Large shape size
const MEDIUM_SIZE = 110; // Medium shape size
const SMALL_SIZE = 60; // Small shape size (smallest)

type Shape = {
  id: 'large' | 'medium' | 'small';
  size: number;
  x: number; // percentage
  y: number; // percentage
  color: string;
  scale: Animated.Value;
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

const TapTheSmallOneGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [roundActive, setRoundActive] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>([]);

  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#F472B6'];

  // Generate random positions for shapes, ensuring they don't overlap
  const generateShapePositions = useCallback((): { large: { x: number; y: number }; medium: { x: number; y: number }; small: { x: number; y: number } } => {
    const margin = 15; // percentage margin from edges
    const minDistance = 20; // minimum distance between shapes (percentage)

    // Generate positions with retry logic to avoid overlaps
    let positions: { large: { x: number; y: number }; medium: { x: number; y: number }; small: { x: number; y: number } } | null = null;
    let attempts = 0;

    while (!positions && attempts < 100) {
      const largeX = margin + Math.random() * (100 - margin * 2);
      const largeY = margin + Math.random() * (100 - margin * 2);
      const mediumX = margin + Math.random() * (100 - margin * 2);
      const mediumY = margin + Math.random() * (100 - margin * 2);
      const smallX = margin + Math.random() * (100 - margin * 2);
      const smallY = margin + Math.random() * (100 - margin * 2);

      // Check distances
      const distLargeMedium = Math.sqrt((largeX - mediumX) ** 2 + (largeY - mediumY) ** 2);
      const distLargeSmall = Math.sqrt((largeX - smallX) ** 2 + (largeY - smallY) ** 2);
      const distMediumSmall = Math.sqrt((mediumX - smallX) ** 2 + (mediumY - smallY) ** 2);

      if (distLargeMedium >= minDistance && distLargeSmall >= minDistance && distMediumSmall >= minDistance) {
        positions = {
          large: { x: largeX, y: largeY },
          medium: { x: mediumX, y: mediumY },
          small: { x: smallX, y: smallY },
        };
      }
      attempts++;
    }

    // Fallback if we couldn't find good positions
    if (!positions) {
      return {
        large: { x: 25, y: 30 },
        medium: { x: 50, y: 50 },
        small: { x: 75, y: 70 },
      };
    }

    return positions;
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
          type: 'tapTheSmallOne' as any,
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['noticing-scale-differences', 'fine-motor-precision', 'scanning-multiple-items'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap the small one game:', e);
      }
    },
    [router],
  );

  // Start a new round
  const startRound = useCallback(() => {
    const positions = generateShapePositions();
    
    // Randomize colors for each shape
    const largeColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    let mediumColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    while (mediumColor === largeColor) {
      mediumColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    }
    let smallColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    while (smallColor === largeColor || smallColor === mediumColor) {
      smallColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    }

    // Randomize sizes each round (but keep small as smallest)
    const sizeVariations = [
      { large: LARGE_SIZE, medium: MEDIUM_SIZE, small: SMALL_SIZE },
      { large: LARGE_SIZE + 20, medium: MEDIUM_SIZE + 10, small: SMALL_SIZE },
      { large: LARGE_SIZE - 10, medium: MEDIUM_SIZE - 5, small: SMALL_SIZE - 5 },
      { large: LARGE_SIZE + 10, medium: MEDIUM_SIZE, small: SMALL_SIZE + 5 },
    ];
    const sizeSet = sizeVariations[Math.floor(Math.random() * sizeVariations.length)];

    const newShapes: Shape[] = [
      {
        id: 'large',
        size: sizeSet.large,
        x: positions.large.x,
        y: positions.large.y,
        color: largeColor,
        scale: new Animated.Value(1),
        shakeAnim: new Animated.Value(0),
      },
      {
        id: 'medium',
        size: sizeSet.medium,
        x: positions.medium.x,
        y: positions.medium.y,
        color: mediumColor,
        scale: new Animated.Value(1),
        shakeAnim: new Animated.Value(0),
      },
      {
        id: 'small',
        size: sizeSet.small,
        x: positions.small.x,
        y: positions.small.y,
        color: smallColor,
        scale: new Animated.Value(1),
        shakeAnim: new Animated.Value(0),
      },
    ];

    setShapes(newShapes);
    setRoundActive(true);
  }, [generateShapePositions]);

  // Handle shape tap
  const handleShapeTap = useCallback(
    async (shapeId: 'large' | 'medium' | 'small') => {
      if (!roundActive || done) return;

      const shape = shapes.find((s) => s.id === shapeId);
      if (!shape) return;

      const isCorrect = shapeId === 'small';

      if (isCorrect) {
        // Correct tap - success animation
        setRoundActive(false);
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
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          speakTTS('Try the smallest one!', 0.78 );
        } catch {}

        // Retry - don't advance round
        setTimeout(() => {
          shape.shakeAnim.setValue(0);
        }, 500);
      }
    },
    [roundActive, done, shapes, round, score, startRound, endGame, playSuccess, playError],
  );

  // Start first round
  useEffect(() => {
    if (!done) {
      startRound();
    }
  }, []);

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Tap the smallest shape!', 0.78 );
      } catch {}
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
        message="Size Expert!"
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
        <Text style={styles.title}>Tap The Small One</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🔍 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Find and tap the smallest shape!
        </Text>
      </View>

      <View style={styles.playArea}>
        {shapes.map((shape) => {
          const shakeTranslateX = shape.shakeAnim.interpolate({
            inputRange: [-10, 10],
            outputRange: [-10, 10],
          });

          return (
            <Animated.View
              key={shape.id}
              style={[
                styles.shapeContainer,
                {
                  left: `${shape.x}%`,
                  top: `${shape.y}%`,
                  transform: [
                    { scale: shape.scale },
                    { translateX: shakeTranslateX },
                  ],
                },
              ]}
            >
              <Pressable
                onPress={() => handleShapeTap(shape.id)}
                style={[
                  styles.shape,
                  {
                    width: shape.size,
                    height: shape.size,
                    borderRadius: shape.size / 2,
                    backgroundColor: shape.color,
                  },
                ]}
                disabled={!roundActive || done}
              />
            </Animated.View>
          );
        })}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: noticing scale differences • fine-motor precision • scanning multiple items
        </Text>
        <Text style={styles.footerSub}>
          Find the smallest shape and tap it! Size changes each round to build scale discrimination.
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
  shapeContainer: {
    position: 'absolute',
    transform: [{ translateX: -LARGE_SIZE / 2 }, { translateY: -LARGE_SIZE / 2 }],
  },
  shape: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
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

export default TapTheSmallOneGame;

