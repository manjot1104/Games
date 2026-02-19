import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS, DEFAULT_TTS_RATE } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BALL_SIZE = 80;
const BALL_SPEED = 800; // milliseconds to cross

type Side = 'left' | 'right';

// Use shared TTS utility (speech-to-speech on web, expo-speech on native)
// Safe speech helper
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

const PingPongTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [ballSide, setBallSide] = useState<Side | null>(null);
  const [hasTapped, setHasTapped] = useState(false);

  const ballX = useRef(new Animated.Value(SCREEN_WIDTH / 2)).current;
  const ballY = useRef(new Animated.Value(SCREEN_HEIGHT * 0.4)).current;
  const ballScale = useRef(new Animated.Value(1)).current;
  const ballOpacity = useRef(new Animated.Value(0)).current;
  const leftTargetScale = useRef(new Animated.Value(1)).current;
  const rightTargetScale = useRef(new Animated.Value(1)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  const showBall = useCallback(() => {
    // Randomly choose starting side
    const startSide: Side = Math.random() < 0.5 ? 'left' : 'right';
    setBallSide(startSide);
    setHasTapped(false);
    
    // Position ball at starting side
    const startX = startSide === 'left' ? -BALL_SIZE : SCREEN_WIDTH + BALL_SIZE;
    ballX.setValue(startX);
    ballY.setValue(SCREEN_HEIGHT * 0.4);
    ballScale.setValue(1);
    ballOpacity.setValue(0);
    
    // Fade in
    Animated.timing(ballOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    
    // Move ball to opposite side
    const endX = startSide === 'left' ? SCREEN_WIDTH + BALL_SIZE : -BALL_SIZE;
    
    const moveAnimation = Animated.timing(ballX, {
      toValue: endX,
      duration: BALL_SPEED,
      useNativeDriver: true,
    });
    
    animationRef.current = moveAnimation;
    moveAnimation.start((finished) => {
      if (finished && !hasTapped) {
        // Ball passed without being tapped
        handleMiss();
      }
    });
    
    speak(`Ball coming from ${startSide}! Tap when it reaches the center!`);
  }, [ballX, ballY, ballOpacity, ballScale, hasTapped]);

  const handleLeftTap = useCallback(() => {
    if (done || !ballSide || hasTapped) return;
    
    // Check if ball is near center (within reasonable range)
    const currentX = (ballX as any)._value;
    const centerX = SCREEN_WIDTH / 2;
    const tolerance = SCREEN_WIDTH * 0.2; // 20% tolerance
    
    if (Math.abs(currentX - centerX) <= tolerance) {
      handleSuccess('left');
    } else {
      handleWrong();
    }
  }, [done, ballSide, hasTapped, ballX]);

  const handleRightTap = useCallback(() => {
    if (done || !ballSide || hasTapped) return;
    
    // Check if ball is near center
    const currentX = (ballX as any)._value;
    const centerX = SCREEN_WIDTH / 2;
    const tolerance = SCREEN_WIDTH * 0.2;
    
    if (Math.abs(currentX - centerX) <= tolerance) {
      handleSuccess('right');
    } else {
      handleWrong();
    }
  }, [done, ballSide, hasTapped, ballX]);

  const handleSuccess = useCallback((side: Side) => {
    setHasTapped(true);
    setScore((s) => s + 1);
    
    if (animationRef.current) {
      animationRef.current.stop();
    }
    
    const targetScale = side === 'left' ? leftTargetScale : rightTargetScale;
    
    Animated.sequence([
      Animated.timing(targetScale, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(targetScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
    
    // Ball bounce effect
    Animated.sequence([
      Animated.timing(ballScale, {
        toValue: 1.5,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.parallel([
        Animated.timing(ballOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(ballScale, {
          toValue: 0.5,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speak('Great tap!');
    
    setTimeout(() => {
      setBallSide(null);
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        showBall();
      } else {
        endGame();
      }
    }, 1000);
  }, [round, leftTargetScale, rightTargetScale, ballScale, ballOpacity, showBall]);

  const handleWrong = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speak('Wait for the ball to reach center!');
    
    // Shake ball
    Animated.sequence([
      Animated.timing(ballScale, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(ballScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [ballScale]);

  const handleMiss = useCallback(() => {
    if (hasTapped) return;
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    speak('Missed! Try again!');
    
    ballOpacity.setValue(0);
    setBallSide(null);
    
    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        showBall();
      } else {
        endGame();
      }
    }, 1000);
  }, [hasTapped, round, ballOpacity, showBall]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setBallSide(null);
    
    if (animationRef.current) {
      animationRef.current.stop();
    }

    try {
      await logGameAndAward({
        type: 'ping-pong-tap',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['focus', 'alternating-sides', 'timing', 'visual-motor'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      setTimeout(() => {
        showBall();
      }, 500);
    }
  }, [showInfo, round, done, showBall]);

  useEffect(() => {
    return () => {
      if (animationRef.current) {
        animationRef.current.stop();
      }
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Ping-Pong Tap"
        emoji="🏓"
        description="Ball idhar-udhar tap! Focus on the moving ball!"
        skills={['Focus', 'Alternating sides', 'Timing']}
        suitableFor="Children learning to focus on moving objects and alternating side tapping"
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
            setBallSide(null);
            ballOpacity.setValue(0);
            ballScale.setValue(1);
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
        <Text style={styles.title}>Ping-Pong Tap</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {ballSide ? 'Tap when ball reaches center!' : 'Wait for ball...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {ballSide && (
          <Animated.View
            style={[
              styles.ball,
              {
                transform: [
                  { translateX: ballX },
                  { translateY: ballY },
                  { scale: ballScale },
                ],
                opacity: ballOpacity,
              },
            ]}
          >
            <Text style={styles.ballEmoji}>🏓</Text>
          </Animated.View>
        )}

        <View style={styles.targetsContainer}>
          <TouchableOpacity
            style={styles.targetButton}
            onPress={handleLeftTap}
            activeOpacity={0.8}
          >
            <Animated.View
              style={[
                styles.target,
                styles.leftTarget,
                { transform: [{ scale: leftTargetScale }] },
              ]}
            >
              <Text style={styles.targetEmoji}>👈</Text>
              <Text style={styles.targetLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.targetButton}
            onPress={handleRightTap}
            activeOpacity={0.8}
          >
            <Animated.View
              style={[
                styles.target,
                styles.rightTarget,
                { transform: [{ scale: rightTargetScale }] },
              ]}
            >
              <Text style={styles.targetEmoji}>👉</Text>
              <Text style={styles.targetLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Focus • Alternating sides • Timing
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
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '700',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  ball: {
    position: 'absolute',
    width: BALL_SIZE,
    height: BALL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballEmoji: {
    fontSize: 60,
  },
  targetsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
    marginTop: 200,
  },
  targetButton: {
    width: 140,
    height: 140,
  },
  target: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftTarget: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightTarget: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  targetEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  targetLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
});

export default PingPongTapGame;
