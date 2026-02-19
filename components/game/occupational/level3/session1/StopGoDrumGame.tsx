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

const TOTAL_ROUNDS = 8;
const BEAT_INTERVAL = 800; // ms between beats
const SOUND_DURATION = 400; // ms sound plays
const SILENT_DURATION = 600; // ms silence

const StopGoDrumGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDrumPlaying, setIsDrumPlaying] = useState(false);
  const [beatCount, setBeatCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const sparkleX = useRef(new Animated.Value(0)).current;
  const sparkleY = useRef(new Animated.Value(0)).current;
  const beatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const BEATS_PER_ROUND = 6;

  // Start beat sequence
  const startBeatSequence = useCallback(() => {
    if (isPlaying) return;
    setIsPlaying(true);
    setBeatCount(0);
    setIsDrumPlaying(false);

    const playCycle = () => {
      // Play sound
      setIsDrumPlaying(true);
      playSound('drum', 0.8, 1.0);
      setBeatCount((prev) => {
        const newCount = prev + 1;
        if (newCount >= BEATS_PER_ROUND) {
          setIsPlaying(false);
          setIsDrumPlaying(false);
          if (beatIntervalRef.current) {
            clearInterval(beatIntervalRef.current);
            beatIntervalRef.current = null;
          }
          // Move to next round
          setTimeout(() => {
            if (round < TOTAL_ROUNDS) {
              setRound((r) => r + 1);
            } else {
              endGame();
            }
          }, 1000);
          return newCount;
        }
        return newCount;
      });

      // Stop sound after SOUND_DURATION
      setTimeout(() => {
        setIsDrumPlaying(false);
      }, SOUND_DURATION);
    };

    // Start immediately
    playCycle();
    // Then repeat at intervals
    beatIntervalRef.current = setInterval(playCycle, BEAT_INTERVAL);
  }, [round, isPlaying]);

  // Start new round
  useEffect(() => {
    if (done) return;
    setIsPlaying(false);
    setIsDrumPlaying(false);
    setBeatCount(0);
    if (round === 1) {
      speakTTS('Tap only while the drum is playing! Freeze when it stops.', 0.9 );
    }
  }, [round, done]);

  const handleTap = useCallback(() => {
    if (!isPlaying || done) return;

    if (isDrumPlaying) {
      // Correct tap during sound
      setScore((s) => s + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      sparkleX.setValue(50);
      sparkleY.setValue(50);
    } else {
      // Wrong tap during silence
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [isPlaying, done, isDrumPlaying]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS * BEATS_PER_ROUND;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsPlaying(false);
    setIsDrumPlaying(false);

    if (beatIntervalRef.current) {
      clearInterval(beatIntervalRef.current);
      beatIntervalRef.current = null;
    }

    try {
      const timestamp = new Date().toISOString();
      await logGameAndAward({
        gameId: 'stop-go-drum',
        therapyId: 'occupational',
        levelNumber: 3,
        sessionNumber: 1,
        score,
        totalRounds: total,
        accuracy,
        xp,
        timestamp,
      });
      await recordGame({
        gameId: 'stop-go-drum',
        therapyId: 'occupational',
        levelNumber: 3,
        sessionNumber: 1,
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

  useEffect(() => {
    return () => {
      // Cleanup: Stop all sounds and speech when component unmounts
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
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
          xp={finalStats.xp}
          onBack={onBack}
          onRetry={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            setBeatCount(0);
            setIsPlaying(false);
            setIsDrumPlaying(false);
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
        <Text style={styles.title}>Stop/Go Drum</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {isPlaying
              ? isDrumPlaying
                ? '🥁 TAP NOW!'
                : '🛑 FREEZE!'
              : 'Tap "Start" to begin!'}
          </Text>

          <TouchableOpacity
            style={[
              styles.drumButton,
              isDrumPlaying && styles.drumButtonActive,
              !isDrumPlaying && isPlaying && styles.drumButtonSilent,
            ]}
            onPress={isPlaying ? handleTap : startBeatSequence}
            activeOpacity={0.8}
          >
            <Text style={styles.drumButtonText}>
              {isPlaying
                ? isDrumPlaying
                  ? '🥁 TAP!'
                  : '🛑 FREEZE'
                : '▶️ Start'}
            </Text>
          </TouchableOpacity>

          {isPlaying && (
            <View style={styles.beatIndicator}>
              <Text style={styles.beatText}>Beat: {beatCount}/{BEATS_PER_ROUND}</Text>
            </View>
          )}

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
    backgroundColor: '#6B7280',
    justifyContent: 'center',
    alignItems: 'center',
  },
  drumButtonActive: {
    backgroundColor: '#10B981',
  },
  drumButtonSilent: {
    backgroundColor: '#EF4444',
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

export default StopGoDrumGame;


