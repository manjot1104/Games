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
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const TARGET_SIZE = 120;
const LIGHT_DURATION = 2000; // 2 seconds to tap
const DELAY_MIN = 1000;
const DELAY_MAX = 3000;

const LightUpTargetsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [leftLit, setLeftLit] = useState(false);
  const [rightLit, setRightLit] = useState(false);
  const [leftTapped, setLeftTapped] = useState(false);
  const [rightTapped, setRightTapped] = useState(false);

  const leftBrightness = useSharedValue(0.3);
  const rightBrightness = useSharedValue(0.3);
  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const lightTimerRef = useRef<NodeJS.Timeout | null>(null);
  const delayTimerRef = useRef<NodeJS.Timeout | null>(null);

  const lightUpTargets = useCallback(() => {
    if (done) return;
    
    setLeftTapped(false);
    setRightTapped(false);
    setLeftLit(true);
    setRightLit(true);
    leftBrightness.value = withTiming(1);
    rightBrightness.value = withTiming(1);
    leftScale.value = withSpring(1.1);
    rightScale.value = withSpring(1.1);
    
    speakTTS('Tap both targets!', 0.8, 'en-US' );
    
    // Auto turn off after duration
    lightTimerRef.current = setTimeout(() => {
      if (!leftTapped || !rightTapped) {
        // Missed
        setLeftLit(false);
        setRightLit(false);
        leftBrightness.value = withTiming(0.3);
        rightBrightness.value = withTiming(0.3);
        leftScale.value = withSpring(1);
        rightScale.value = withSpring(1);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        speakTTS('Too slow! Try again!', 0.8, 'en-US' );
        
        // Schedule next light up
        const delay = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
        delayTimerRef.current = setTimeout(() => {
          lightUpTargets();
        }, delay);
      }
    }, LIGHT_DURATION) as unknown as NodeJS.Timeout;
  }, [done, leftTapped, rightTapped, leftBrightness, rightBrightness, leftScale, rightScale]);

  const handleLeftTap = useCallback(() => {
    if (done || !leftLit || leftTapped) return;
    setLeftTapped(true);
    leftScale.value = withSpring(0.9);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    if (rightTapped) {
      // Both tapped!
      if (lightTimerRef.current) {
        clearTimeout(lightTimerRef.current as unknown as ReturnType<typeof setTimeout>);
        lightTimerRef.current = null;
      }
      setLeftLit(false);
      setRightLit(false);
      leftBrightness.value = withTiming(0.3);
      rightBrightness.value = withTiming(0.3);
      leftScale.value = withSpring(1);
      rightScale.value = withSpring(1);
      
      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            const delay = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
            delayTimerRef.current = setTimeout(() => {
              lightUpTargets();
            }, delay);
          }, 1500);
        }
        return newScore;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Fast reaction!', 0.9, 'en-US' );
    }
  }, [done, leftLit, leftTapped, rightTapped, leftScale, rightScale, leftBrightness, rightBrightness, lightUpTargets]);

  const handleRightTap = useCallback(() => {
    if (done || !rightLit || rightTapped) return;
    setRightTapped(true);
    rightScale.value = withSpring(0.9);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    if (leftTapped) {
      // Both tapped!
      if (lightTimerRef.current) {
        clearTimeout(lightTimerRef.current as unknown as ReturnType<typeof setTimeout>);
        lightTimerRef.current = null;
      }
      setLeftLit(false);
      setRightLit(false);
      leftBrightness.value = withTiming(0.3);
      rightBrightness.value = withTiming(0.3);
      leftScale.value = withSpring(1);
      rightScale.value = withSpring(1);
      
      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            const delay = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
            delayTimerRef.current = setTimeout(() => {
              lightUpTargets();
            }, delay);
          }, 1500);
        }
        return newScore;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Fast reaction!', 0.9, 'en-US' );
    }
  }, [done, rightLit, leftTapped, rightTapped, rightScale, leftScale, leftBrightness, rightBrightness, lightUpTargets]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);
    setLeftLit(false);
    setRightLit(false);

    if (lightTimerRef.current) {
      clearTimeout(lightTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      lightTimerRef.current = null;
    }
    if (delayTimerRef.current) {
      clearTimeout(delayTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      delayTimerRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'light-up-targets',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['reaction-timing', 'two-hand-tap'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      const delay = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
      delayTimerRef.current = setTimeout(() => {
        lightUpTargets();
      }, delay);
      speakTTS('Watch for the lights!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, lightUpTargets]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (lightTimerRef.current) {
        clearTimeout(lightTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      }
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      }
    };
  }, []);

  const leftTargetStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftScale.value }],
    opacity: leftBrightness.value,
  }));

  const rightTargetStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightScale.value }],
    opacity: rightBrightness.value,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Light Up Targets"
        emoji="💡"
        description="Tap both targets when they light up!"
        skills={['Reaction timing']}
        suitableFor="Children learning reaction timing through light-up target tapping"
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
            const delay = DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
            setTimeout(() => {
              lightUpTargets();
            }, delay);
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
        <Text style={styles.title}>Light Up Targets</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 💡 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {leftLit && rightLit ? 'Tap both targets now!' : 'Watch for the lights...'}
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
            <Animated.View style={[styles.target, styles.leftTarget, leftTargetStyle]}>
              <Text style={styles.targetEmoji}>💡</Text>
              <Text style={styles.targetLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.targetWrapper}
            onPress={handleRightTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.target, styles.rightTarget, rightTargetStyle]}>
              <Text style={styles.targetEmoji}>💡</Text>
              <Text style={styles.targetLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Reaction timing
        </Text>
        <Text style={styles.footerSubtext}>
          Tap both targets when they light up!
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
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default LightUpTargetsGame;
