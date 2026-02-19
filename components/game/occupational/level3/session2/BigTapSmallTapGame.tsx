import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, playSound } from '@/utils/soundPlayer';
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

const TOTAL_ROUNDS = 10;
const BIG_CIRCLE_SIZE = 150;
const SMALL_CIRCLE_SIZE = 40;

type TargetType = 'big' | 'small';

const BigTapSmallTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentTarget, setCurrentTarget] = useState<TargetType>('big');
  const [showTarget, setShowTarget] = useState(false);

  const sparkleX = useRef(new Animated.Value(0)).current;
  const sparkleY = useRef(new Animated.Value(0)).current;

  // Define endGame before it's used in handleTap
  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 18;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowTarget(false);

    try {
      const timestamp = new Date().toISOString();
      await logGameAndAward({
        gameId: 'big-tap-small-tap',
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
        gameId: 'big-tap-small-tap',
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

  // Show target for each round
  useEffect(() => {
    if (done) return;
    const target: TargetType = Math.random() > 0.5 ? 'big' : 'small';
    setCurrentTarget(target);
    setShowTarget(false);

    setTimeout(() => {
      setShowTarget(true);
      speakTTS(target === 'big' ? 'BIG!' : 'SMALL!', 0.9 );
    }, 500);
  }, [round, done]);

  const handleTap = useCallback(
    (tappedType: TargetType) => {
      if (!showTarget || done) return;

      if (tappedType === currentTarget) {
        setScore((s) => s + 1);
        playSound('drum', 0.6, 1.0);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        sparkleX.setValue(50);
        sparkleY.setValue(50);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }

      setShowTarget(false);
      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
        } else {
          endGame();
        }
      }, 1000);
    },
    [showTarget, done, currentTarget, round, endGame],
  );

  useEffect(() => {
    if (round === 1 && !done) {
      speakTTS('Tap big circle when "BIG" appears, tiny circle when "SMALL"!', { rate: 0.9 });
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
      cleanupSounds();
    };
  }, []);

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
            setShowTarget(false);
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
        <Text style={styles.title}>Big Tap vs Small Tap</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          {showTarget && (
            <Text style={styles.targetText}>
              {currentTarget === 'big' ? 'BIG' : 'SMALL'}
            </Text>
          )}

          <View style={styles.circleContainer}>
            <TouchableOpacity
              style={[
                styles.bigCircle,
                showTarget && currentTarget === 'big' && styles.targetHighlight,
              ]}
              onPress={() => handleTap('big')}
              activeOpacity={0.8}
            >
              <Text style={styles.circleLabel}>BIG</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.smallCircle,
                showTarget && currentTarget === 'small' && styles.targetHighlight,
              ]}
              onPress={() => handleTap('small')}
              activeOpacity={0.8}
            >
              <Text style={styles.circleLabel}>SMALL</Text>
            </TouchableOpacity>
          </View>

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
  targetText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#8B5CF6',
    marginBottom: 32,
  },
  circleContainer: {
    flexDirection: 'row',
    gap: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  smallCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  targetHighlight: {
    borderWidth: 4,
    borderColor: '#10B981',
    transform: [{ scale: 1.1 }],
  },
  circleLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});

export default BigTapSmallTapGame;


