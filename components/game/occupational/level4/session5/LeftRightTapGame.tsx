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
const TARGET_SIZE = 120;
const SEQUENCE_LENGTH = 5; // 5 taps per round (alternating)

const LeftRightTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [expectedHand, setExpectedHand] = useState<'left' | 'right'>('left');
  const [sequence, setSequence] = useState<('left' | 'right')[]>([]);

  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const leftOpacity = useSharedValue(1);
  const rightOpacity = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const generateSequence = useCallback(() => {
    const seq: ('left' | 'right')[] = [];
    let current = 'left' as 'left' | 'right';
    for (let i = 0; i < SEQUENCE_LENGTH; i++) {
      seq.push(current);
      current = current === 'left' ? 'right' : 'left';
    }
    return seq;
  }, []);

  const startRound = useCallback(() => {
    const newSequence = generateSequence();
    setSequence(newSequence);
    setCurrentStep(0);
    setExpectedHand(newSequence[0]);
    leftScale.value = withSpring(1);
    rightScale.value = withSpring(1);
    leftOpacity.value = withTiming(1);
    rightOpacity.value = withTiming(1);
    
    // Highlight the first expected hand
    if (newSequence[0] === 'left') {
      leftScale.value = withSequence(
        withSpring(1.2),
        withSpring(1)
      );
    } else {
      rightScale.value = withSequence(
        withSpring(1.2),
        withSpring(1)
      );
    }
  }, [generateSequence, leftScale, rightScale, leftOpacity, rightOpacity]);

  const handleLeftTap = useCallback(() => {
    if (done || expectedHand !== 'left') {
      // Wrong hand
      leftScale.value = withSequence(
        withSpring(0.8),
        withSpring(1)
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Try right hand!', 0.8, 'en-US' );
      return;
    }

    // Correct!
    leftScale.value = withSequence(
      withSpring(1.3),
      withSpring(1)
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    
    if (nextStep >= SEQUENCE_LENGTH) {
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
            startRound();
          }, 1500);
        }
        return newScore;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect sequence!', 0.9, 'en-US' );
    } else {
      // Next hand in sequence
      const nextHand = sequence[nextStep];
      setExpectedHand(nextHand);
      // Highlight next expected hand
      if (nextHand === 'left') {
        leftScale.value = withSequence(
          withSpring(1.2),
          withSpring(1)
        );
      } else {
        rightScale.value = withSequence(
          withSpring(1.2),
          withSpring(1)
        );
      }
      speakTTS('Now right!', 0.8, 'en-US' );
    }
  }, [done, expectedHand, currentStep, sequence, leftScale, rightScale, startRound]);

  const handleRightTap = useCallback(() => {
    if (done || expectedHand !== 'right') {
      // Wrong hand
      rightScale.value = withSequence(
        withSpring(0.8),
        withSpring(1)
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Try left hand!', 0.8, 'en-US' );
      return;
    }

    // Correct!
    rightScale.value = withSequence(
      withSpring(1.3),
      withSpring(1)
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    
    if (nextStep >= SEQUENCE_LENGTH) {
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
            startRound();
          }, 1500);
        }
        return newScore;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect sequence!', 0.9, 'en-US' );
    } else {
      // Next hand in sequence
      const nextHand = sequence[nextStep];
      setExpectedHand(nextHand);
      // Highlight next expected hand
      if (nextHand === 'left') {
        leftScale.value = withSequence(
          withSpring(1.2),
          withSpring(1)
        );
      } else {
        rightScale.value = withSequence(
          withSpring(1.2),
          withSpring(1)
        );
      }
      speakTTS('Now left!', 0.8, 'en-US' );
    }
  }, [done, expectedHand, currentStep, sequence, leftScale, rightScale, startRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'left-right-tap',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['sequencing', 'alternating-hands', 'left-right-coordination'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      setTimeout(() => {
        startRound();
        speakTTS('Tap left, then right, alternating!', { rate: 0.8, language: 'en-US' });
      }, 500);
    }
  }, [showInfo, round, done, startRound]);

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

  const leftStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftScale.value }],
    opacity: leftOpacity.value,
  }));

  const rightStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightScale.value }],
    opacity: rightOpacity.value,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Left-Right Tap"
        emoji="👆"
        description="Pehle left, phir right - alternating taps!"
        skills={['Sequencing skills']}
        suitableFor="Children learning sequencing through alternating hand taps"
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
            setCurrentStep(0);
            startRound();
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
        <Text style={styles.title}>Left-Right Tap</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 👆 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {expectedHand === 'left' ? 'Tap LEFT! 👈' : 'Tap RIGHT! 👉'}
        </Text>
        <Text style={styles.progress}>
          Step {currentStep + 1}/{SEQUENCE_LENGTH}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <View style={styles.targetsContainer}>
          <TouchableOpacity
            style={styles.targetWrapper}
            onPress={handleLeftTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.target, styles.leftTarget, leftStyle]}>
              <Text style={styles.targetEmoji}>👈</Text>
              <Text style={styles.targetLabel}>LEFT</Text>
              {expectedHand === 'left' && (
                <View style={styles.highlightIndicator}>
                  <Text style={styles.highlightText}>TAP!</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.targetWrapper}
            onPress={handleRightTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.target, styles.rightTarget, rightStyle]}>
              <Text style={styles.targetEmoji}>👉</Text>
              <Text style={styles.targetLabel}>RIGHT</Text>
              {expectedHand === 'right' && (
                <View style={styles.highlightIndicator}>
                  <Text style={styles.highlightText}>TAP!</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Sequencing skills
        </Text>
        <Text style={styles.footerSubtext}>
          Tap left, then right, alternating!
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
    fontSize: 20,
    color: '#3B82F6',
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  progress: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  targetsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  targetWrapper: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
  },
  target: {
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    position: 'relative',
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
  highlightIndicator: {
    position: 'absolute',
    top: -30,
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  highlightText: {
    fontSize: 12,
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
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default LeftRightTapGame;
