import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const TOTAL_ROUNDS = 8;
const BIG_THROW_THRESHOLD = 200; // pixels for big throw
const SMALL_THROW_THRESHOLD = 80; // pixels for small throw

type ThrowType = 'big' | 'small';

const BigThrowSmallThrowGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentTarget, setCurrentTarget] = useState<ThrowType>('big');
  const [isDragging, setIsDragging] = useState(false);

  const ballX = useSharedValue(50);
  const ballY = useSharedValue(70);
  const startX = useSharedValue(50);
  const startY = useSharedValue(70);
  const dragStartX = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const sparkleX = useRef(new Animated.Value(0)).current;
  const sparkleY = useRef(new Animated.Value(0)).current;

  const screenWidth = useRef(400);
  const screenHeight = useRef(600);

  // Define endGame before it's used in panGesture
  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 18;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsDragging(false);
    ballX.value = startX.value;
    ballY.value = startY.value;

    try {
      const timestamp = new Date().toISOString();
      await logGameAndAward({
        gameId: 'big-throw-small-throw',
        therapyId: 'occupational',
        levelNumber: 3,
        sessionNumber: 2,
        score,
        totalRounds: total,
        accuracy,
        xp,
        timestamp,
      });
      await recordGame({
        gameId: 'big-throw-small-throw',
        therapyId: 'occupational',
        levelNumber: 3,
        sessionNumber: 2,
        score,
        totalRounds: total,
        accuracy,
        xp,
        timestamp,
      });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, ballX, ballY, startX, startY]);

  // Start new round
  useEffect(() => {
    if (done) return;
    const target: ThrowType = Math.random() > 0.5 ? 'big' : 'small';
    setCurrentTarget(target);
    ballX.value = 50;
    ballY.value = 70;
    startX.value = 50;
    startY.value = 70;
    setIsDragging(false);
    if (round === 1) {
      speakTTS('Drag to throw object far vs near! Long drag = far, short drag = near.', { rate: 0.9 });
    } else {
      speakTTS(target === 'big' ? 'Throw it FAR!' : 'Throw it NEAR!', 0.9 );
    }
  }, [round, done, ballX, ballY, startX, startY]);

  useEffect(() => {
    return () => {
      // Cleanup: Stop all sounds and speech when component unmounts
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
    };
  }, []);

  const animatedBallStyle = useAnimatedStyle(() => ({
    left: `${ballX.value}%`,
    top: `${ballY.value}%`,
    transform: [{ translateX: -25 }, { translateY: -25 }],
  }));

  const panGesture = Gesture.Pan()
    .onStart((evt) => {
      if (done) return;
      setIsDragging(true);
      const screenX = (evt.x / screenWidth.current) * 100;
      const screenY = (evt.y / screenHeight.current) * 100;
      dragStartX.value = screenX;
      dragStartY.value = screenY;
    })
    .onUpdate((evt) => {
      if (!isDragging || done) return;
      const screenX = (evt.x / screenWidth.current) * 100;
      const screenY = (evt.y / screenHeight.current) * 100;
      ballX.value = screenX;
      ballY.value = screenY;
    })
    .onEnd((evt) => {
      if (!isDragging || done) return;
      const screenX = (evt.x / screenWidth.current) * 100;
      const screenY = (evt.y / screenHeight.current) * 100;
      const deltaX = Math.abs(screenX - dragStartX.value) * (screenWidth.current / 100);
      const deltaY = Math.abs(screenY - dragStartY.value) * (screenHeight.current / 100);
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      let correct = false;
      if (currentTarget === 'big' && distance >= BIG_THROW_THRESHOLD) {
        correct = true;
      } else if (currentTarget === 'small' && distance >= SMALL_THROW_THRESHOLD && distance < BIG_THROW_THRESHOLD) {
        correct = true;
      }

      if (correct) {
        setScore((s) => s + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        sparkleX.setValue(ballX.value);
        sparkleY.setValue(ballY.value);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }

      setIsDragging(false);
      ballX.value = withSpring(startX.value);
      ballY.value = withSpring(startY.value);

      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
        } else {
          endGame();
        }
      }, 1000);
    });

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xp={finalStats.xp}
          onBack={onBack}
          onRetry={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            setIsDragging(false);
            ballX.value = 50;
            ballY.value = 70;
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            try {
              stopTTS();
            } catch (e) {
              // Ignore errors
            }
            if (onBack) onBack();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Big Throw vs Small Throw</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {currentTarget === 'big' ? '⚾ Throw it FAR!' : '⚾ Throw it NEAR!'}
          </Text>

          <View
            style={styles.throwArea}
            onLayout={(e) => {
              screenWidth.current = e.nativeEvent.layout.width;
              screenHeight.current = e.nativeEvent.layout.height;
            }}
          >
            <GestureDetector gesture={panGesture}>
              <Animated.View style={styles.throwArea}>
                <Animated.View style={[styles.ball, animatedBallStyle]}>
                  <Text style={styles.ballEmoji}>⚾</Text>
                </Animated.View>
                <View style={[styles.startPoint, { left: `${startX.value}%`, top: `${startY.value}%` }]} />
                <SparkleBurst x={sparkleX} y={sparkleY} />
              </Animated.View>
            </GestureDetector>
          </View>

          <Text style={styles.hintText}>
            {isDragging ? 'Release to throw!' : 'Drag the ball to throw it'}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    padding: 8,
  },
  backText: {
    fontSize: 16,
    color: '#3B82F6',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    flex: 1,
    textAlign: 'center',
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  scoreText: {
    fontSize: 14,
    color: '#6B7280',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  gameArea: {
    flex: 1,
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 18,
    color: '#374151',
    textAlign: 'center',
    marginBottom: 16,
    fontWeight: '600',
  },
  throwArea: {
    width: '100%',
    height: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  ball: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  ballEmoji: {
    fontSize: 30,
  },
  startPoint: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#22C55E',
    transform: [{ translateX: -10 }, { translateY: -10 }],
    borderWidth: 3,
    borderColor: '#FFFFFF',
    zIndex: 10,
  },
  hintText: {
    marginTop: 16,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
});

export default BigThrowSmallThrowGame;

