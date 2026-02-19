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
const PATH_LENGTH = 4; // 4 steps per round

const WalkingHandsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [activeHand, setActiveHand] = useState<'left' | 'right'>('left');
  const [leftPosition, setLeftPosition] = useState(0);
  const [rightPosition, setRightPosition] = useState(0);

  const leftY = useSharedValue(0);
  const rightY = useSharedValue(0);
  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const startRound = useCallback(() => {
    setCurrentStep(0);
    setActiveHand('left');
    setLeftPosition(0);
    setRightPosition(0);
    leftY.value = 0;
    rightY.value = 0;
    leftScale.value = withSpring(1);
    rightScale.value = withSpring(1);
    
    // Highlight left hand first
    leftScale.value = withSequence(
      withSpring(1.2),
      withSpring(1)
    );
  }, [leftY, rightY, leftScale, rightScale]);

  const handleLeftMove = useCallback(() => {
    if (done || activeHand !== 'left') {
      // Wrong hand
      leftScale.value = withSequence(
        withSpring(0.8),
        withSpring(1)
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Alternate! Use right hand!', 0.8, 'en-US' );
      return;
    }

    // Correct! Move left hand forward
    const newPosition = leftPosition + 1;
    setLeftPosition(newPosition);
    leftY.value = withSpring(-30); // Move up
    leftScale.value = withSequence(
      withSpring(1.3),
      withSpring(1)
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    setTimeout(() => {
      leftY.value = withSpring(0);
      setActiveHand('right');
      // Highlight right hand next
      rightScale.value = withSequence(
        withSpring(1.2),
        withSpring(1)
      );
      speakTTS('Now right hand!', 0.8, 'en-US' );
    }, 300);

    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    
    if (nextStep >= PATH_LENGTH) {
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
      speakTTS('Perfect walking!', 0.9, 'en-US' );
    }
  }, [done, activeHand, leftPosition, currentStep, leftY, leftScale, rightScale, startRound]);

  const handleRightMove = useCallback(() => {
    if (done || activeHand !== 'right') {
      // Wrong hand
      rightScale.value = withSequence(
        withSpring(0.8),
        withSpring(1)
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Alternate! Use left hand!', 0.8, 'en-US' );
      return;
    }

    // Correct! Move right hand forward
    const newPosition = rightPosition + 1;
    setRightPosition(newPosition);
    rightY.value = withSpring(-30); // Move up
    rightScale.value = withSequence(
      withSpring(1.3),
      withSpring(1)
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    setTimeout(() => {
      rightY.value = withSpring(0);
      setActiveHand('left');
      // Highlight left hand next
      leftScale.value = withSequence(
        withSpring(1.2),
        withSpring(1)
      );
      speakTTS('Now left hand!', 0.8, 'en-US' );
    }, 300);

    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    
    if (nextStep >= PATH_LENGTH) {
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
      speakTTS('Perfect walking!', 0.9, 'en-US' );
    }
  }, [done, activeHand, rightPosition, currentStep, rightY, rightScale, leftScale, startRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'walking-hands',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['pre-writing', 'alternating-hands', 'hand-coordination'],
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
        speakTTS('Walk with your hands! Alternate left and right!', 0.8, 'en-US' );
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
    transform: [
      { translateY: leftY.value },
      { scale: leftScale.value },
    ],
  }));

  const rightStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: rightY.value },
      { scale: rightScale.value },
    ],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Walking Hands"
        emoji="🚶"
        description="Hands ko alternate chalana - pre-writing skill!"
        skills={['Pre-writing skill']}
        suitableFor="Children learning alternating hand movements for pre-writing"
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
        <Text style={styles.title}>Walking Hands</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🚶 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {activeHand === 'left' ? 'Move LEFT hand! 👈' : 'Move RIGHT hand! 👉'}
        </Text>
        <Text style={styles.progress}>
          Step {currentStep + 1}/{PATH_LENGTH}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <View style={styles.pathContainer}>
          <View style={styles.pathLine} />
          <View style={styles.handsContainer}>
            <TouchableOpacity
              style={styles.handWrapper}
              onPress={handleLeftMove}
              activeOpacity={0.8}
            >
              <Animated.View style={[styles.hand, styles.leftHand, leftStyle]}>
                <Text style={styles.handEmoji}>👈</Text>
                <Text style={styles.handLabel}>LEFT</Text>
                {activeHand === 'left' && (
                  <View style={styles.activeIndicator}>
                    <Text style={styles.activeText}>MOVE!</Text>
                  </View>
                )}
              </Animated.View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.handWrapper}
              onPress={handleRightMove}
              activeOpacity={0.8}
            >
              <Animated.View style={[styles.hand, styles.rightHand, rightStyle]}>
                <Text style={styles.handEmoji}>👉</Text>
                <Text style={styles.handLabel}>RIGHT</Text>
                {activeHand === 'right' && (
                  <View style={styles.activeIndicator}>
                    <Text style={styles.activeText}>MOVE!</Text>
                  </View>
                )}
              </Animated.View>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Pre-writing skill
        </Text>
        <Text style={styles.footerSubtext}>
          Alternate your hands like walking!
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
    color: '#10B981',
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
  pathContainer: {
    width: '100%',
    height: 200,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pathLine: {
    position: 'absolute',
    width: '80%',
    height: 4,
    backgroundColor: '#CBD5E1',
    borderRadius: 2,
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
  activeIndicator: {
    position: 'absolute',
    top: -30,
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeText: {
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

export default WalkingHandsGame;
