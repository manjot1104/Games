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

const TOTAL_ROUNDS = 8;
const BIG_SWIPE_THRESHOLD = 200; // pixels for big swipe
const SMALL_SWIPE_THRESHOLD = 80; // pixels for small swipe

type SwipeType = 'big' | 'small';

const BigSwipeSmallSwipeGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentTarget, setCurrentTarget] = useState<SwipeType>('big');
  const [bigBarProgress, setBigBarProgress] = useState(0);
  const [smallBarProgress, setSmallBarProgress] = useState(0);
  const [isActive, setIsActive] = useState(false);

  const sparkleX = useRef(new Animated.Value(0)).current;
  const sparkleY = useRef(new Animated.Value(0)).current;
  const startX = useRef(0);
  const startY = useRef(0);

  // Define endGame before it's used in panGesture
  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 18;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsActive(false);

    try {
      const timestamp = new Date().toISOString();
      await logGameAndAward({
        gameId: 'big-swipe-small-swipe',
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
        gameId: 'big-swipe-small-swipe',
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
  }, [score]);

  // Generate random target for each round
  useEffect(() => {
    if (done) return;
    const target: SwipeType = Math.random() > 0.5 ? 'big' : 'small';
    setCurrentTarget(target);
    setBigBarProgress(0);
    setSmallBarProgress(0);
    setIsActive(true);
    if (round === 1) {
      speakTTS('Long swipe fills big bar, short swipe fills small bar!', { rate: 0.9 });
    } else {
      speakTTS(target === 'big' ? 'Fill the big bar!' : 'Fill the small bar!', 0.9 );
    }
  }, [round, done]);

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

  const panGesture = Gesture.Pan()
    .onStart((evt) => {
      if (!isActive || done) return;
      startX.current = evt.x;
      startY.current = evt.y;
    })
    .onUpdate((evt) => {
      if (!isActive || done) return;
      const deltaX = Math.abs(evt.x - startX.current);
      const deltaY = Math.abs(evt.y - startY.current);
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      // Update progress bars
      if (distance >= BIG_SWIPE_THRESHOLD) {
        setBigBarProgress(100);
      } else {
        setBigBarProgress((distance / BIG_SWIPE_THRESHOLD) * 100);
      }

      if (distance >= SMALL_SWIPE_THRESHOLD) {
        setSmallBarProgress(100);
      } else {
        setSmallBarProgress((distance / SMALL_SWIPE_THRESHOLD) * 100);
      }
    })
    .onEnd((evt) => {
      if (!isActive || done) return;
      const deltaX = Math.abs(evt.x - startX.current);
      const deltaY = Math.abs(evt.y - startY.current);
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      let correct = false;
      if (currentTarget === 'big' && distance >= BIG_SWIPE_THRESHOLD) {
        correct = true;
      } else if (currentTarget === 'small' && distance >= SMALL_SWIPE_THRESHOLD && distance < BIG_SWIPE_THRESHOLD) {
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
      setBigBarProgress(0);
      setSmallBarProgress(0);

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
            setBigBarProgress(0);
            setSmallBarProgress(0);
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
        <Text style={styles.title}>Big Swipe vs Small Swipe</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {currentTarget === 'big' ? '👆 Make a BIG swipe!' : '👆 Make a SMALL swipe!'}
          </Text>

          <GestureDetector gesture={panGesture}>
            <View style={styles.swipeArea}>
              <View style={styles.barContainer}>
                <Text style={styles.barLabel}>BIG Bar</Text>
                <View style={styles.barBackground}>
                  <View style={[styles.barFill, { width: `${bigBarProgress}%`, backgroundColor: currentTarget === 'big' ? '#10B981' : '#6B7280' }]} />
                </View>
              </View>

              <View style={styles.swipeZone}>
                <Text style={styles.swipeHint}>Swipe here!</Text>
              </View>

              <View style={styles.barContainer}>
                <Text style={styles.barLabel}>SMALL Bar</Text>
                <View style={styles.barBackground}>
                  <View style={[styles.barFill, { width: `${smallBarProgress}%`, backgroundColor: currentTarget === 'small' ? '#10B981' : '#6B7280' }]} />
                </View>
              </View>
            </View>
          </GestureDetector>

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
    padding: 24,
  },
  gameArea: {
    width: '100%',
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 18,
    color: '#374151',
    textAlign: 'center',
    marginBottom: 32,
    fontWeight: '600',
  },
  swipeArea: {
    width: '100%',
    height: 400,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  barContainer: {
    width: '100%',
    alignItems: 'center',
  },
  barLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  barBackground: {
    width: '80%',
    height: 40,
    backgroundColor: '#E5E7EB',
    borderRadius: 20,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 20,
  },
  swipeZone: {
    width: '100%',
    height: 150,
    backgroundColor: '#EFF6FF',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#3B82F6',
    borderStyle: 'dashed',
  },
  swipeHint: {
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '600',
  },
});

export default BigSwipeSmallSwipeGame;


