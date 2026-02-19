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
const BEAT_INTERVAL = 1500; // 1.5 seconds per beat
const PASSES_PER_ROUND = 4; // 4 passes per round

const RhythmPassGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [passCount, setPassCount] = useState(0);
  const [ballPosition, setBallPosition] = useState<'left' | 'right'>('left');
  const [waitingForBeat, setWaitingForBeat] = useState(false);
  const [canPass, setCanPass] = useState(false);

  const ballX = useSharedValue(SCREEN_WIDTH * 0.25);
  const ballY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const ballScale = useSharedValue(1);
  const leftHandScale = useSharedValue(1);
  const rightHandScale = useSharedValue(1);
  const beatIndicator = useSharedValue(0);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const beatTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerBeat = useCallback(() => {
    if (done || passCount >= PASSES_PER_ROUND) return;
    
    setWaitingForBeat(true);
    setCanPass(true);
    
    // Visual beat indicator
    beatIndicator.value = withSequence(
      withTiming(1, { duration: 200 }),
      withTiming(0, { duration: 1300 })
    );
    
    // Highlight the hand that should pass
    if (ballPosition === 'left') {
      leftHandScale.value = withSequence(
        withSpring(1.3),
        withSpring(1)
      );
    } else {
      rightHandScale.value = withSequence(
        withSpring(1.3),
        withSpring(1)
      );
    }
    
    speakTTS('Pass!', 0.8, 'en-US' );
    
    // Auto-advance if missed
    beatTimerRef.current = setTimeout(() => {
      if (canPass && waitingForBeat) {
        // Missed the beat
        setCanPass(false);
        setWaitingForBeat(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        speakTTS('Missed beat! Try again!', 0.8, 'en-US' );
        
        // Reset round
        setTimeout(() => {
          setPassCount(0);
          setBallPosition('left');
          ballX.value = SCREEN_WIDTH * 0.25;
          triggerBeat();
        }, 1000);
      }
    }, BEAT_INTERVAL) as unknown as NodeJS.Timeout;
  }, [done, passCount, ballPosition, canPass, waitingForBeat, beatIndicator, leftHandScale, rightHandScale, ballX]);

  const passBall = useCallback(() => {
    if (done || !canPass || !waitingForBeat) return;
    
    if (beatTimerRef.current) {
      clearTimeout(beatTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      beatTimerRef.current = null;
    }
    
    setCanPass(false);
    setWaitingForBeat(false);
    
    const targetX = ballPosition === 'left' ? SCREEN_WIDTH * 0.75 : SCREEN_WIDTH * 0.25;
    const newPosition = ballPosition === 'left' ? 'right' : 'left';
    
    // Animate pass
    ballX.value = withTiming(targetX, { duration: 400 });
    ballScale.value = withSequence(
      withSpring(1.3),
      withSpring(1)
    );
    
    // Hand animations
    if (ballPosition === 'left') {
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
      setBallPosition(newPosition);
      const newCount = passCount + 1;
      setPassCount(newCount);
      
      if (newCount >= PASSES_PER_ROUND) {
        // Round complete!
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              setPassCount(0);
              setBallPosition('left');
              ballX.value = SCREEN_WIDTH * 0.25;
              triggerBeat();
            }, 1500);
          }
          return newScore;
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Perfect rhythm!', 0.9, 'en-US' );
      } else {
        // Continue to next beat
        setTimeout(() => {
          triggerBeat();
        }, BEAT_INTERVAL - 400);
      }
    }, 400);
  }, [done, canPass, waitingForBeat, ballPosition, passCount, ballX, ballScale, leftHandScale, rightHandScale, triggerBeat]);

  const handleLeftHand = useCallback(() => {
    if (ballPosition === 'left' && canPass) {
      passBall();
    }
  }, [ballPosition, canPass, passBall]);

  const handleRightHand = useCallback(() => {
    if (ballPosition === 'right' && canPass) {
      passBall();
    }
  }, [ballPosition, canPass, passBall]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);
    setWaitingForBeat(false);
    setCanPass(false);

    if (beatTimerRef.current) {
      clearTimeout(beatTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      beatTimerRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'rhythm-pass',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['timing', 'flow', 'rhythm', 'midline-crossing'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      setPassCount(0);
      setBallPosition('left');
      ballX.value = SCREEN_WIDTH * 0.25;
      setTimeout(() => {
        triggerBeat();
        speakTTS('Pass with the rhythm!', 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, round, done, ballX, triggerBeat]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (beatTimerRef.current) {
        clearTimeout(beatTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      }
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

  const beatStyle = useAnimatedStyle(() => ({
    opacity: beatIndicator.value,
    transform: [{ scale: 0.5 + beatIndicator.value * 0.5 }],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Rhythm Pass"
        emoji="🎵"
        description="Music ke sath pass - timing + flow!"
        skills={['Timing', 'Flow']}
        suitableFor="Children learning timing and flow through rhythm-based ball passing"
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
            setPassCount(0);
            setBallPosition('left');
            ballX.value = SCREEN_WIDTH * 0.25;
            triggerBeat();
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
        <Text style={styles.title}>Rhythm Pass</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎵 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {waitingForBeat ? `Pass ${ballPosition === 'left' ? 'LEFT' : 'RIGHT'}! (${passCount + 1}/${PASSES_PER_ROUND})` : 'Get ready...'}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          ballX.value = screenWidth.current * 0.25;
        }}
      >
        {waitingForBeat && (
          <Animated.View style={[styles.beatIndicator, beatStyle]}>
            <Text style={styles.beatText}>🎵 BEAT! 🎵</Text>
          </Animated.View>
        )}

        <View style={styles.handsContainer}>
          <TouchableOpacity
            style={styles.handWrapper}
            onPress={handleLeftHand}
            activeOpacity={0.8}
            disabled={!canPass || ballPosition !== 'left'}
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
            disabled={!canPass || ballPosition !== 'right'}
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

        <Animated.View style={[styles.ball, ballStyle]}>
          <Text style={styles.ballEmojiLarge}>⚽</Text>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Timing • Flow
        </Text>
        <Text style={styles.footerSubtext}>
          Pass with the rhythm!
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
    color: '#8B5CF6',
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
  beatIndicator: {
    position: 'absolute',
    top: 50,
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    zIndex: 5,
  },
  beatText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
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

export default RhythmPassGame;
