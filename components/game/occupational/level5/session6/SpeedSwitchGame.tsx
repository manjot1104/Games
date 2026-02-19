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

const SpeedSwitchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isFast, setIsFast] = useState(true);
  
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
  const speedX = useRef(3);
  const speedY = useRef(3);
  const switchTimerRef = useRef<NodeJS.Timeout | null>(null);

  const moveBall = useCallback(() => {
    const move = () => {
      'worklet';
      const currentSpeedX = isFast ? 1.5 : 0.6;
      const currentSpeedY = isFast ? 1.5 : 0.6;
      
      const newX = ballX.value + currentSpeedX * directionX.current;
      const newY = ballY.value + currentSpeedY * directionY.current;

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
    }, 30);

    animationRef.current = interval as unknown as number;

    // Switch speed every 2 seconds
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
    }
    switchTimerRef.current = setTimeout(() => {
      setIsFast((prev) => !prev);
      speakTTS(isFast ? 'Slow down!' : 'Speed up!', 0.8, 'en-US' );
    }, 2000);
  }, [isFast, ballX, ballY]);

  const resetBall = useCallback(() => {
    ballX.value = withSpring(Math.random() * (screenWidth.current - BALL_SIZE) + BALL_SIZE / 2);
    ballY.value = withSpring(Math.random() * (screenHeight.current - BALL_SIZE - 200) + BALL_SIZE / 2 + 100);
    directionX.current = Math.random() > 0.5 ? 1 : -1;
    directionY.current = Math.random() > 0.5 ? 1 : -1;
  }, [ballX, ballY]);

  // Store resetBall in ref
  useEffect(() => {
    resetBallRef.current = resetBall;
  }, [resetBall]);

  const handleBallTap = useCallback(() => {
    if (done) return;
    
    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
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
          setIsFast(true);
          if (resetBallRef.current) {
            resetBallRef.current();
          }
        }, 1500);
      }
      return newScore;
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Great adaptation!', 0.9, 'en-US' );
  }, [done, ballScale]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (animationRef.current) {
      clearInterval(animationRef.current);
    }
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'speed-switch',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['adaptability', 'speed-adjustment', 'flexibility'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  // Store endGame in ref
  useEffect(() => {
    endGameRef.current = endGame;
  }, [endGame]);

  useEffect(() => {
    if (!showInfo && !done) {
      // Stop any ongoing TTS when new round starts
      stopTTS();
      setIsFast(true);
      if (resetBallRef.current) {
        resetBallRef.current();
      }
      setTimeout(() => {
        moveBall();
        speakTTS('Watch the speed change!', 0.8, 'en-US' );
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
      if (switchTimerRef.current) {
        clearTimeout(switchTimerRef.current);
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
        title="Speed Switch"
        emoji="🔄"
        description="Ball speed changes from fast to slow! Build adaptability."
        skills={['Adaptability']}
        suitableFor="Children learning to adapt to changing speeds"
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
            setIsFast(true);
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
        <Text style={styles.title}>Speed Switch</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🔄 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {isFast ? '⚡ Fast!' : '🐢 Slow!'}
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
          <Animated.View style={[styles.ball, ballStyle, { backgroundColor: isFast ? '#EF4444' : '#10B981' }]}>
            <Text style={styles.ballEmoji}>⚽</Text>
          </Animated.View>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Adaptability
        </Text>
        <Text style={styles.footerSubtext}>
          Speed changes from fast to slow!
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
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
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

export default SpeedSwitchGame;
