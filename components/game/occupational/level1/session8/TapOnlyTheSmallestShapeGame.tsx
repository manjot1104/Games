import ResultCard from '@/components/game/ResultCard';
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
const TOTAL_ROUNDS = 10;
const MIN_SHAPES = 3;
const MAX_SHAPES = 4;
const SIZE_OPTIONS = [60, 90, 120, 150]; // Different sizes in pixels

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

type Shape = {
  id: string;
  size: number;
  x: number;
  y: number;
  scale: Animated.Value;
  opacity: Animated.Value;
};

const TapOnlyTheSmallestShapeGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [smallestId, setSmallestId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<'hit' | 'miss' | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const shakeAnimation = useRef(new Animated.Value(0)).current;
  const feedbackOpacity = useRef(new Animated.Value(0)).current;
  const shapesRef = useRef<Shape[]>([]);
  const smallestIdRef = useRef<string | null>(null);
  const roundRef = useRef(1);
  const scoreRef = useRef(0);

  // Keep refs in sync with state
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  useEffect(() => {
    smallestIdRef.current = smallestId;
  }, [smallestId]);

  useEffect(() => {
    roundRef.current = round;
  }, [round]);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  // End game function
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 20;
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'tapOnlyTheSmallestShape' as any,
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['precision-discrimination', 'selective-control', 'inhibitory-control'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap only the smallest shape game:', e);
      }

      speakTTS('Great discrimination!', 0.78 );
    },
    [router],
  );

  // Generate random non-overlapping positions
  const generatePositions = useCallback((count: number, shapeSize: number): Array<{ x: number; y: number }> => {
    const positions: Array<{ x: number; y: number }> = [];
    const margin = 10; // percentage margin from edges
    const minDistance = shapeSize * 1.5; // Minimum distance between shapes

    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let valid = false;
      let x = 0;
      let y = 0;

      while (!valid && attempts < 50) {
        x = margin + Math.random() * (100 - margin * 2);
        y = margin + Math.random() * (100 - margin * 2);

        // Check distance from existing positions
        valid = positions.every((pos) => {
          const dx = x - pos.x;
          const dy = y - pos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          return distance >= minDistance / 100; // Convert to percentage
        });

        attempts++;
      }

      positions.push({ x, y });
    }

    return positions;
  }, []);

  // Start a new round
  const startRound = useCallback(() => {
    setRoundActive(true);
    setLastResult(null);
    setShowFeedback(false);
    feedbackOpacity.setValue(0);

    // Random number of shapes (3 or 4)
    const numShapes = MIN_SHAPES + Math.floor(Math.random() * (MAX_SHAPES - MIN_SHAPES + 1));

    // Select random sizes (ensuring one is smallest)
    const selectedSizes = [...SIZE_OPTIONS].sort(() => Math.random() - 0.5).slice(0, numShapes);
    const smallestSize = Math.min(...selectedSizes);

    // Generate positions
    const positions = generatePositions(numShapes, Math.max(...selectedSizes));

    // Create shapes
    const newShapes: Shape[] = selectedSizes.map((size, index) => ({
      id: `shape-${index}`,
      size,
      x: positions[index].x,
      y: positions[index].y,
      scale: new Animated.Value(0),
      opacity: new Animated.Value(0),
    }));

    setShapes(newShapes);
    setSmallestId(newShapes.find((s) => s.size === smallestSize)?.id || null);

    // Animate shapes appearing
    newShapes.forEach((shape, index) => {
      Animated.sequence([
        Animated.delay(index * 100),
        Animated.parallel([
          Animated.timing(shape.scale, {
            toValue: 1,
            duration: 300,
            easing: Easing.out(Easing.back(1.2)),
            useNativeDriver: true,
          }),
          Animated.timing(shape.opacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
        ]),
      ]).start();
    });
  }, [generatePositions, feedbackOpacity]);

  // Handle shape tap
  const handleShapeTap = useCallback(
    async (shapeId: string) => {
      if (!roundActive || done) return;

      setRoundActive(false);

      const currentShapes = shapesRef.current;
      const currentSmallestId = smallestIdRef.current;
      const isSmallest = shapeId === currentSmallestId;
      setLastResult(isSmallest ? 'hit' : 'miss');
      setShowFeedback(true);

      if (isSmallest) {
        // Correct tap - smallest shape
        setScore((s) => s + 1);

        // Success animation - pop the smallest shape
        const tappedShape = currentShapes.find((s) => s.id === shapeId);
        if (tappedShape) {
          Animated.sequence([
            Animated.parallel([
              Animated.timing(tappedShape.scale, {
                toValue: 1.5,
                duration: 200,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
              }),
              Animated.timing(tappedShape.opacity, {
                toValue: 0,
                duration: 200,
                useNativeDriver: true,
              }),
            ]),
          ]).start();
        }

        // Fade out other shapes
        currentShapes.forEach((shape) => {
          if (shape.id !== shapeId) {
            Animated.timing(shape.opacity, {
              toValue: 0.3,
              duration: 300,
              useNativeDriver: true,
            }).start();
          }
        });

        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();

        try {
          await playSuccess();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          speakTTS('Perfect! You found the smallest!', 0.78 );
        } catch {}
      } else {
        // Wrong tap - not the smallest
        // Shake animation for wrong tap
        Animated.sequence([
          Animated.timing(shakeAnimation, {
            toValue: 10,
            duration: 50,
            useNativeDriver: true,
          }),
          Animated.timing(shakeAnimation, {
            toValue: -10,
            duration: 50,
            useNativeDriver: true,
          }),
          Animated.timing(shakeAnimation, {
            toValue: 10,
            duration: 50,
            useNativeDriver: true,
          }),
          Animated.timing(shakeAnimation, {
            toValue: 0,
            duration: 50,
            useNativeDriver: true,
          }),
        ]).start();

        // Highlight the smallest shape
        const smallestShape = currentShapes.find((s) => s.id === currentSmallestId);
        if (smallestShape) {
          Animated.sequence([
            Animated.timing(smallestShape.scale, {
              toValue: 1.2,
              duration: 200,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(smallestShape.scale, {
              toValue: 1,
              duration: 200,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]).start();
        }

        Animated.timing(feedbackOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();

        try {
          await playError();
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          speakTTS('Try the smallest one!', 0.78 );
        } catch {}
      }

      // Next round or finish
      if (roundRef.current >= TOTAL_ROUNDS) {
        setTimeout(() => {
          endGame(isSmallest ? scoreRef.current + 1 : scoreRef.current);
        }, 2000);
      } else {
        setTimeout(() => {
          setShowFeedback(false);
          feedbackOpacity.setValue(0);
          shakeAnimation.setValue(0);
          setRound((r) => r + 1);
          setTimeout(() => {
            startRound();
          }, 500);
        }, 2000);
      }
    },
    [roundActive, done, endGame, playSuccess, playError, feedbackOpacity, shakeAnimation, startRound],
  );

  // Start first round
  useEffect(() => {
    if (!done) {
      setTimeout(() => {
        startRound();
      }, 500);
    }
  }, []);

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Tap only the smallest shape!', 0.78 );
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>🎯</Text>
            <Text style={styles.resultTitle}>Discrimination master!</Text>
            <Text style={styles.resultSubtitle}>
              You found {finalStats.correct} out of {finalStats.total} smallest shapes!
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
                shakeAnimation.setValue(0);
                setTimeout(() => {
                  startRound();
                }, 500);
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const shakeTranslateX = shakeAnimation.interpolate({
    inputRange: [-10, 10],
    outputRange: [-10, 10],
  });

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Tap Only The Smallest Shape</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.helper}>
          Find and tap the smallest shape!
        </Text>
      </View>

      <Animated.View
        style={[
          styles.playArea,
          {
            transform: [{ translateX: shakeTranslateX }],
          },
        ]}
      >
        {shapes.map((shape) => {
          const isSmallest = shape.id === smallestId;
          return (
            <Animated.View
              key={shape.id}
              style={[
                styles.shapeContainer,
                {
                  left: `${shape.x}%`,
                  top: `${shape.y}%`,
                  width: shape.size,
                  height: shape.size,
                  transform: [
                    { translateX: -shape.size / 2 },
                    { translateY: -shape.size / 2 },
                    { scale: shape.scale },
                  ],
                  opacity: shape.opacity,
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
                    borderWidth: isSmallest ? 3 : 2,
                    borderColor: isSmallest ? '#22C55E' : '#3B82F6',
                    backgroundColor: isSmallest ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                  },
                ]}
                disabled={!roundActive || done}
              >
                <View
                  style={[
                    styles.shapeInner,
                    {
                      width: shape.size * 0.7,
                      height: shape.size * 0.7,
                      borderRadius: (shape.size * 0.7) / 2,
                    },
                  ]}
                />
              </Pressable>
            </Animated.View>
          );
        })}

        {/* Feedback indicator */}
        {showFeedback && lastResult && (
          <Animated.View
            style={[
              styles.feedbackContainer,
              {
                opacity: feedbackOpacity,
              },
            ]}
          >
            <View
              style={[
                styles.feedbackBox,
                {
                  backgroundColor: lastResult === 'hit' ? '#22C55E' : '#EF4444',
                },
              ]}
            >
              <Text style={styles.feedbackText}>
                {lastResult === 'hit' ? '✔ Perfect! Smallest found!' : '✗ Try the smallest one!'}
              </Text>
            </View>
          </Animated.View>
        )}
      </Animated.View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: precision + discrimination • selective control • inhibitory control
        </Text>
        <Text style={styles.footerSub}>
          Look carefully at all shapes and tap only the smallest one!
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
    backgroundColor: '#E0F2FE',
    borderRadius: 16,
    overflow: 'visible',
  },
  shapeContainer: {
    position: 'absolute',
  },
  shape: {
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  shapeInner: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  feedbackContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -100 }, { translateY: -25 }],
  },
  feedbackBox: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  feedbackText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
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

export default TapOnlyTheSmallestShapeGame;

