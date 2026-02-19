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
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withSequence,
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HAND_SIZE = 100;
const BALL_SIZE = 50;
const THROW_DURATION = 1000;

const ThrowCatchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [ballState, setBallState] = useState<'left' | 'throwing' | 'right' | 'catching'>('left');
  const [canThrow, setCanThrow] = useState(true);
  const [canCatch, setCanCatch] = useState(false);

  const ballX = useSharedValue(SCREEN_WIDTH * 0.25);
  const ballY = useSharedValue(SCREEN_HEIGHT * 0.4);
  const ballScale = useSharedValue(1);
  const ballRotation = useSharedValue(0);
  const leftHandScale = useSharedValue(1);
  const rightHandScale = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const throwBall = useCallback(() => {
    if (done || !canThrow || ballState !== 'left') return;
    
    setCanThrow(false);
    setBallState('throwing');
    
    // Animate throw arc
    const targetX = SCREEN_WIDTH * 0.75;
    const targetY = SCREEN_HEIGHT * 0.4;
    const midY = SCREEN_HEIGHT * 0.2; // Peak of arc
    
    // Left hand throw animation
    leftHandScale.value = withSequence(
      withSpring(0.9),
      withSpring(1)
    );
    
    // Ball arc animation
    ballX.value = withTiming(targetX, { duration: THROW_DURATION });
    ballY.value = withSequence(
      withTiming(midY, { duration: THROW_DURATION / 2 }),
      withTiming(targetY, { duration: THROW_DURATION / 2 })
    );
    ballRotation.value = withTiming(360, { duration: THROW_DURATION });
    ballScale.value = withSequence(
      withSpring(1.2),
      withSpring(1)
    );
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    speakTTS('Throw!', 0.8, 'en-US' );
    
    setTimeout(() => {
      setBallState('catching');
      setCanCatch(true);
      // Highlight right hand for catching
      rightHandScale.value = withSequence(
        withSpring(1.3),
        withSpring(1.2)
      );
      speakTTS('Catch with right hand!', 0.8, 'en-US' );
      
      // Auto-fail if not caught in time
      setTimeout(() => {
        if (ballState === 'catching') {
          setCanCatch(false);
          setBallState('left');
          ballX.value = SCREEN_WIDTH * 0.25;
          ballY.value = SCREEN_HEIGHT * 0.4;
          ballRotation.value = 0;
          setCanThrow(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          speakTTS('Missed! Try again!', 0.8, 'en-US' );
        }
      }, 2000);
    }, THROW_DURATION);
  }, [done, canThrow, ballState, ballX, ballY, ballRotation, ballScale, leftHandScale, rightHandScale]);

  const catchBall = useCallback(() => {
    if (done || !canCatch || ballState !== 'catching') return;
    
    setCanCatch(false);
    setBallState('right');
    
    // Right hand catch animation
    rightHandScale.value = withSequence(
      withSpring(1.3),
      withSpring(1)
    );
    ballScale.value = withSequence(
      withSpring(0.8),
      withSpring(1)
    );
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect catch!', 0.9, 'en-US' );
    
    setScore((s) => {
      const newScore = s + 1;
      if (newScore >= TOTAL_ROUNDS) {
        setTimeout(() => {
          endGame(newScore);
        }, 1000);
      } else {
        setTimeout(() => {
          setRound((r) => r + 1);
          setBallState('left');
          setCanThrow(true);
          ballX.value = SCREEN_WIDTH * 0.25;
          ballY.value = SCREEN_HEIGHT * 0.4;
          ballRotation.value = 0;
          leftHandScale.value = withSpring(1.2);
          rightHandScale.value = withSpring(1);
        }, 1500);
      }
      return newScore;
    });
  }, [done, canCatch, ballState, ballScale, rightHandScale]);

  const handleLeftHand = useCallback(() => {
    if (ballState === 'left' && canThrow) {
      throwBall();
    }
  }, [ballState, canThrow, throwBall]);

  const handleRightHand = useCallback(() => {
    if (ballState === 'catching' && canCatch) {
      catchBall();
    } else if (ballState === 'throwing') {
      // Too early
      rightHandScale.value = withSequence(
        withSpring(0.8),
        withSpring(1)
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Wait for the ball!', 0.8, 'en-US' );
    }
  }, [ballState, canCatch, catchBall, rightHandScale]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);
    setCanThrow(false);
    setCanCatch(false);

    try {
      await logGameAndAward({
        type: 'throw-catch',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['hand-coordination', 'timing', 'throw-catch'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      setBallState('left');
      setCanThrow(true);
      ballX.value = SCREEN_WIDTH * 0.25;
      ballY.value = SCREEN_HEIGHT * 0.4;
      leftHandScale.value = withSpring(1.2);
      speakTTS('Throw with left hand, catch with right hand!', { rate: 0.8, language: 'en-US' });
    }
  }, [showInfo, round, done, ballX, ballY, leftHandScale]);

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
    transform: [
      { scale: ballScale.value },
      { rotate: `${ballRotation.value}deg` },
    ],
  }));

  const leftHandStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftHandScale.value }],
  }));

  const rightHandStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightHandScale.value }],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Throw & Catch"
        emoji="🎾"
        description="Left throw → right catch - hand coordination!"
        skills={['Hand coordination']}
        suitableFor="Children learning hand coordination through throw and catch"
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
            setBallState('left');
            setCanThrow(true);
            ballX.value = SCREEN_WIDTH * 0.25;
            ballY.value = SCREEN_HEIGHT * 0.4;
            ballRotation.value = 0;
            leftHandScale.value = withSpring(1.2);
            rightHandScale.value = withSpring(1);
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
        <Text style={styles.title}>Throw & Catch</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎾 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {ballState === 'left' ? 'Tap LEFT to throw!' : 
           ballState === 'throwing' ? 'Ball is flying...' :
           ballState === 'catching' ? 'Tap RIGHT to catch!' : 'Ball caught!'}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          ballX.value = screenWidth.current * 0.25;
          ballY.value = screenHeight.current * 0.4;
        }}
      >
        <View style={styles.handsContainer}>
          <TouchableOpacity
            style={styles.handWrapper}
            onPress={handleLeftHand}
            activeOpacity={0.8}
            disabled={!canThrow || ballState !== 'left'}
          >
            <Animated.View style={[styles.hand, styles.leftHand, leftHandStyle]}>
              <Text style={styles.handEmoji}>👈</Text>
              <Text style={styles.handLabel}>THROW</Text>
              {ballState === 'left' && (
                <View style={styles.ballIndicator}>
                  <Text style={styles.ballEmoji}>⚽</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.handWrapper}
            onPress={handleRightHand}
            activeOpacity={0.8}
            disabled={!canCatch || ballState !== 'catching'}
          >
            <Animated.View style={[styles.hand, styles.rightHand, rightHandStyle]}>
              <Text style={styles.handEmoji}>👉</Text>
              <Text style={styles.handLabel}>CATCH</Text>
              {ballState === 'right' && (
                <View style={styles.ballIndicator}>
                  <Text style={styles.ballEmoji}>⚽</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>
        </View>

        {(ballState === 'throwing' || ballState === 'catching') && (
          <Animated.View style={[styles.ball, ballStyle]}>
            <Text style={styles.ballEmojiLarge}>⚽</Text>
          </Animated.View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Hand coordination
        </Text>
        <Text style={styles.footerSubtext}>
          Throw with left hand, catch with right hand!
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
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
    position: 'relative',
  },
  handsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  handWrapper: {
    width: HAND_SIZE,
    height: HAND_SIZE,
  },
  hand: {
    width: HAND_SIZE,
    height: HAND_SIZE,
    borderRadius: HAND_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    position: 'relative',
  },
  leftHand: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightHand: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  handEmoji: {
    fontSize: 40,
    marginBottom: 5,
  },
  handLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
  },
  ballIndicator: {
    position: 'absolute',
    top: -15,
    backgroundColor: '#F59E0B',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ballEmoji: {
    fontSize: 20,
  },
  ball: {
    position: 'absolute',
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  ballEmojiLarge: {
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

export default ThrowCatchGame;
