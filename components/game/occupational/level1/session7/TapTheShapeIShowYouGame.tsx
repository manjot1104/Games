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
const SHAPE_SIZE = 120;
const SHOW_DURATION_MS = 2000; // Shape shows for 2 seconds

type ShapeType = 'circle' | 'square' | 'triangle';

const SHAPE_EMOJIS: Record<ShapeType, string> = {
  circle: '⭕',
  square: '⬜',
  triangle: '▲',
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

const TapTheShapeIShowYouGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [targetShape, setTargetShape] = useState<ShapeType | null>(null);
  const [showingTarget, setShowingTarget] = useState(true);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [shapes, setShapes] = useState<ShapeType[]>([]);
  const [isShaking, setIsShaking] = useState(false);

  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const targetScale = useRef(new Animated.Value(1)).current;
  const targetOpacity = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

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
          type: 'tapTheShapeIShowYou' as any,
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['shape-recognition-and-matching', 'working-memory', 'controlled-tapping'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap the shape I show you game:', e);
      }
    },
    [router],
  );

  // Start a new round
  const startRound = useCallback(() => {
    // Generate random target shape
    const shapes: ShapeType[] = ['circle', 'square', 'triangle'];
    const newTarget = shapes[Math.floor(Math.random() * shapes.length)];
    setTargetShape(newTarget);
    setShowingTarget(true);
    setRoundActive(false);
    setIsShaking(false);

    // Reset animations
    targetScale.setValue(1);
    targetOpacity.setValue(1);
    shakeAnim.setValue(0);

    // Show target shape with pulse animation
    Animated.sequence([
      Animated.parallel([
        Animated.sequence([
          Animated.timing(targetScale, {
            toValue: 1.2,
            duration: 300,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(targetScale, {
            toValue: 1,
            duration: 300,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(targetOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(SHOW_DURATION_MS - 600),
      Animated.timing(targetOpacity, {
        toValue: 0,
        duration: 300,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start(() => {
      // After showing target, display 3 shapes
      setShowingTarget(false);
      const allShapes: ShapeType[] = ['circle', 'square', 'triangle'];
      // Shuffle shapes
      const shuffled = [...allShapes].sort(() => Math.random() - 0.5);
      setShapes(shuffled);
      setRoundActive(true);
    });
  }, [targetScale, targetOpacity]);

  // Handle shape tap
  const handleShapeTap = useCallback(
    async (shape: ShapeType) => {
      if (!roundActive || done || isShaking) return;

      const isCorrect = shape === targetShape;

      if (isCorrect) {
        // Correct tap - success animation
        setRoundActive(false);
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
        setIsShaking(true);
        Animated.sequence([
          Animated.timing(shakeAnim, {
            toValue: 10,
            duration: 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shakeAnim, {
            toValue: -10,
            duration: 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shakeAnim, {
            toValue: 10,
            duration: 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shakeAnim, {
            toValue: 0,
            duration: 50,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]).start(() => {
          setIsShaking(false);
        });

        try {
          await playError();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          speakTTS('Try again!', 0.78 );
        } catch {}

        // Retry - don't advance round
      }
    },
    [roundActive, done, isShaking, targetShape, round, score, startRound, endGame, playSuccess, playError, shakeAnim],
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
        speakTTS('Watch the shape, then tap the same one!', { rate: 0.78 });
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
        message="Shape Master!"
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

  const shakeTranslateX = shakeAnim.interpolate({
    inputRange: [-10, 10],
    outputRange: [-10, 10],
  });

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Tap The Shape I Show You</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎯 Score: {score}
        </Text>
        <Text style={styles.helper}>
          {showingTarget ? 'Watch the shape!' : 'Tap the matching shape!'}
        </Text>
      </View>

      <View style={styles.playArea}>
        {showingTarget && targetShape ? (
          <Animated.View
            style={[
              styles.targetContainer,
              {
                transform: [
                  { scale: targetScale },
                  { translateX: shakeTranslateX },
                ],
                opacity: targetOpacity,
              },
            ]}
          >
            <View style={[styles.targetShape, { backgroundColor: '#3B82F6' }]}>
              <Text style={styles.shapeEmoji}>{SHAPE_EMOJIS[targetShape]}</Text>
            </View>
          </Animated.View>
        ) : (
          <View style={styles.shapesContainer}>
            {shapes.map((shape, index) => (
              <Animated.View
                key={`${shape}-${index}`}
                style={[
                  styles.shapeContainer,
                  isShaking && shape !== targetShape
                    ? {
                        transform: [{ translateX: shakeTranslateX }],
                      }
                    : {},
                ]}
              >
                <Pressable
                  onPress={() => handleShapeTap(shape)}
                  style={[
                    styles.shape,
                    {
                      backgroundColor: shape === targetShape ? '#22C55E' : '#3B82F6',
                      borderColor: shape === targetShape ? '#16A34A' : '#2563EB',
                      borderWidth: shape === targetShape ? 4 : 2,
                    },
                  ]}
                  disabled={!roundActive || done || isShaking}
                >
                  <Text style={styles.shapeEmoji}>{SHAPE_EMOJIS[shape]}</Text>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: shape recognition and matching • working memory • controlled tapping
        </Text>
        <Text style={styles.footerSub}>
          Remember the shape, then find and tap the matching one!
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
  },
  targetContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetShape: {
    width: SHAPE_SIZE * 1.5,
    height: SHAPE_SIZE * 1.5,
    borderRadius: SHAPE_SIZE * 0.75,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  shapesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    flexWrap: 'wrap',
  },
  shapeContainer: {
    margin: 10,
  },
  shape: {
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    borderRadius: SHAPE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  shapeEmoji: {
    fontSize: 60,
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

export default TapTheShapeIShowYouGame;

