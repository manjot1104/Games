import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const TOTAL_ROUNDS = 8;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;
const TARGET_BIG_SCALE = 1.8;
const TARGET_SMALL_SCALE = 0.6;

type TargetType = 'big' | 'small';

const StretchPinchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentTarget, setCurrentTarget] = useState<TargetType>('big');
  const [isActive, setIsActive] = useState(false);

  const scale = useSharedValue(1.0);
  const sparkleX = useRef(new Animated.Value(0)).current;
  const sparkleY = useRef(new Animated.Value(0)).current;

  // Define endGame before it's used in pinchGesture
  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 20;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsActive(false);
    scale.value = 1.0;

    try {
      const timestamp = new Date().toISOString();
      await logGameAndAward({
        gameId: 'stretch-pinch',
        therapyId: 'occupational',
        levelNumber: 3,
        sessionNumber: 2,
        score,
        totalRounds: total,
        accuracy,
        xp,
        timestamp,
      });
      await recordGame({
        gameId: 'stretch-pinch',
        therapyId: 'occupational',
        levelNumber: 3,
        sessionNumber: 2,
        score,
        totalRounds: total,
        accuracy,
        xp,
        timestamp,
      });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, scale]);

  // Start new round
  useEffect(() => {
    if (done) return;
    const target: TargetType = Math.random() > 0.5 ? 'big' : 'small';
    setCurrentTarget(target);
    scale.value = 1.0;
    setIsActive(true);
    if (round === 1) {
      speakTTS('Make it BIG by stretching, make it SMALL by pinching!', { rate: 0.9 });
    } else {
      speakTTS(target === 'big' ? 'Make it BIG!' : 'Make it SMALL!', 0.9 );
    }
  }, [round, done, scale]);

  useEffect(() => {
    return () => {
      // Cleanup: Stop all sounds and speech when component unmounts
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
    };
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const pinchGesture = Gesture.Pinch()
    .onUpdate((evt) => {
      if (!isActive || done) return;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale.value * evt.scaleChange));
      scale.value = newScale;
    })
    .onEnd(() => {
      if (!isActive || done) return;
      const currentScale = scale.value;

      let correct = false;
      if (currentTarget === 'big' && currentScale >= TARGET_BIG_SCALE) {
        correct = true;
      } else if (currentTarget === 'small' && currentScale <= TARGET_SMALL_SCALE) {
        correct = true;
      }

      if (correct) {
        setScore((s) => s + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        sparkleX.setValue(50);
        sparkleY.setValue(50);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }

      setIsActive(false);
      scale.value = withSpring(1.0);

      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
        } else {
          endGame();
        }
      }, 1000);
    });

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xp={finalStats.xp}
          onBack={onBack}
          onRetry={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            scale.value = 1.0;
            setIsActive(true);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            try {
              stopTTS();
            } catch (e) {
              // Ignore errors
            }
            if (onBack) onBack();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Stretch vs Pinch</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {currentTarget === 'big' ? '🤏 Make it BIG!' : '🤏 Make it SMALL!'}
          </Text>

          <GestureDetector gesture={pinchGesture}>
            <Animated.View style={[styles.objectContainer, animatedStyle]}>
              <View style={styles.object}>
                <Text style={styles.objectEmoji}>🎈</Text>
              </View>
            </Animated.View>
          </GestureDetector>

          <Text style={styles.hintText}>
            {currentTarget === 'big' ? 'Stretch with two fingers' : 'Pinch with two fingers'}
          </Text>

          <SparkleBurst x={sparkleX} y={sparkleY} />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    padding: 8,
  },
  backText: {
    fontSize: 16,
    color: '#3B82F6',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    flex: 1,
    textAlign: 'center',
  },
  scoreContainer: {
    alignItems: 'flex-end',
  },
  scoreText: {
    fontSize: 14,
    color: '#6B7280',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  gameArea: {
    width: '100%',
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#8B5CF6',
    marginBottom: 32,
  },
  objectContainer: {
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  object: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  objectEmoji: {
    fontSize: 80,
  },
  hintText: {
    marginTop: 24,
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
});

export default StretchPinchGame;

