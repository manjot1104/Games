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
const CIRCLE_SIZE = 120;
const TOLERANCE = 80;

const DoubleCircleTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [leftTapped, setLeftTapped] = useState(false);
  const [rightTapped, setRightTapped] = useState(false);

  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const leftOpacity = useSharedValue(1);
  const rightOpacity = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const handleLeftTap = useCallback(() => {
    if (done || leftTapped) return;
    setLeftTapped(true);
    leftScale.value = withSpring(1.3);
    leftOpacity.value = withTiming(0.5);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    if (rightTapped) {
      // Both tapped!
      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            resetCircles();
          }, 1500);
        }
        return newScore;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect! Both hands!', 0.9, 'en-US' );
    }
  }, [done, leftTapped, rightTapped, leftScale, leftOpacity]);

  const handleRightTap = useCallback(() => {
    if (done || rightTapped) return;
    setRightTapped(true);
    rightScale.value = withSpring(1.3);
    rightOpacity.value = withTiming(0.5);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    
    if (leftTapped) {
      // Both tapped!
      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            resetCircles();
          }, 1500);
        }
        return newScore;
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect! Both hands!', 0.9, 'en-US' );
    }
  }, [done, leftTapped, rightTapped, rightScale, rightOpacity]);

  const resetCircles = useCallback(() => {
    setLeftTapped(false);
    setRightTapped(false);
    leftScale.value = withSpring(1);
    rightScale.value = withSpring(1);
    leftOpacity.value = withTiming(1);
    rightOpacity.value = withTiming(1);
  }, [leftScale, rightScale, leftOpacity, rightOpacity]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'double-circle-tap',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['bilateral-coordination', 'two-hand-tap'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetCircles();
      speakTTS('Tap both circles with both hands!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, resetCircles]);

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

  const leftCircleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftScale.value }],
    opacity: leftOpacity.value,
  }));

  const rightCircleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightScale.value }],
    opacity: rightOpacity.value,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Double Circle Tap"
        emoji="⭕"
        description="Tap both circles with both hands at the same time!"
        skills={['Bilateral coordination']}
        suitableFor="Children learning bilateral coordination through dual circle tapping"
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
            resetCircles();
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
        <Text style={styles.title}>Double Circle Tap</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⭕ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap both circles with both hands!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <View style={styles.circlesContainer}>
          <TouchableOpacity
            style={styles.circleWrapper}
            onPress={handleLeftTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.circle, styles.leftCircle, leftCircleStyle]}>
              <Text style={styles.circleEmoji}>👈</Text>
              <Text style={styles.circleLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.circleWrapper}
            onPress={handleRightTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.circle, styles.rightCircle, rightCircleStyle]}>
              <Text style={styles.circleEmoji}>👉</Text>
              <Text style={styles.circleLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Bilateral coordination
        </Text>
        <Text style={styles.footerSubtext}>
          Tap both circles with both hands at the same time!
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
  },
  circlesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  circleWrapper: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
  },
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftCircle: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightCircle: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  circleEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  circleLabel: {
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

export default DoubleCircleTapGame;
