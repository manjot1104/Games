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
const HAND_SIZE = 120;
const BALL_SIZE = 60;
const PASS_DURATION = 800; // Animation duration

const HandToHandPassGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [ballPosition, setBallPosition] = useState<'left' | 'right' | 'moving'>('left');
  const [canPass, setCanPass] = useState(true);

  const ballX = useSharedValue(SCREEN_WIDTH * 0.25);
  const ballY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const ballScale = useSharedValue(1);
  const leftHandScale = useSharedValue(1);
  const rightHandScale = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const passBall = useCallback((from: 'left' | 'right') => {
    if (done || !canPass || ballPosition !== from) return;
    
    setCanPass(false);
    setBallPosition('moving');
    
    const targetX = from === 'left' ? SCREEN_WIDTH * 0.75 : SCREEN_WIDTH * 0.25;
    const targetY = SCREEN_HEIGHT * 0.5;
    
    // Animate ball movement
    ballX.value = withTiming(targetX, { duration: PASS_DURATION });
    ballY.value = withTiming(targetY, { duration: PASS_DURATION });
    ballScale.value = withSequence(
      withSpring(1.3),
      withSpring(1)
    );
    
    // Hand animations
    if (from === 'left') {
      leftHandScale.value = withSequence(
        withSpring(0.9),
        withSpring(1)
      );
    } else {
      rightHandScale.value = withSequence(
        withSpring(0.9),
        withSpring(1)
      );
    }
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    setTimeout(() => {
      const newPosition = from === 'left' ? 'right' : 'left';
      setBallPosition(newPosition);
      setCanPass(true);
      
      // Highlight receiving hand
      if (newPosition === 'right') {
        rightHandScale.value = withSequence(
          withSpring(1.2),
          withSpring(1)
        );
        speakTTS('Now pass to left!', 0.8, 'en-US' );
      } else {
        leftHandScale.value = withSequence(
          withSpring(1.2),
          withSpring(1)
        );
        speakTTS('Now pass to right!', 0.8, 'en-US' );
      }
      
      // Check if round complete (passed back and forth)
      if (newPosition === 'left' && from === 'right') {
        // Completed one full cycle
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              setBallPosition('left');
              ballX.value = SCREEN_WIDTH * 0.25;
              ballY.value = SCREEN_HEIGHT * 0.5;
              leftHandScale.value = withSpring(1.2);
              rightHandScale.value = withSpring(1);
            }, 1500);
          }
          return newScore;
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect pass!', 0.9, 'en-US' );
      }
    }, PASS_DURATION);
  }, [done, canPass, ballPosition, ballX, ballY, ballScale, leftHandScale, rightHandScale]);

  const handleLeftHand = useCallback(() => {
    if (ballPosition === 'left' && canPass) {
      passBall('left');
    } else if (ballPosition === 'right') {
      // Wrong hand
      leftHandScale.value = withSequence(
        withSpring(0.8),
        withSpring(1)
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Ball is in right hand!', 0.8, 'en-US' );
    }
  }, [ballPosition, canPass, passBall, leftHandScale]);

  const handleRightHand = useCallback(() => {
    if (ballPosition === 'right' && canPass) {
      passBall('right');
    } else if (ballPosition === 'left') {
      // Wrong hand
      rightHandScale.value = withSequence(
        withSpring(0.8),
        withSpring(1)
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Ball is in left hand!', 0.8, 'en-US' );
    }
  }, [ballPosition, canPass, passBall, rightHandScale]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);
    setCanPass(false);

    try {
      await logGameAndAward({
        type: 'hand-to-hand-pass',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['midline-awareness', 'hand-coordination', 'ball-pass'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      setBallPosition('left');
      ballX.value = SCREEN_WIDTH * 0.25;
      ballY.value = SCREEN_HEIGHT * 0.5;
      leftHandScale.value = withSpring(1.2);
      speakTTS('Pass ball from left hand to right hand!', 0.8, 'en-US' );
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
    transform: [{ scale: ballScale.value }],
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
        title="Hand-to-Hand Pass"
        emoji="🤲"
        description="Ball left hand → right hand - midline awareness!"
        skills={['Midline awareness']}
        suitableFor="Children learning midline awareness through hand-to-hand ball passing"
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
            setBallPosition('left');
            setCanPass(true);
            ballX.value = SCREEN_WIDTH * 0.25;
            ballY.value = SCREEN_HEIGHT * 0.5;
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
        <Text style={styles.title}>Hand-to-Hand Pass</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🤲 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {ballPosition === 'left' ? 'Tap LEFT hand to pass!' : ballPosition === 'right' ? 'Tap RIGHT hand to pass!' : 'Ball is moving...'}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          ballX.value = screenWidth.current * 0.25;
          ballY.value = screenHeight.current * 0.5;
        }}
      >
        <View style={styles.handsContainer}>
          <TouchableOpacity
            style={styles.handWrapper}
            onPress={handleLeftHand}
            activeOpacity={0.8}
            disabled={!canPass || ballPosition === 'moving'}
          >
            <Animated.View style={[styles.hand, styles.leftHand, leftHandStyle]}>
              <Text style={styles.handEmoji}>👈</Text>
              <Text style={styles.handLabel}>LEFT</Text>
              {ballPosition === 'left' && (
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
            disabled={!canPass || ballPosition === 'moving'}
          >
            <Animated.View style={[styles.hand, styles.rightHand, rightHandStyle]}>
              <Text style={styles.handEmoji}>👉</Text>
              <Text style={styles.handLabel}>RIGHT</Text>
              {ballPosition === 'right' && (
                <View style={styles.ballIndicator}>
                  <Text style={styles.ballEmoji}>⚽</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>
        </View>

        {ballPosition === 'moving' && (
          <Animated.View style={[styles.ball, ballStyle]}>
            <Text style={styles.ballEmojiLarge}>⚽</Text>
          </Animated.View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Midline awareness
        </Text>
        <Text style={styles.footerSubtext}>
          Pass ball from left hand to right hand!
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
    fontSize: 50,
    marginBottom: 5,
  },
  handLabel: {
    fontSize: 14,
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

export default HandToHandPassGame;
