import { logGameAndAward } from '@/utils/api';
import { stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ResultCard from './ResultCard';

const TOTAL_ROUNDS = 10;

type GamePhase = 'idle' | 'playing' | 'finished';
type TargetType = 'big' | 'small';

export const BigTapVsSmallTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [targetType, setTargetType] = useState<TargetType | null>(null);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; accuracy: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const bigCircleScale = useRef(new Animated.Value(1)).current;
  const smallCircleScale = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Track all speech timers
  const speechTimersRef = useRef<NodeJS.Timeout[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all speech timers
      speechTimersRef.current.forEach(timer => clearTimeout(timer));
      speechTimersRef.current = [];
      stopAllSpeech();
    };
  }, []);

  const generateTarget = useCallback(() => {
    const type: TargetType = Math.random() > 0.5 ? 'big' : 'small';
    setTargetType(type);
    speakTTS(type === 'big' ? 'Tap the BIG circle!' : 'Tap the SMALL circle!');
  }, []);

  const startGame = () => {
    setPhase('playing');
    setRound(1);
    setCorrect(0);
    setWrong(0);
    generateTarget();
  };

  const handleBigTap = () => {
    if (phase !== 'playing' || !targetType) return;

    if (targetType === 'big') {
      setCorrect((c) => c + 1);
      Animated.sequence([
        Animated.timing(bigCircleScale, {
          toValue: 1.3,
          duration: 150,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(bigCircleScale, {
          toValue: 1,
          duration: 150,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect!');
    } else {
      setWrong((w) => w + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Try the small one!');
    }

    nextRound();
  };

  const handleSmallTap = () => {
    if (phase !== 'playing' || !targetType) return;

    if (targetType === 'small') {
      setCorrect((c) => c + 1);
      Animated.sequence([
        Animated.timing(smallCircleScale, {
          toValue: 1.5,
          duration: 150,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(smallCircleScale, {
          toValue: 1,
          duration: 150,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Great!');
    } else {
      setWrong((w) => w + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Try the big one!');
    }

    nextRound();
  };

  const nextRound = () => {
    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        generateTarget();
      } else {
        finishGame();
      }
    }, 1500);
  };

  const finishGame = async () => {
    setPhase('finished');
    const total = correct + wrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const xp = correct * 15;

    setFinalStats({ correct, total, accuracy, xp });

    try {
      const result = await logGameAndAward({
        type: 'tap', // Using 'tap' as closest match
        correct,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['size-discrimination', 'target-selection', 'motor-control'],
        meta: { rounds: round },
      });
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
    }

    speakTTS('Amazing! You mastered big and small taps!');
  };

  useEffect(() => {
    if (phase === 'playing') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [phase, pulseAnim]);

  const pulseStyle = {
    transform: [{ scale: pulseAnim }],
  };

  const bigCircleStyle = {
    transform: [{ scale: bigCircleScale }],
  };

  const smallCircleStyle = {
    transform: [{ scale: smallCircleScale }],
  };

  // Results screen
  if (phase === 'finished' && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity
          onPress={() => {
            // Clear all speech timers first
            speechTimersRef.current.forEach(timer => clearTimeout(timer));
            speechTimersRef.current = [];
            // Aggressively stop all speech
            stopAllSpeech();
            if (onBack) onBack();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.resultsContainer}>
          <Text style={styles.emoji}>👆</Text>
          <Text style={styles.title}>Tap Game Complete!</Text>
          <Text style={styles.subtitle}>You mastered big and small taps!</Text>

          <ResultCard
            correct={finalStats.correct}
            total={finalStats.total}
            xpAwarded={finalStats.xp}
            accuracy={finalStats.accuracy}
            logTimestamp={logTimestamp}
            onPlayAgain={() => {
              setPhase('idle');
              setFinalStats(null);
              setLogTimestamp(null);
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Game screen
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        onPress={() => {
          try {
            stopTTS();
          } catch {
            // Ignore errors
          }
          if (onBack) onBack();
        }}
        style={styles.backButton}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.headerText}>Round {round} / {TOTAL_ROUNDS}</Text>
        <Text style={styles.scoreText}>Correct: {correct}</Text>
      </View>

      {phase === 'idle' ? (
        <View style={styles.centerContent}>
          <Text style={styles.emoji}>👆</Text>
          <Text style={styles.title}>Big Tap vs Small Tap</Text>
          <Text style={styles.instructions}>
            When you see BIG, tap the big circle!{'\n'}
            When you see SMALL, tap the tiny circle!
          </Text>
          <TouchableOpacity style={styles.startButton} onPress={startGame}>
            <LinearGradient
              colors={['#8B5CF6', '#6366F1']}
              style={styles.startButtonGradient}
            >
              <Text style={styles.startButtonText}>Start Game</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.gameArea}>
          <View style={styles.targetIndicator}>
            <Animated.View style={pulseStyle}>
              <Text style={styles.targetText}>
                {targetType === 'big' ? 'BIG' : 'SMALL'}
              </Text>
            </Animated.View>
          </View>

          <View style={styles.circlesContainer}>
            <Animated.View style={bigCircleStyle}>
              <TouchableOpacity
                style={styles.bigCircle}
                onPress={handleBigTap}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={targetType === 'big' ? ['#EF4444', '#DC2626'] : ['#F59E0B', '#D97706']}
                  style={styles.circleGradient}
                >
                  <Text style={styles.bigCircleText}>BIG</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>

            <Animated.View style={smallCircleStyle}>
              <TouchableOpacity
                style={styles.smallCircle}
                onPress={handleSmallTap}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={targetType === 'small' ? ['#6366F1', '#4F46E5'] : ['#8B5CF6', '#7C3AED']}
                  style={styles.circleGradient}
                >
                  <Text style={styles.smallCircleText}>small</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>
      )}
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
    left: 20,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#111827',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    paddingTop: 80,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#8B5CF6',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emoji: {
    fontSize: 80,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1F2937',
    marginBottom: 12,
    textAlign: 'center',
  },
  instructions: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  startButton: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  startButtonGradient: {
    paddingHorizontal: 48,
    paddingVertical: 16,
  },
  startButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  gameArea: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  targetIndicator: {
    marginBottom: 48,
    padding: 24,
    backgroundColor: '#F3F4F6',
    borderRadius: 24,
    borderWidth: 4,
    borderColor: '#8B5CF6',
  },
  targetText: {
    fontSize: 48,
    fontWeight: '900',
    color: '#8B5CF6',
    textAlign: 'center',
    letterSpacing: 4,
  },
  circlesContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 40,
  },
  bigCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    overflow: 'hidden',
    shadowColor: '#EF4444',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  smallCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
    shadowColor: '#6366F1',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  circleGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bigCircleText: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 3,
  },
  smallCircleText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  resultsContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  subtitle: {
    fontSize: 18,
    color: '#6B7280',
    marginBottom: 32,
    textAlign: 'center',
  },
});


