import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { playSound } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const TOTAL_ROUNDS = 8;
const INITIAL_BPM = 60; // 1 beat per second (60 BPM)
const FINAL_BPM = 120; // 2 beats per second (120 BPM)
const BEATS_PER_ROUND = 4;

const BeatMatchTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [beatCount, setBeatCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastTapTime, setLastTapTime] = useState<number | null>(null);
  const [expectedTapTime, setExpectedTapTime] = useState<number | null>(null);
  const [showSparkle, setShowSparkle] = useState(false);

  const beatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate BPM for current round (increases from INITIAL_BPM to FINAL_BPM)
  const currentBPM = INITIAL_BPM + ((FINAL_BPM - INITIAL_BPM) * (round - 1)) / (TOTAL_ROUNDS - 1);
  const beatInterval = (60 / currentBPM) * 1000; // Convert BPM to milliseconds

  // Start beat sequence
  const startBeatSequence = useCallback(() => {
    if (isPlaying) return;
    setIsPlaying(true);
    setBeatCount(0);
    setExpectedTapTime(null);
    setLastTapTime(null);

    const playBeat = () => {
      const now = Date.now();
      setExpectedTapTime(now + beatInterval);
      playSound('drum', 0.8, 1.0);
      setBeatCount((prev) => {
        const newCount = prev + 1;
        if (newCount >= BEATS_PER_ROUND) {
          setIsPlaying(false);
          if (beatIntervalRef.current) {
            clearInterval(beatIntervalRef.current);
            beatIntervalRef.current = null;
          }
          // Check if round is complete
          if (round < TOTAL_ROUNDS) {
            setTimeout(() => {
              setRound((r) => r + 1);
            }, 1000);
          } else {
            endGame();
          }
          return newCount;
        }
        return newCount;
      });
    };

    // Play first beat immediately
    playBeat();
    // Then play at intervals
    beatIntervalRef.current = (setInterval(playBeat, beatInterval)) as unknown as NodeJS.Timeout;
  }, [round, beatInterval, isPlaying]);

  // Start new round
  useEffect(() => {
    if (done) return;
    if (round === 1 && beatCount === 0) {
      speakTTS('Tap when the drum plays! Start with 1 beat per second, then get faster.', { rate: 0.9 });
    }
    setIsPlaying(false);
    setBeatCount(0);
  }, [round, done]);

  const handleTap = useCallback(() => {
    if (!isPlaying || done) return;

    const now = Date.now();
    setLastTapTime(now);

    if (expectedTapTime) {
      const timeDiff = Math.abs(now - expectedTapTime);
      const tolerance = beatInterval * 0.3; // 30% tolerance

      if (timeDiff <= tolerance) {
        // Good tap!
        setScore((s) => s + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setShowSparkle(true);
        setTimeout(() => setShowSparkle(false), 1000);
      } else {
        // Too early or too late
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    }
  }, [isPlaying, done, expectedTapTime, beatInterval]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS * BEATS_PER_ROUND;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsPlaying(false);

    if (beatIntervalRef.current) {
      clearInterval(beatIntervalRef.current);
      beatIntervalRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'tap', // Using 'tap' as closest match for rhythm game
        correct: score,
        total: total,
        accuracy: accuracy,
        xpAwarded: xp,
      });
      await recordGame(xp);
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score]);

  useEffect(() => {
    return () => {
      // Cleanup: Stop all sounds and speech when component unmounts
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      if (beatIntervalRef.current) {
        clearInterval(beatIntervalRef.current);
        beatIntervalRef.current = null;
      }
    };
  }, []);

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xpAwarded={finalStats.xp}
          onHome={onBack}
          onPlayAgain={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            setBeatCount(0);
            setIsPlaying(false);
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
        <Text style={styles.title}>Beat Match Tap</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {isPlaying
              ? `Tap with the drum beat! (${Math.round(currentBPM)} BPM)`
              : 'Tap "Start" to begin!'}
          </Text>

          <TouchableOpacity
            style={[styles.drumButton, isPlaying && styles.drumButtonActive]}
            onPress={isPlaying ? handleTap : startBeatSequence}
            activeOpacity={0.8}
          >
            <Text style={styles.drumButtonText}>
              {isPlaying ? '🥁 TAP NOW!' : '▶️ Start Beat'}
            </Text>
          </TouchableOpacity>

          {isPlaying && (
            <View style={styles.beatIndicator}>
              <Text style={styles.beatText}>Beat: {beatCount}/{BEATS_PER_ROUND}</Text>
            </View>
          )}

          <SparkleBurst visible={showSparkle} />
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
    fontSize: 18,
    color: '#374151',
    textAlign: 'center',
    marginBottom: 32,
    fontWeight: '600',
  },
  drumButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  drumButtonActive: {
    backgroundColor: '#10B981',
    transform: [{ scale: 1.1 }],
  },
  drumButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  beatIndicator: {
    marginTop: 24,
    padding: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
  },
  beatText: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
  },
});

export default BeatMatchTapGame;


