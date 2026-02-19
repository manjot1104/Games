import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ResultCard from './ResultCard';

const TOTAL_ROUNDS = 10;
const BEAT_INTERVAL = 1200; // 1.2 seconds between beats

type GamePhase = 'idle' | 'playing' | 'finished';
type BeatVolume = 'loud' | 'soft';

export const LoudSoftRhythmGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [currentBeat, setCurrentBeat] = useState<BeatVolume | null>(null);
  const [score, setScore] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; accuracy: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const beatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const beatSequenceRef = useRef<BeatVolume[]>([]);
  const currentBeatIndexRef = useRef(0);
  
  // Track all speech timers
  const speechTimersRef = useRef<Array<NodeJS.Timeout>>([]);

  // Animations
  const loudPulseAnim = useRef(new Animated.Value(1)).current;
  const softPulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all speech timers
      speechTimersRef.current.forEach(timer => clearTimeout(timer));
      speechTimersRef.current = [];
      stopAllSpeech();
      cleanupSounds();
      if (beatIntervalRef.current) {
        clearInterval(beatIntervalRef.current);
        beatIntervalRef.current = null;
      }
    };
  }, []);

  const generateBeatSequence = useCallback(() => {
    const sequence: BeatVolume[] = [];
    for (let i = 0; i < 5; i++) {
      sequence.push(Math.random() > 0.5 ? 'loud' : 'soft');
    }
    return sequence;
  }, []);

  const triggerGlow = useCallback(() => {
    glowAnim.setValue(0);
    Animated.sequence([
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [glowAnim]);

  const playBeat = useCallback((volume: BeatVolume) => {
    setCurrentBeat(volume);
    triggerGlow();
    
    // Play sound with appropriate volume
    const soundVolume = volume === 'loud' ? 1.0 : 0.3;
    playSound('drum', soundVolume, 1.0);

    // Clear beat after display time
    setTimeout(() => {
      setCurrentBeat(null);
    }, 400);
  }, [triggerGlow]);

  const startGame = useCallback(() => {
    setPhase('playing');
    setRound(1);
    setScore(0);
    setCorrect(0);
    setWrong(0);
    currentBeatIndexRef.current = 0;
    beatSequenceRef.current = generateBeatSequence();
    speakTTS('Use big button for loud beats, small button for soft beats!');
    
    // Start playing beats
    playBeat(beatSequenceRef.current[0]);
    currentBeatIndexRef.current = 1;

    beatIntervalRef.current = setInterval(() => {
      if (currentBeatIndexRef.current < beatSequenceRef.current.length) {
        playBeat(beatSequenceRef.current[currentBeatIndexRef.current]);
        currentBeatIndexRef.current += 1;
      } else {
        // Round complete
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          beatSequenceRef.current = generateBeatSequence();
          currentBeatIndexRef.current = 0;
          setTimeout(() => {
            playBeat(beatSequenceRef.current[0]);
            currentBeatIndexRef.current = 1;
          }, 1000);
        } else {
          finishGame();
        }
      }
    }, BEAT_INTERVAL);
  }, [round, generateBeatSequence, playBeat]);

  const handleLoudTap = useCallback(() => {
    if (phase !== 'playing' || !currentBeat) return;

    if (currentBeat === 'loud') {
      setCorrect((c) => c + 1);
      setScore((s) => s + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      setWrong((w) => w + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [phase, currentBeat]);

  const handleSoftTap = useCallback(() => {
    if (phase !== 'playing' || !currentBeat) return;

    if (currentBeat === 'soft') {
      setCorrect((c) => c + 1);
      setScore((s) => s + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      setWrong((w) => w + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }, [phase, currentBeat]);

  const finishGame = useCallback(async () => {
    setPhase('finished');
    if (beatIntervalRef.current) {
      clearInterval(beatIntervalRef.current);
    }

    const total = correct + wrong;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const xp = correct * 12;

    setFinalStats({ correct, total, accuracy, xp });

    try {
      const result = await logGameAndAward({
        type: 'loud-soft-rhythm',
        correct,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['volume-discrimination', 'auditory-discrimination', 'motor-control'],
        meta: { rounds: round },
      });
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
    }

    speakTTS('Amazing! You matched all the loud and soft beats!');
  }, [correct, wrong, round, router]);

  useEffect(() => {
    if (phase === 'playing' && currentBeat) {
      if (currentBeat === 'loud') {
        Animated.loop(
          Animated.sequence([
            Animated.timing(loudPulseAnim, {
              toValue: 1.2,
              duration: 300,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(loudPulseAnim, {
              toValue: 1,
              duration: 300,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        ).start();
      } else {
        Animated.loop(
          Animated.sequence([
            Animated.timing(softPulseAnim, {
              toValue: 1.1,
              duration: 400,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(softPulseAnim, {
              toValue: 1,
              duration: 400,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ])
        ).start();
      }
    }
  }, [phase, currentBeat, loudPulseAnim, softPulseAnim]);

  const loudPulseStyle = {
    transform: [{ scale: loudPulseAnim }],
  };

  const softPulseStyle = {
    transform: [{ scale: softPulseAnim }],
  };

  const glowStyle = {
    opacity: glowAnim,
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
            cleanupSounds();
            if (onBack) onBack();
          }}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.resultsContainer}>
          <Text style={styles.emoji}>🔊</Text>
          <Text style={styles.title}>Loud/Soft Complete!</Text>
          <Text style={styles.subtitle}>You matched all the volumes!</Text>

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
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.headerText}>Round {round} / {TOTAL_ROUNDS}</Text>
        <Text style={styles.scoreText}>Score: {score}</Text>
      </View>

      {phase === 'idle' ? (
        <View style={styles.centerContent}>
          <Text style={styles.emoji}>🔊</Text>
          <Text style={styles.title}>Loud/Soft Rhythm</Text>
          <Text style={styles.instructions}>
            Listen to each beat!{'\n'}
            Big button for LOUD beats{'\n'}
            Small button for SOFT beats
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
          <View style={styles.beatIndicator}>
            <Text style={styles.beatLabel}>
              {currentBeat ? (currentBeat === 'loud' ? 'LOUD BEAT!' : 'soft beat') : 'Listen...'}
            </Text>
          </View>

          <View style={styles.buttonsContainer}>
            {/* Big button for loud */}
            <Animated.View style={[styles.bigButtonContainer, loudPulseStyle]}>
              <Animated.View style={[styles.glowRing, glowStyle, { opacity: currentBeat === 'loud' ? 0.6 : 0 }]} />
              <TouchableOpacity
                style={styles.bigButton}
                onPress={handleLoudTap}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={currentBeat === 'loud' ? ['#EF4444', '#DC2626'] : ['#F59E0B', '#D97706']}
                  style={styles.buttonGradient}
                >
                  <Text style={styles.bigButtonText}>LOUD</Text>
                  <Text style={styles.bigButtonEmoji}>🔊</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>

            {/* Small button for soft */}
            <Animated.View style={[styles.smallButtonContainer, softPulseStyle]}>
              <TouchableOpacity
                style={styles.smallButton}
                onPress={handleSoftTap}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={currentBeat === 'soft' ? ['#6366F1', '#4F46E5'] : ['#8B5CF6', '#7C3AED']}
                  style={styles.buttonGradient}
                >
                  <Text style={styles.smallButtonText}>soft</Text>
                  <Text style={styles.smallButtonEmoji}>🔉</Text>
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  beatIndicator: {
    marginBottom: 40,
    padding: 20,
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  beatLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1F2937',
    textAlign: 'center',
  },
  buttonsContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 32,
  },
  bigButtonContainer: {
    position: 'relative',
  },
  bigButton: {
    width: 240,
    height: 240,
    borderRadius: 120,
    overflow: 'hidden',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  smallButtonContainer: {
    position: 'relative',
  },
  smallButton: {
    width: 140,
    height: 140,
    borderRadius: 70,
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  buttonGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bigButtonText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 3,
    marginBottom: 8,
  },
  bigButtonEmoji: {
    fontSize: 48,
  },
  smallButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 4,
  },
  smallButtonEmoji: {
    fontSize: 32,
  },
  glowRing: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#EF4444',
    top: -10,
    left: -10,
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


