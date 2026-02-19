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
const RESET_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const BALL_SIZE = 80;
const GOAL_SIZE = 120;
const GOAL_TOLERANCE = 60; // Distance from goal center to consider success

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

const DragBallToGoalGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playReset = useSoundEffect(RESET_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  // Animation values
  const ballX = useSharedValue(15); // Start at 15% from left
  const ballY = useSharedValue(50); // Start at 50% from top
  const ballScale = useSharedValue(1);
  const goalX = useSharedValue(85); // Goal at 85% from left
  const goalY = useSharedValue(50); // Goal at 50% from top
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const startX = useSharedValue(15);
  const startY = useSharedValue(50);

  // Get screen dimensions
  const screenWidth = useRef(400); // Default, will be updated
  const screenHeight = useRef(600); // Default, will be updated

  // End game function (defined before use)
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18; // 18 XP per successful drag
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'dragBallToGoal',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['drag-initiation', 'directionality', 'start-finish-understanding', 'controlled-finger-travel'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log drag ball to goal game:', e);
      }

      speakTTS('Great dragging!', 0.78 );
    },
    [router],
  );

  // Pan gesture for dragging
  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (!roundActive || done) return;
      setIsDragging(true);
      ballScale.value = withSpring(1.2, { damping: 10, stiffness: 200 });
    })
    .onUpdate((e) => {
      if (!roundActive || done) return;
      // Update ball position based on gesture
      const newX = (e.x / screenWidth.current) * 100;
      const newY = (e.y / screenHeight.current) * 100;
      
      // Keep ball within bounds
      ballX.value = Math.max(5, Math.min(95, newX));
      ballY.value = Math.max(10, Math.min(90, newY));
    })
    .onEnd(() => {
      if (!roundActive || done) return;
      setIsDragging(false);
      ballScale.value = withSpring(1, { damping: 10, stiffness: 200 });

      // Check if ball is in goal
      const distance = Math.sqrt(
        Math.pow(ballX.value - goalX.value, 2) + Math.pow(ballY.value - goalY.value, 2)
      );

      if (distance <= GOAL_TOLERANCE) {
        // Success! Ball reached goal
        sparkleX.value = goalX.value;
        sparkleY.value = goalY.value;

        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              // Reset ball position
              ballX.value = withSpring(startX.value, { damping: 10, stiffness: 100 });
              ballY.value = withSpring(startY.value, { damping: 10, stiffness: 100 });
              setRoundActive(true);
            }, 1500);
          }
          return newScore;
        });

        try {
          playSuccess();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {}
      } else {
        // Too early release - return to start
        ballX.value = withSpring(startX.value, { damping: 10, stiffness: 100 });
        ballY.value = withSpring(startY.value, { damping: 10, stiffness: 100 });

        try {
          playReset();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          speakTTS('Drag to the goal!', 0.78 );
        } catch {}
      }
    });

  // Initial instruction - only once
  useEffect(() => {
    try {
      speakTTS('Press the ball and drag it to the goal box. Release when it\'s inside!', 0.78 );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Initialize positions
  useEffect(() => {
    // Randomize goal position slightly
    const goalXPos = 75 + Math.random() * 15; // 75-90%
    const goalYPos = 30 + Math.random() * 40; // 30-70%
    goalX.value = goalXPos;
    goalY.value = goalYPos;

    // Randomize start position slightly
    const startXPos = 10 + Math.random() * 10; // 10-20%
    const startYPos = 40 + Math.random() * 20; // 40-60%
    startX.value = startXPos;
    startY.value = startYPos;
    ballX.value = startXPos;
    ballY.value = startYPos;
  }, [round, goalX, goalY, startX, startY, ballX, ballY]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const ballStyle = useAnimatedStyle(() => ({
    left: `${ballX.value}%`,
    top: `${ballY.value}%`,
    transform: [
      { translateX: -BALL_SIZE / 2 },
      { translateY: -BALL_SIZE / 2 },
      { scale: ballScale.value },
    ],
  }));

  const goalStyle = useAnimatedStyle(() => ({
    left: `${goalX.value}%`,
    top: `${goalY.value}%`,
    transform: [
      { translateX: -GOAL_SIZE / 2 },
      { translateY: -GOAL_SIZE / 2 },
    ],
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
            <Text style={{ fontSize: 64, marginBottom: 16 }}>⚽</Text>
            <Text style={styles.resultTitle}>Drag master!</Text>
            <Text style={styles.resultSubtitle}>
              You dragged {finalStats.correct} balls to the goal out of {finalStats.total}!
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onHome={() => {
                stopAllSpeech();
                cleanupSounds();
                onBack?.();
              }}
              onPlayAgain={() => {
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setRoundActive(true);
                ballX.value = startX.value;
                ballY.value = startY.value;
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
        <Text style={styles.title}>Drag The Ball To The Goal</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⚽ Score: {score}
        </Text>
        <Text style={styles.helper}>
          Press the ball and drag it to the goal box. Release when it's inside!
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
            {/* Goal box */}
            <Animated.View style={[styles.goalContainer, goalStyle]}>
              <View style={styles.goalBox}>
                <Text style={styles.goalText}>GOAL</Text>
              </View>
            </Animated.View>

            {/* Ball */}
            <Animated.View style={[styles.ballContainer, ballStyle]}>
              <View style={styles.ball}>
                <Text style={styles.ballEmoji}>⚽</Text>
              </View>
            </Animated.View>

            {/* Sparkle burst on success */}
            {score > 0 && !isDragging && (
              <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
                <SparkleBurst />
              </Animated.View>
            )}

            {/* Instruction */}
            {!isDragging && (
              <View style={styles.instructionBox}>
                <Text style={styles.instructionText}>
                  Drag the ball to the goal! 👆
                </Text>
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: drag initiation • directionality • start-finish understanding • controlled finger travel
        </Text>
        <Text style={styles.footerSub}>
          Press and drag the ball to the goal. This builds finger control and spatial awareness!
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
  ballContainer: {
    position: 'absolute',
    zIndex: 3,
  },
  ball: {
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  ballEmoji: {
    fontSize: 50,
  },
  goalContainer: {
    position: 'absolute',
    zIndex: 2,
  },
  goalBox: {
    width: GOAL_SIZE,
    height: GOAL_SIZE,
    borderRadius: 12,
    backgroundColor: '#22C55E',
    borderWidth: 4,
    borderColor: '#16A34A',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  goalText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
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

export default DragBallToGoalGame;

