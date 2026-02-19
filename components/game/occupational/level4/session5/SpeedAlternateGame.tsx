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
const SEQUENCE_LENGTH = 6; // 6 taps per round
const INITIAL_INTERVAL = 2000; // Start slow: 2 seconds
const FINAL_INTERVAL = 800; // End fast: 0.8 seconds

const SpeedAlternateGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [expectedHand, setExpectedHand] = useState<'left' | 'right'>('left');
  const [currentInterval, setCurrentInterval] = useState(INITIAL_INTERVAL);
  const [waitingForTap, setWaitingForTap] = useState(false);

  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const leftOpacity = useSharedValue(1);
  const rightOpacity = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const tapTimerRef = useRef<NodeJS.Timeout | null>(null);

  const calculateInterval = useCallback((step: number) => {
    // Gradually decrease interval from INITIAL_INTERVAL to FINAL_INTERVAL
    const progress = step / (SEQUENCE_LENGTH - 1);
    return INITIAL_INTERVAL - (INITIAL_INTERVAL - FINAL_INTERVAL) * progress;
  }, []);

  const triggerNextTap = useCallback(() => {
    if (done || currentStep >= SEQUENCE_LENGTH) return;
    
    setWaitingForTap(true);
    const interval = calculateInterval(currentStep);
    setCurrentInterval(interval);
    
    // Highlight expected hand
    if (expectedHand === 'left') {
      leftScale.value = withSequence(
        withSpring(1.3),
        withSpring(1)
      );
    } else {
      rightScale.value = withSequence(
        withSpring(1.3),
        withSpring(1)
      );
    }
    
    speakTTS(`Tap ${expectedHand}!`, 0.8, 'en-US' );
    
    // Auto-advance if too slow
    tapTimerRef.current = setTimeout(() => {
      if (waitingForTap) {
        // Too slow - miss
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        speakTTS('Too slow! Speed up!', 0.8, 'en-US' );
        setWaitingForTap(false);
        
        // Continue to next step
        const nextStep = currentStep + 1;
        if (nextStep < SEQUENCE_LENGTH) {
          setCurrentStep(nextStep);
          const nextHand = expectedHand === 'left' ? 'right' : 'left';
          setExpectedHand(nextHand);
          setTimeout(() => {
            triggerNextTap();
          }, 500);
        } else {
          // Round failed - try again
          setTimeout(() => {
            setCurrentStep(0);
            setExpectedHand('left');
            setCurrentInterval(INITIAL_INTERVAL);
            triggerNextTap();
          }, 1000);
        }
      }
    }, interval * 1.5) as unknown as NodeJS.Timeout;
  }, [done, currentStep, expectedHand, waitingForTap, leftScale, rightScale, calculateInterval]);

  const handleLeftTap = useCallback(() => {
    if (done || !waitingForTap || expectedHand !== 'left') {
      if (waitingForTap && expectedHand === 'right') {
        // Wrong hand
        leftScale.value = withSequence(
          withSpring(0.8),
          withSpring(1)
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Alternate! Use right hand!', 0.8, 'en-US' );
      }
      return;
    }

    // Correct!
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      tapTimerRef.current = null;
    }
    
    setWaitingForTap(false);
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
            setCurrentStep(0);
            setExpectedHand('left');
            setCurrentInterval(INITIAL_INTERVAL);
            triggerNextTap();
          }, 1500);
        }
        return newScore;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect speed!', 0.9, 'en-US' );
    } else {
      // Next hand - speed increases
      const nextHand = expectedHand === 'left' ? 'right' : 'left';
      setExpectedHand(nextHand);
      const nextInterval = calculateInterval(nextStep);
      setCurrentInterval(nextInterval);
      
      setTimeout(() => {
        triggerNextTap();
      }, 300);
    }
  }, [done, waitingForTap, expectedHand, currentStep, leftScale, calculateInterval, triggerNextTap]);

  const handleRightTap = useCallback(() => {
    if (done || !waitingForTap || expectedHand !== 'right') {
      if (waitingForTap && expectedHand === 'left') {
        // Wrong hand
        rightScale.value = withSequence(
          withSpring(0.8),
          withSpring(1)
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Alternate! Use left hand!', 0.8, 'en-US' );
      }
      return;
    }

    // Correct!
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      tapTimerRef.current = null;
    }
    
    setWaitingForTap(false);
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
            setCurrentStep(0);
            setExpectedHand('left');
            setCurrentInterval(INITIAL_INTERVAL);
            triggerNextTap();
          }, 1500);
        }
        return newScore;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect speed!', 0.9, 'en-US' );
    } else {
      // Next hand - speed increases
      const nextHand = expectedHand === 'left' ? 'right' : 'left';
      setExpectedHand(nextHand);
      const nextInterval = calculateInterval(nextStep);
      setCurrentInterval(nextInterval);
      
      setTimeout(() => {
        triggerNextTap();
      }, 300);
    }
  }, [done, waitingForTap, expectedHand, currentStep, rightScale, calculateInterval, triggerNextTap]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);
    setWaitingForTap(false);

    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      tapTimerRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'speed-alternate',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['motor-speed-control', 'alternating-hands', 'speed-progression'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      setCurrentStep(0);
      setExpectedHand('left');
      setCurrentInterval(INITIAL_INTERVAL);
      setTimeout(() => {
        triggerNextTap();
        speakTTS('Start slow, then speed up!', { rate: 0.8, language: 'en-US' });
      }, 500);
    }
  }, [showInfo, round, done, triggerNextTap]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      }
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

  const speedProgress = currentStep / SEQUENCE_LENGTH;
  const speedColor = speedProgress < 0.33 ? '#10B981' : speedProgress < 0.66 ? '#F59E0B' : '#EF4444';

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Speed Alternate"
        emoji="⚡"
        description="Slow se fast alternating - motor speed control!"
        skills={['Motor speed control']}
        suitableFor="Children learning motor speed control through progressive alternating taps"
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
            setExpectedHand('left');
            setCurrentInterval(INITIAL_INTERVAL);
            triggerNextTap();
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
        <Text style={styles.title}>Speed Alternate</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⚡ Score: {score}
        </Text>
        <Text style={[styles.instruction, { color: speedColor }]}>
          {waitingForTap
            ? `Tap ${expectedHand.toUpperCase()}! Speed: ${speedProgress < 0.33 ? 'SLOW' : speedProgress < 0.66 ? 'MEDIUM' : 'FAST'}`
            : 'Get ready...'}
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
              {waitingForTap && expectedHand === 'left' && (
                <View style={[styles.highlightIndicator, { backgroundColor: speedColor }]}>
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
              {waitingForTap && expectedHand === 'right' && (
                <View style={[styles.highlightIndicator, { backgroundColor: speedColor }]}>
                  <Text style={styles.highlightText}>TAP!</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Motor speed control
        </Text>
        <Text style={styles.footerSubtext}>
          Start slow, then speed up as you alternate!
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

export default SpeedAlternateGame;
