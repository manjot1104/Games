import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { SparkleBurst } from '@/components/game/FX';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const TOTAL_ROUNDS = 8;
const PIECE_SIZE = 100;
const OUTLINE_SIZE = 120;
const MATCH_TOLERANCE = 8; // Reduced from 40 to 8 for stricter matching - piece must be very close to outline center

type PuzzleShape = 'circle' | 'square' | 'triangle' | 'star' | 'heart';

const SHAPE_EMOJIS: Record<PuzzleShape, string> = {
  circle: '⭕',
  square: '⬜',
  triangle: '🔺',
  star: '⭐',
  heart: '❤️',
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

const PuzzlePieceDragGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [puzzleShape, setPuzzleShape] = useState<PuzzleShape>('circle');
  const [isMatched, setIsMatched] = useState(false);
  const [showCongratulations, setShowCongratulations] = useState(false);

  // Animation values
  const pieceX = useSharedValue(30);
  const pieceY = useSharedValue(30);
  const pieceScale = useSharedValue(1);
  const outlineX = useSharedValue(70);
  const outlineY = useSharedValue(70);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const startX = useSharedValue(30);
  const startY = useSharedValue(30);

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);

  // End game function (defined before use)
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 20; // 20 XP per successful match
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
          type: 'puzzlePieceDrag',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['spatial-problem-solving', 'multi-step-fine-motor-control', 'visual-perception'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log puzzle piece drag game:', e);
      }
    },
    [router],
  );

  // Pan gesture for dragging
  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (!roundActive || done || isMatched) return;
      setIsDragging(true);
      pieceScale.value = withSpring(1.2, { damping: 10, stiffness: 200 });
    })
    .onUpdate((e) => {
      if (!roundActive || done || isMatched) return;
      const newX = (e.x / screenWidth.current) * 100;
      const newY = (e.y / screenHeight.current) * 100;
      
      pieceX.value = Math.max(5, Math.min(95, newX));
      pieceY.value = Math.max(10, Math.min(90, newY));
    })
    .onEnd(() => {
      if (!roundActive || done || isMatched) return;
      setIsDragging(false);
      pieceScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      // Check if piece matches outline - must be very close to outline center
      const distance = Math.sqrt(
        Math.pow(pieceX.value - outlineX.value, 2) + Math.pow(pieceY.value - outlineY.value, 2)
      );

      // Stricter check: piece center must be within small radius of outline center
      // Also check that piece is not too far in any single direction
      const deltaX = Math.abs(pieceX.value - outlineX.value);
      const deltaY = Math.abs(pieceY.value - outlineY.value);
      const isWithinBounds = distance <= MATCH_TOLERANCE && deltaX <= MATCH_TOLERANCE && deltaY <= MATCH_TOLERANCE;

      if (isWithinBounds) {
        // Perfect match!
        setIsMatched(true);
        pieceX.value = withSpring(outlineX.value, { damping: 10, stiffness: 200 });
        pieceY.value = withSpring(outlineY.value, { damping: 10, stiffness: 200 });
        pieceScale.value = withSpring(1.1, { damping: 10, stiffness: 200 });

        sparkleX.value = outlineX.value;
        sparkleY.value = outlineY.value;

        setTimeout(() => {
          setScore((s) => {
            const newScore = s + 1;
            if (newScore >= TOTAL_ROUNDS) {
              setTimeout(() => {
                endGame(newScore);
              }, 1000);
            } else {
              setTimeout(() => {
                setRound((r) => r + 1);
                setIsMatched(false);
                pieceScale.value = 1;
                pieceX.value = withSpring(startX.value, { damping: 10, stiffness: 100 });
                pieceY.value = withSpring(startY.value, { damping: 10, stiffness: 100 });
                setRoundActive(true);
              }, 2000);
            }
            return newScore;
          });
        }, 500);

        try {
          playSuccess();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          speakTTS('Perfect match!', 0.78 );
        } catch {}
      } else {
        // Return to start
        pieceX.value = withSpring(startX.value, { damping: 10, stiffness: 100 });
        pieceY.value = withSpring(startY.value, { damping: 10, stiffness: 100 });

        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Drag to the matching outline!', 0.78 );
        } catch {}
      }
    });

  // Initial instruction - only once
  useEffect(() => {
    try {
      speakTTS('Drag the puzzle piece to its matching outline. Match the shapes!', 0.78 );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Initialize puzzle
  useEffect(() => {
    // Random puzzle shape
    const shapes: PuzzleShape[] = ['circle', 'square', 'triangle', 'star', 'heart'];
    const randomShape = shapes[Math.floor(Math.random() * shapes.length)];
    setPuzzleShape(randomShape);

    // Random positions
    const pieceXPos = 20 + Math.random() * 20; // 20-40%
    const pieceYPos = 20 + Math.random() * 20; // 20-40%
    startX.value = pieceXPos;
    startY.value = pieceYPos;
    pieceX.value = pieceXPos;
    pieceY.value = pieceYPos;

    const outlineXPos = 60 + Math.random() * 20; // 60-80%
    const outlineYPos = 60 + Math.random() * 20; // 60-80%
    outlineX.value = outlineXPos;
    outlineY.value = outlineYPos;

    setIsMatched(false);
    pieceScale.value = 1;
  }, [round, startX, startY, pieceX, pieceY, outlineX, outlineY]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const pieceStyle = useAnimatedStyle(() => ({
    left: `${pieceX.value}%`,
    top: `${pieceY.value}%`,
    transform: [
      { translateX: -PIECE_SIZE / 2 },
      { translateY: -PIECE_SIZE / 2 },
      { scale: pieceScale.value },
    ],
    opacity: isMatched ? 0.9 : 1,
  }));

  const outlineStyle = useAnimatedStyle(() => ({
    left: `${outlineX.value}%`,
    top: `${outlineY.value}%`,
    transform: [
      { translateX: -OUTLINE_SIZE / 2 },
      { translateY: -OUTLINE_SIZE / 2 },
    ],
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
        message="Puzzle Master!"
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
        <Text style={styles.title}>Puzzle Piece Drag</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🧩 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Drag the puzzle piece to its matching outline. Match the shapes!
        </Text>
      </View>

      <View
        style={styles.playArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            {/* Outline */}
            <Animated.View style={[styles.outlineContainer, outlineStyle]}>
              <View style={styles.outline}>
                <Text style={styles.outlineEmoji}>{SHAPE_EMOJIS[puzzleShape]}</Text>
                <View style={styles.outlineBorder} />
              </View>
            </Animated.View>

            {/* Puzzle piece */}
            <Animated.View style={[styles.pieceContainer, pieceStyle]}>
              <View style={styles.piece}>
                <Text style={styles.pieceEmoji}>{SHAPE_EMOJIS[puzzleShape]}</Text>
              </View>
            </Animated.View>

            {/* Sparkle burst on match */}
            {isMatched && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}

            {/* Instruction */}
            {!isDragging && !isMatched && (
              <View style={styles.instructionBox}>
                <Text style={styles.instructionText}>
                  Drag {SHAPE_EMOJIS[puzzleShape]} to match! 👆
                </Text>
              </View>
            )}

            {/* Match indicator */}
            {isMatched && (
              <View style={styles.matchBox}>
                <Text style={styles.matchText}>Perfect match! ✨</Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: spatial problem solving • multi-step fine motor control • visual perception
        </Text>
        <Text style={styles.footerSub}>
          Match the puzzle pieces! This is highly motivating and OT-approved.
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
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  pieceContainer: {
    position: 'absolute',
    zIndex: 3,
  },
  piece: {
    width: PIECE_SIZE,
    height: PIECE_SIZE,
    borderRadius: 12,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  pieceEmoji: {
    fontSize: 60,
  },
  outlineContainer: {
    position: 'absolute',
    zIndex: 2,
  },
  outline: {
    width: OUTLINE_SIZE,
    height: OUTLINE_SIZE,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  outlineBorder: {
    position: 'absolute',
    width: OUTLINE_SIZE,
    height: OUTLINE_SIZE,
    borderRadius: 12,
    borderWidth: 4,
    borderColor: '#94A3B8',
    borderStyle: 'dashed',
  },
  outlineEmoji: {
    fontSize: 60,
    opacity: 0.3,
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  instructionBox: {
    position: 'absolute',
    top: '75%',
    left: '50%',
    transform: [{ translateX: -100 }],
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
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
  matchBox: {
    position: 'absolute',
    top: '20%',
    left: '50%',
    transform: [{ translateX: -80 }],
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
  matchText: {
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

export default PuzzlePieceDragGame;

