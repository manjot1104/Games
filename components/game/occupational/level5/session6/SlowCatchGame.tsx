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
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BALL_SIZE = 60;
const TOLERANCE = 50;
const SLOW_SPEED = 2000; // milliseconds for one cycle

const SlowCatchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const ballX = useSharedValue(SCREEN_WIDTH * 0.5);
  const ballY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const ballScale = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const animationRef = useRef<number | null>(null);
  const endGameRef = useRef<((finalScore: number) => Promise<void>) | null>(null);
  const resetBallRef = useRef<(() => void) | null>(null);
  const directionX = useRef(1);
  const directionY = useRef(1);
  const speedX = useRef(1);
  const speedY = useRef(1);

  const moveBall = useCallback(() => {
    const move = () => {
      'worklet';
      const newX = ballX.value + speedX.current * directionX.current;
      const newY = ballY.value + speedY.current * directionY.current;

      // Bounce off walls
      if (newX <= BALL_SIZE / 2 || newX >= screenWidth.current - BALL_SIZE / 2) {
        directionX.current *= -1;
        ballX.value = Math.max(BALL_SIZE / 2, Math.min(screenWidth.current - BALL_SIZE / 2, newX));
      } else {
        ballX.value = newX;
      }

      if (newY <= BALL_SIZE / 2 + 100 || newY >= screenHeight.current - BALL_SIZE / 2 - 100) {
        directionY.current *= -1;
        ballY.value = Math.max(BALL_SIZE / 2 + 100, Math.min(screenHeight.current - BALL_SIZE / 2 - 100, newY));
      } else {
        ballY.value = newY;
      }
    };

    const interval = setInterval(() => {
      move();
    }, 16); // ~60fps

    animationRef.current = interval as unknown as number;
  }, []);

  const resetBall = useCallback(() => {
    // Random starting position
    ballX.value = withSpring(Math.random() * (screenWidth.current - BALL_SIZE) + BALL_SIZE / 2);
    ballY.value = withSpring(Math.random() * (screenHeight.current - BALL_SIZE - 200) + BALL_SIZE / 2 + 100);
    
    // Random direction
    directionX.current = Math.random() > 0.5 ? 1 : -1;
    directionY.current = Math.random() > 0.5 ? 1 : -1;
    
    // Slow speed
    speedX.current = 0.5 + Math.random() * 0.5;
    speedY.current = 0.5 + Math.random() * 0.5;
  }, [ballX, ballY]);

  // Store resetBall in ref
  useEffect(() => {
    resetBallRef.current = resetBall;
  }, [resetBall]);

  const handleBallTap = useCallback(() => {
    if (done) return;
    
    // Success!
    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }

    ballScale.value = withSpring(1.5, {}, () => {
      ballScale.value = withSpring(1);
    });

    setScore((s) => {
      const newScore = s + 1;
      if (newScore >= TOTAL_ROUNDS) {
        setTimeout(() => {
          if (endGameRef.current) {
            endGameRef.current(newScore);
          }
        }, 1000);
      } else {
        setTimeout(() => {
          setRound((r) => r + 1);
          if (resetBallRef.current) {
            resetBallRef.current();
          }
        }, 1500);
      }
      return newScore;
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Slow and steady!', 0.9, 'en-US' );
  }, [done, ballScale]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'slow-catch',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['controlled-timing', 'precision', 'slow-motor-control'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    endGameRef.current = endGame;
  }, [endGame]);

  useEffect(() => {
    if (!showInfo && !done) {
      // Stop any ongoing TTS when new round starts
      stopTTS();
      if (resetBallRef.current) {
        resetBallRef.current();
      }
      setTimeout(() => {
        moveBall();
        speakTTS('Catch the slow ball!', 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, round, done, moveBall]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, []);

  const ballStyle = useAnimatedStyle(() => ({
    left: ballX.value - BALL_SIZE / 2,
    top: ballY.value - BALL_SIZE / 2,
    transform: [{ scale: ballScale.value }],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Slow Catch"
        emoji="🐢"
        description="Tap the slow moving ball! Build controlled timing."
        skills={['Controlled timing']}
        suitableFor="Children learning controlled movements and precision"
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
            if (resetBallRef.current) {
              resetBallRef.current();
            }
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
        <Text style={styles.title}>Slow Catch</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🐢 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Catch the slow ball!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <Pressable onPress={handleBallTap}>
          <Animated.View style={[styles.ball, ballStyle]}>
            <Text style={styles.ballEmoji}>⚽</Text>
          </Animated.View>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Controlled timing
        </Text>
        <Text style={styles.footerSubtext}>
          Tap the slow moving ball!
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
  ball: {
    position: 'absolute',
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#10B981',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  ballEmoji: {
    fontSize: 35,
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

export default SlowCatchGame;
