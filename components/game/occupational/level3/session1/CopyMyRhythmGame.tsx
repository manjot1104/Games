import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, playSound } from '@/utils/soundPlayer';
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

const TOTAL_ROUNDS = 6;
const BEAT_PATTERNS = [
  [1, 1, 1], // 3 beats
  [1, 1, 1, 1], // 4 beats
  [1, 1, 1, 1, 1], // 5 beats
  [1, 0.5, 1, 0.5, 1], // 5 beats with pauses
  [1, 1, 0.5, 1, 1], // 5 beats with pause
  [1, 0.5, 1, 1, 0.5, 1], // 6 beats
];
const BEAT_INTERVAL = 600; // Base interval in ms

const CopyMyRhythmGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [phase, setPhase] = useState<'listen' | 'tap'>('listen');
  const [pattern, setPattern] = useState<number[]>([]);
  const [userTaps, setUserTaps] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showSparkle, setShowSparkle] = useState(false);

  const beatTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get pattern for current round
  const currentPattern = BEAT_PATTERNS[(round - 1) % BEAT_PATTERNS.length];

  // Play pattern for listening
  const playPattern = useCallback(() => {
    setIsPlaying(true);
    setPhase('listen');
    setUserTaps([]);
    let beatIndex = 0;

    const playNextBeat = () => {
      if (beatIndex >= currentPattern.length) {
        setIsPlaying(false);
        setPhase('tap');
        speakTTS('Now tap the same pattern!', 0.9 );
        return;
      }

      playSound('drum', 0.8, 1.0);
      const delay = currentPattern[beatIndex] * BEAT_INTERVAL;
      beatTimeoutRef.current = (setTimeout(playNextBeat, delay)) as unknown as NodeJS.Timeout;
      beatIndex++;
    };

    speakTTS('Listen to the pattern!', 0.9 );
    setTimeout(() => playNextBeat(), 500);
  }, [currentPattern]);

  // Start new round
  useEffect(() => {
    if (done) return;
    setPattern(currentPattern);
    setPhase('listen');
    setUserTaps([]);
    setIsPlaying(false);
    if (round === 1) {
      speakTTS('Listen to the rhythm pattern, then tap the same pattern!', { rate: 0.9 });
    }
    setTimeout(() => playPattern(), 1000);
  }, [round, done, currentPattern, playPattern]);

  const handleTap = useCallback(() => {
    if (phase !== 'tap' || isPlaying || done) return;

    const now = Date.now();
    // Play sound when user taps to match the pattern
    playSound('drum', 0.6, 1.0);
    setUserTaps((prev) => {
      const newTaps = [...prev, now];
      
      // Check if pattern is complete
      if (newTaps.length === currentPattern.length) {
        // Check if pattern matches
        let matches = true;
        for (let i = 1; i < newTaps.length; i++) {
          const expectedInterval = currentPattern[i - 1] * BEAT_INTERVAL;
          const actualInterval = newTaps[i] - newTaps[i - 1];
          const tolerance = BEAT_INTERVAL * 0.4;
          
          if (Math.abs(actualInterval - expectedInterval) > tolerance) {
            matches = false;
            break;
          }
        }

        if (matches) {
          setScore((s) => s + 1);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setShowSparkle(true);
          setTimeout(() => setShowSparkle(false), 1000);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }

        // Move to next round
        setTimeout(() => {
          if (round < TOTAL_ROUNDS) {
            setRound((r) => r + 1);
          } else {
            endGame();
          }
        }, 1500);
      }

      return newTaps;
    });
  }, [phase, isPlaying, done, currentPattern, round]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 20;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setIsPlaying(false);

    if (beatTimeoutRef.current) {
      clearTimeout(beatTimeoutRef.current);
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
      cleanupSounds();
      if (beatTimeoutRef.current) {
        clearTimeout(beatTimeoutRef.current);
        beatTimeoutRef.current = null;
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
            setPhase('listen');
            setUserTaps([]);
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
        <Text style={styles.title}>Copy My Rhythm</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {phase === 'listen'
              ? '👂 Listen to the pattern...'
              : `🎵 Tap the pattern! (${userTaps.length}/${currentPattern.length})`}
          </Text>

          <TouchableOpacity
            style={[styles.tapButton, phase === 'tap' && styles.tapButtonActive]}
            onPress={handleTap}
            disabled={phase !== 'tap' || isPlaying}
            activeOpacity={0.8}
          >
            <Text style={styles.tapButtonText}>
              {phase === 'listen' ? '👂 Listening...' : '🥁 TAP'}
            </Text>
          </TouchableOpacity>

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
  tapButton: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: '#6B7280',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tapButtonActive: {
    backgroundColor: '#3B82F6',
  },
  tapButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});

export default CopyMyRhythmGame;


