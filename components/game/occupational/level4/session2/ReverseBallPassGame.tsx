import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BALL_SIZE = 60;
const BOX_SIZE = 100;
const TOLERANCE = 50;

const ReverseBallPassGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const ballX = useSharedValue(SCREEN_WIDTH * 0.85);
  const ballY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const ballScale = useSharedValue(1);
  const rightBoxX = useSharedValue(SCREEN_WIDTH * 0.85);
  const rightBoxY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const leftBoxX = useSharedValue(SCREEN_WIDTH * 0.15);
  const leftBoxY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setIsDragging(true);
      ballScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      const newX = e.x;
      const newY = e.y;
      ballX.value = Math.max(BALL_SIZE / 2, Math.min(screenWidth.current - BALL_SIZE / 2, newX));
      ballY.value = Math.max(BALL_SIZE / 2, Math.min(screenHeight.current - BALL_SIZE / 2, newY));
    })
    .onEnd(() => {
      if (done) return;
      setIsDragging(false);
      ballScale.value = withSpring(1);

      const distance = Math.sqrt(
        Math.pow(ballX.value - leftBoxX.value, 2) + Math.pow(ballY.value - leftBoxY.value, 2)
      );

      if (distance <= TOLERANCE) {
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              resetBall();
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect pass!', 0.9, 'en-US' );
      } else {
        resetBall();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        speakTTS('Drag the ball to the left box!', 0.8, 'en-US' );
      }
    });

  const resetBall = useCallback(() => {
    ballX.value = withSpring(rightBoxX.value);
    ballY.value = withSpring(rightBoxY.value);
  }, [ballX, ballY, rightBoxX, rightBoxY]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'reverse-ball-pass',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['bilateral-balance', 'drag-right-left'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetBall();
      speakTTS('Drag the ball from right to left box!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, resetBall]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  const ballStyle = useAnimatedStyle(() => ({
    left: ballX.value - BALL_SIZE / 2,
    top: ballY.value - BALL_SIZE / 2,
    transform: [{ scale: ballScale.value }],
  }));

  const rightBoxStyle = useAnimatedStyle(() => ({
    left: rightBoxX.value - BOX_SIZE / 2,
    top: rightBoxY.value - BOX_SIZE / 2,
  }));

  const leftBoxStyle = useAnimatedStyle(() => ({
    left: leftBoxX.value - BOX_SIZE / 2,
    top: leftBoxY.value - BOX_SIZE / 2,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Reverse Ball Pass"
        emoji="⚽"
        description="Drag the ball from right side to left box!"
        skills={['Bilateral balance']}
        suitableFor="Children learning bilateral balance through reverse ball passing"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xpAwarded={finalStats.xp}
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
            resetBall();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Reverse Ball Pass</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⚽ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Drag the ball from right to left box!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          rightBoxX.value = screenWidth.current * 0.85;
          rightBoxY.value = screenHeight.current * 0.5;
          leftBoxX.value = screenWidth.current * 0.15;
          leftBoxY.value = screenHeight.current * 0.5;
          resetBall();
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.rightBox, rightBoxStyle]}>
              <Text style={styles.boxLabel}>FROM</Text>
            </Animated.View>

            <Animated.View style={[styles.leftBox, leftBoxStyle]}>
              <Text style={styles.boxLabel}>TO</Text>
            </Animated.View>

            <Animated.View style={[styles.ball, ballStyle]}>
              <Text style={styles.ballEmoji}>⚽</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Bilateral balance
        </Text>
        <Text style={styles.footerSubtext}>
          Drag the ball from right side to left box!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 12,
  },
  instruction: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    marginVertical: 40,
  },
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  rightBox: {
    position: 'absolute',
    width: BOX_SIZE,
    height: BOX_SIZE,
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  leftBox: {
    position: 'absolute',
    width: BOX_SIZE,
    height: BOX_SIZE,
    backgroundColor: '#10B981',
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  boxLabel: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
  ball: {
    position: 'absolute',
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  ballEmoji: {
    fontSize: 40,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default ReverseBallPassGame;
