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
const TARGET_SIZE = 100;
const OBSTACLE_SIZE = 120;
const TOLERANCE = 60;

const ObstaclePassGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const ballX = useSharedValue(SCREEN_WIDTH * 0.2);
  const ballY = useSharedValue(SCREEN_HEIGHT * 0.7);
  const ballScale = useSharedValue(1);
  const targetX = useSharedValue(SCREEN_WIDTH * 0.8);
  const targetY = useSharedValue(SCREEN_HEIGHT * 0.3);
  const targetScale = useSharedValue(1);
  const obstacleX = useSharedValue(SCREEN_WIDTH * 0.5);
  const obstacleY = useSharedValue(SCREEN_HEIGHT * 0.5);
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

      // Check if ball hit obstacle
      const obstacleDistance = Math.sqrt(
        Math.pow(ballX.value - obstacleX.value, 2) + Math.pow(ballY.value - obstacleY.value, 2)
      );

      if (obstacleDistance <= OBSTACLE_SIZE / 2) {
        // Hit obstacle - reset
        resetBall();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Hit obstacle! Go around it!', 0.8, 'en-US' );
        return;
      }

      // Check if reached target
      const targetDistance = Math.sqrt(
        Math.pow(ballX.value - targetX.value, 2) + Math.pow(ballY.value - targetY.value, 2)
      );

      if (targetDistance <= TOLERANCE) {
        // Success! Passed obstacle and reached target
        targetScale.value = withSpring(1.3);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect! You avoided the obstacle!', 0.9, 'en-US' );
        
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              resetRound();
            }, 1500);
          }
          return newScore;
        });
      } else {
        // Missed target - reset
        resetBall();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        speakTTS('Drag around the obstacle to the target!', 0.8, 'en-US' );
      }
    });

  const resetRound = useCallback(() => {
    // Randomize obstacle and target positions
    const newObstacleX = SCREEN_WIDTH * (0.4 + Math.random() * 0.2);
    const newObstacleY = SCREEN_HEIGHT * (0.4 + Math.random() * 0.2);
    obstacleX.value = newObstacleX;
    obstacleY.value = newObstacleY;
    
    const newTargetX = SCREEN_WIDTH * (0.7 + Math.random() * 0.2);
    const newTargetY = SCREEN_HEIGHT * (0.2 + Math.random() * 0.3);
    targetX.value = newTargetX;
    targetY.value = newTargetY;
    targetScale.value = withSpring(1);
    resetBall();
  }, [obstacleX, obstacleY, targetX, targetY, targetScale]);

  const resetBall = useCallback(() => {
    ballX.value = withSpring(SCREEN_WIDTH * 0.2);
    ballY.value = withSpring(SCREEN_HEIGHT * 0.7);
  }, [ballX, ballY]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'obstacle-pass',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['planning-skill', 'obstacle-avoidance', 'midline-crossing'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetRound();
      speakTTS('Pass the ball around the obstacle to the target!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, resetRound]);

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

  const targetStyle = useAnimatedStyle(() => ({
    left: targetX.value - TARGET_SIZE / 2,
    top: targetY.value - TARGET_SIZE / 2,
    transform: [{ scale: targetScale.value }],
  }));

  const obstacleStyle = useAnimatedStyle(() => ({
    left: obstacleX.value - OBSTACLE_SIZE / 2,
    top: obstacleY.value - OBSTACLE_SIZE / 2,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Obstacle Pass"
        emoji="🚧"
        description="Obstacle ke upar se pass - planning skill!"
        skills={['Planning skill']}
        suitableFor="Children learning planning skills through obstacle avoidance"
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
            resetRound();
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
        <Text style={styles.title}>Obstacle Pass</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🚧 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Drag ball around obstacle to target!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.obstacle, obstacleStyle]}>
              <Text style={styles.obstacleEmoji}>🚧</Text>
              <Text style={styles.obstacleLabel}>AVOID</Text>
            </Animated.View>

            <Animated.View style={[styles.target, targetStyle]}>
              <Text style={styles.targetEmoji}>🎯</Text>
              <Text style={styles.targetLabel}>TARGET</Text>
            </Animated.View>

            <Animated.View style={[styles.ball, ballStyle]}>
              <Text style={styles.ballEmoji}>⚽</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Planning skill
        </Text>
        <Text style={styles.footerSubtext}>
          Plan your path around the obstacle!
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
    color: '#F59E0B',
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
  obstacle: {
    position: 'absolute',
    width: OBSTACLE_SIZE,
    height: OBSTACLE_SIZE,
    borderRadius: OBSTACLE_SIZE / 2,
    backgroundColor: '#EF4444',
    borderWidth: 4,
    borderColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  obstacleEmoji: {
    fontSize: 60,
    marginBottom: 5,
  },
  obstacleLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  target: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: '#10B981',
    borderWidth: 4,
    borderColor: '#059669',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  targetEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  targetLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
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

export default ObstaclePassGame;
