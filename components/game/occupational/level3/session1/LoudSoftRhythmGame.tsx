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
const BEATS_PER_ROUND = 6;
const BEAT_INTERVAL = 1000;

type VolumeType = 'loud' | 'soft';

const LoudSoftRhythmGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentVolume, setCurrentVolume] = useState<VolumeType | null>(null);
  const [beatCount, setBeatCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const sparkleX = useRef(new Animated.Value(0)).current;
  const sparkleY = useRef(new Animated.Value(0)).current;
  const beatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Generate random pattern of loud/soft beats
  const generatePattern = (): VolumeType[] => {
    const pattern: VolumeType[] = [];
    for (let i = 0; i < BEATS_PER_ROUND; i++) {
      pattern.push(Math.random() > 0.5 ? 'loud' : 'soft');
    }
    return pattern;
  };

  const [pattern, setPattern] = useState<VolumeType[]>([]);

  // Start beat sequence
  const startBeatSequence = useCallback(() => {
    if (isPlaying) return;
    const newPattern = generatePattern();
    setPattern(newPattern);
    setIsPlaying(true);
    setBeatCount(0);
    setCurrentVolume(null);

    let beatIndex = 0;

    const playNextBeat = () => {
      if (beatIndex >= newPattern.length) {
        setIsPlaying(false);
        setCurrentVolume(null);
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
        }, 1500);
        return;
      }

      const volume = newPattern[beatIndex];
      setCurrentVolume(volume);
      setBeatCount(beatIndex + 1);

      if (volume === 'loud') {
        playSound('drum', 0.9, 1.0); // Loud drum sound
      } else {
        playSound('drum', 0.3, 1.0); // Soft drum sound
      }

      beatIndex++;
    };

    // Start immediately
    playNextBeat();
    // Then repeat at intervals
    beatIntervalRef.current = setInterval(playNextBeat, BEAT_INTERVAL);
  }, [round, isPlaying]);

  // Start new round
  useEffect(() => {
    if (done) return;
    setIsPlaying(false);
    setCurrentVolume(null);
    setBeatCount(0);
    if (round === 1) {
      speakTTS('Big button for loud beats, small button for soft beats!', { rate: 0.9 });
    }
  }, [round, done]);

  const handleTap = useCallback(
    (volume: VolumeType) => {
      if (!isPlaying || done || !currentVolume) return;

      if (volume === currentVolume) {
        // Correct tap
        setScore((s) => s + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        sparkleX.setValue(volume === 'loud' ? 30 : 70);
        sparkleY.setValue(50);
      } else {
        // Wrong tap
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    },
    [isPlaying, done, currentVolume],
  );

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS * BEATS_PER_ROUND;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsPlaying(false);
    setCurrentVolume(null);

    if (beatIntervalRef.current) {
      clearInterval(beatIntervalRef.current);
      beatIntervalRef.current = null;
    }

    try {
      const timestamp = new Date().toISOString();
      await logGameAndAward({
        gameId: 'loud-soft-rhythm',
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
        gameId: 'loud-soft-rhythm',
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
            setCurrentVolume(null);
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
        <Text style={styles.title}>Loud/Soft Rhythm</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {isPlaying
              ? currentVolume === 'loud'
                ? '🔊 LOUD - Tap Big!'
                : '🔉 SOFT - Tap Small!'
              : 'Tap "Start" to begin!'}
          </Text>

          {!isPlaying ? (
            <TouchableOpacity style={styles.startButton} onPress={startBeatSequence} activeOpacity={0.8}>
              <Text style={styles.startButtonText}>▶️ Start</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.bigButton, currentVolume === 'loud' && styles.bigButtonActive]}
                onPress={() => handleTap('loud')}
                activeOpacity={0.8}
              >
                <Text style={styles.buttonText}>🔊 BIG</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.smallButton, currentVolume === 'soft' && styles.smallButtonActive]}
                onPress={() => handleTap('soft')}
                activeOpacity={0.8}
              >
                <Text style={styles.buttonText}>🔉 SMALL</Text>
              </TouchableOpacity>
            </View>
          )}

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
  startButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  startButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 24,
    alignItems: 'center',
  },
  bigButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bigButtonActive: {
    backgroundColor: '#10B981',
    transform: [{ scale: 1.1 }],
  },
  smallButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#6B7280',
    justifyContent: 'center',
    alignItems: 'center',
  },
  smallButtonActive: {
    backgroundColor: '#3B82F6',
    transform: [{ scale: 1.1 }],
  },
  buttonText: {
    fontSize: 18,
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

export default LoudSoftRhythmGame;


