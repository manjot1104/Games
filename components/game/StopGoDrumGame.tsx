import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ResultCard from './ResultCard';

const TOTAL_ROUNDS = 8;
const BEAT_INTERVAL = 800; // 800ms between beats
const SOUND_DURATION = 2000; // Sound plays for 2 seconds
const SILENCE_DURATION = 2000; // Silence for 2 seconds

type GamePhase = 'idle' | 'playing' | 'finished';
type SoundState = 'playing' | 'silent';

export const StopGoDrumGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [soundState, setSoundState] = useState<SoundState>('silent');
  const [score, setScore] = useState(0);
  const [correctTaps, setCorrectTaps] = useState(0);
  const [wrongTaps, setWrongTaps] = useState(0);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; accuracy: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const soundIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const beatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track all speech timers
  const speechTimersRef = useRef<Array<NodeJS.Timeout>>([]);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const freezeAnim = useRef(new Animated.Value(0)).current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all speech timers
      speechTimersRef.current.forEach(timer => clearTimeout(timer));
      speechTimersRef.current = [];
      stopAllSpeech();
      cleanupSounds();
      if (soundIntervalRef.current) {
        clearTimeout(soundIntervalRef.current);
        soundIntervalRef.current = null;
      }
      if (beatIntervalRef.current) {
        clearTimeout(beatIntervalRef.current);
        beatIntervalRef.current = null;
      }
    };
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

  const triggerFreeze = useCallback(() => {
    freezeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(freezeAnim, {
        toValue: 1,
        duration: 100,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(freezeAnim, {
        toValue: 0,
        duration: 100,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [freezeAnim]);

  const startGame = useCallback(() => {
    // Clear any existing timers
    speechTimersRef.current.forEach(timer => clearTimeout(timer));
    speechTimersRef.current = [];
    
    setPhase('playing');
    setRound(1);
    setScore(0);
    setCorrectTaps(0);
    setWrongTaps(0);
    setSoundState('silent');
    speakTTS('Tap only when you hear the drum! Freeze when it stops!');
  }, []);

  // Sound pattern: play for 2s, silent for 2s, repeat
  useEffect(() => {
    if (phase !== 'playing') return;

    let currentState: SoundState = 'silent';
    let beatCount = 0;

    const playBeats = () => {
      if (currentState === 'playing') {
        triggerGlow();
        playSound('drum', 0.8, 1.0);
        beatCount++;
        
        if (beatCount < SOUND_DURATION / BEAT_INTERVAL) {
          beatIntervalRef.current = setTimeout(playBeats, BEAT_INTERVAL);
        } else {
          // Switch to silent
          currentState = 'silent';
          setSoundState('silent');
          beatCount = 0;
          soundIntervalRef.current = setTimeout(switchToPlaying, SILENCE_DURATION);
        }
      }
    };

    const switchToPlaying = () => {
      currentState = 'playing';
      setSoundState('playing');
      beatCount = 0;
      playBeats();
    };

    // Start with playing state
    setTimeout(() => {
      switchToPlaying();
    }, 1000);

    return () => {
      if (soundIntervalRef.current) {
        clearTimeout(soundIntervalRef.current);
      }
      if (beatIntervalRef.current) {
        clearTimeout(beatIntervalRef.current);
      }
    };
  }, [phase, triggerGlow]);

  const handleTap = useCallback(() => {
    if (phase !== 'playing') return;

    if (soundState === 'playing') {
      // Correct tap!
      setCorrectTaps((c) => c + 1);
      setScore((s) => s + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      
      // Check if round complete
      if (score + 1 >= round * 5) {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          speakTTS(`Round ${round + 1}!`);
        } else {
          finishGame();
        }
      }
    } else {
      // Wrong tap - should freeze!
      setWrongTaps((w) => w + 1);
      triggerFreeze();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      speakTTS('Freeze! Wait for the sound!');
    }
  }, [phase, soundState, score, round, triggerFreeze]);

  const finishGame = useCallback(async () => {
    setPhase('finished');
    if (soundIntervalRef.current) {
      clearTimeout(soundIntervalRef.current);
    }
    if (beatIntervalRef.current) {
      clearTimeout(beatIntervalRef.current);
    }

    const total = correctTaps + wrongTaps;
    const accuracy = total > 0 ? Math.round((correctTaps / total) * 100) : 0;
    const xp = correctTaps * 15;

    setFinalStats({ correct: correctTaps, total, accuracy, xp });

    try {
      const result = await logGameAndAward({
        type: 'stop-go-drum',
        correct: correctTaps,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['impulse-control', 'auditory-attention', 'response-inhibition'],
        meta: { rounds: round, wrongTaps },
      });
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
    }

    speakTTS('Excellent! You stopped and went perfectly!');
  }, [correctTaps, wrongTaps, round, router]);

  useEffect(() => {
    if (phase === 'playing') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: soundState === 'playing' ? 1.15 : 1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [phase, soundState, pulseAnim]);

  const pulseStyle = {
    transform: [{ scale: pulseAnim }],
  };

  const glowStyle = {
    opacity: glowAnim,
  };

  const freezeStyle = {
    opacity: freezeAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.3],
    }),
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
          <Text style={styles.emoji}>⏸️</Text>
          <Text style={styles.title}>Stop/Go Complete!</Text>
          <Text style={styles.subtitle}>You controlled your taps perfectly!</Text>

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
          <Text style={styles.emoji}>⏸️</Text>
          <Text style={styles.title}>Stop/Go Drum</Text>
          <Text style={styles.instructions}>
            Tap only when the drum is playing!{'\n'}
            Freeze when it stops!
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
          <Animated.View style={[styles.beatCircle, pulseStyle, freezeStyle]}>
            <Animated.View style={[styles.glowRing, glowStyle, { opacity: soundState === 'playing' ? 0.8 : 0 }]} />
            <LinearGradient
              colors={
                soundState === 'playing'
                  ? ['#10B981', '#059669']
                  : ['#6B7280', '#4B5563']
              }
              style={styles.circleGradient}
            >
              <Text style={styles.beatEmoji}>
                {soundState === 'playing' ? '🥁' : '⏸️'}
              </Text>
            </LinearGradient>
          </Animated.View>

          <Text style={styles.stateText}>
            {soundState === 'playing' ? 'TAP NOW!' : 'FREEZE! WAIT...'}
          </Text>

          <View style={styles.instructionBox}>
            <Text style={styles.instructionText}>
              {soundState === 'playing'
                ? 'The drum is playing - tap away!'
                : 'The drum stopped - don\'t tap!'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.tapArea,
              soundState === 'silent' && styles.tapAreaDisabled,
            ]}
            onPress={handleTap}
            activeOpacity={soundState === 'playing' ? 0.8 : 1}
            disabled={false} // Always allow tap to detect wrong taps
          >
            <LinearGradient
              colors={
                soundState === 'playing'
                  ? ['#10B981', '#059669']
                  : ['#6B7280', '#4B5563']
              }
              style={styles.tapButton}
            >
              <Text style={styles.tapButtonText}>
                {soundState === 'playing' ? 'TAP' : 'FREEZE'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
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
  beatCircle: {
    width: 200,
    height: 200,
    borderRadius: 100,
    marginBottom: 32,
    shadowColor: '#6366F1',
    shadowOpacity: 0.4,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  glowRing: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#10B981',
    top: -10,
    left: -10,
  },
  circleGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  beatEmoji: {
    fontSize: 80,
  },
  stateText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1F2937',
    marginBottom: 16,
    textAlign: 'center',
  },
  instructionBox: {
    backgroundColor: '#F3F4F6',
    padding: 16,
    borderRadius: 16,
    marginBottom: 32,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  instructionText: {
    fontSize: 16,
    color: '#4B5563',
    textAlign: 'center',
    fontWeight: '600',
  },
  tapArea: {
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#10B981',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  tapAreaDisabled: {
    shadowColor: '#6B7280',
    shadowOpacity: 0.2,
  },
  tapButton: {
    paddingHorizontal: 64,
    paddingVertical: 20,
  },
  tapButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 2,
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


