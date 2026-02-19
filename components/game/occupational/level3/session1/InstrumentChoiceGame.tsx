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
const INSTRUMENTS = ['drum', 'bell', 'clap'] as const;
type Instrument = typeof INSTRUMENTS[number];

const InstrumentChoiceGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentInstrument, setCurrentInstrument] = useState<Instrument | null>(null);
  const [phase, setPhase] = useState<'listen' | 'choose'>('listen');
  const [selectedInstrument, setSelectedInstrument] = useState<Instrument | null>(null);

  const sparkleX = useRef(new Animated.Value(0)).current;
  const sparkleY = useRef(new Animated.Value(0)).current;

  // Play random instrument
  const playInstrument = useCallback(() => {
    const instrument = INSTRUMENTS[Math.floor(Math.random() * INSTRUMENTS.length)];
    setCurrentInstrument(instrument);
    setPhase('listen');
    setSelectedInstrument(null);

    // Play sound
    if (instrument === 'drum') {
      playSound('drum', 0.8, 1.0);
    } else if (instrument === 'bell') {
      playSound('bell', 0.8, 1.0);
    } else {
      playSound('clap', 0.8, 1.0);
    }

    // After sound, allow choice
    setTimeout(() => {
      setPhase('choose');
    }, 1000);
  }, []);

  // Start new round
  useEffect(() => {
    if (done) return;
    if (round === 1) {
      speakTTS('Listen to the instrument, then choose which one it was!', { rate: 0.9 });
    }
    setTimeout(() => playInstrument(), 500);
  }, [round, done, playInstrument]);

  const handleInstrumentChoice = useCallback(
    (instrument: Instrument) => {
      if (phase !== 'choose' || !currentInstrument || done) return;

      setSelectedInstrument(instrument);
      
      // Play sound when user taps the chosen instrument
      if (instrument === 'drum') {
        playSound('drum', 0.6, 1.0);
      } else if (instrument === 'bell') {
        playSound('bell', 0.6, 1.0);
      } else {
        playSound('clap', 0.6, 1.0);
      }

      if (instrument === currentInstrument) {
        // Correct!
        setScore((s) => s + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        sparkleX.setValue(50);
        sparkleY.setValue(50);
      } else {
        // Wrong
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
    },
    [phase, currentInstrument, done, round],
  );

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 18;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setPhase('listen');
    setCurrentInstrument(null);
    setSelectedInstrument(null);

    try {
      const timestamp = new Date().toISOString();
      await logGameAndAward({
        gameId: 'instrument-choice',
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
        gameId: 'instrument-choice',
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
            setPhase('listen');
            setCurrentInstrument(null);
            setSelectedInstrument(null);
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
        <Text style={styles.title}>Instrument Choice</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.gameArea}>
          <Text style={styles.instructionText}>
            {phase === 'listen'
              ? '👂 Listen to the instrument...'
              : '🎵 Which instrument was it?'}
          </Text>

          {phase === 'choose' && (
            <View style={styles.instrumentContainer}>
              <TouchableOpacity
                style={[
                  styles.instrumentButton,
                  styles.drumButton,
                  selectedInstrument === 'drum' &&
                    (currentInstrument === 'drum' ? styles.correctButton : styles.wrongButton),
                ]}
                onPress={() => handleInstrumentChoice('drum')}
                disabled={selectedInstrument !== null}
                activeOpacity={0.8}
              >
                <Text style={styles.instrumentEmoji}>🥁</Text>
                <Text style={styles.instrumentText}>Drum</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.instrumentButton,
                  styles.bellButton,
                  selectedInstrument === 'bell' &&
                    (currentInstrument === 'bell' ? styles.correctButton : styles.wrongButton),
                ]}
                onPress={() => handleInstrumentChoice('bell')}
                disabled={selectedInstrument !== null}
                activeOpacity={0.8}
              >
                <Text style={styles.instrumentEmoji}>🔔</Text>
                <Text style={styles.instrumentText}>Bell</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.instrumentButton,
                  styles.clapButton,
                  selectedInstrument === 'clap' &&
                    (currentInstrument === 'clap' ? styles.correctButton : styles.wrongButton),
                ]}
                onPress={() => handleInstrumentChoice('clap')}
                disabled={selectedInstrument !== null}
                activeOpacity={0.8}
              >
                <Text style={styles.instrumentEmoji}>👏</Text>
                <Text style={styles.instrumentText}>Clap</Text>
              </TouchableOpacity>
            </View>
          )}

          {phase === 'listen' && (
            <View style={styles.listeningIndicator}>
              <Text style={styles.listeningText}>👂 Listening...</Text>
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
  instrumentContainer: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  instrumentButton: {
    width: 120,
    height: 120,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  drumButton: {
    backgroundColor: '#8B5CF6',
  },
  bellButton: {
    backgroundColor: '#F59E0B',
  },
  clapButton: {
    backgroundColor: '#3B82F6',
  },
  correctButton: {
    backgroundColor: '#10B981',
    transform: [{ scale: 1.1 }],
  },
  wrongButton: {
    backgroundColor: '#EF4444',
  },
  instrumentEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  instrumentText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  listeningIndicator: {
    padding: 24,
    backgroundColor: '#EFF6FF',
    borderRadius: 16,
  },
  listeningText: {
    fontSize: 20,
    color: '#3B82F6',
    fontWeight: '600',
  },
});

export default InstrumentChoiceGame;


