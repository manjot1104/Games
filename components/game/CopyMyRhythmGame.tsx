import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ResultCard from './ResultCard';

const TOTAL_ROUNDS = 5;
const MIN_PATTERN_LENGTH = 3;
const MAX_PATTERN_LENGTH = 5;
const BEAT_INTERVAL = 600; // 600ms between beats

type GamePhase = 'idle' | 'listening' | 'recording' | 'finished';

export const CopyMyRhythmGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [pattern, setPattern] = useState<number[]>([]);
  const [, setUserPattern] = useState<number[]>([]);
  const [correct, setCorrect] = useState(0);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; accuracy: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const beatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const patternIndexRef = useRef(0);
  const userTapsRef = useRef<number[]>([]);
  const recordingStartRef = useRef<number>(0);
  
  // Track all speech timers
  const speechTimersRef = useRef<NodeJS.Timeout[]>([]);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clear all speech timers
      speechTimersRef.current.forEach(timer => clearTimeout(timer));
      speechTimersRef.current = [];
      stopAllSpeech();
      cleanupSounds();
      if (beatTimeoutRef.current) {
        clearTimeout(beatTimeoutRef.current);
        beatTimeoutRef.current = null;
      }
    };
  }, []);

  const generatePattern = useCallback(() => {
    const length = Math.floor(Math.random() * (MAX_PATTERN_LENGTH - MIN_PATTERN_LENGTH + 1)) + MIN_PATTERN_LENGTH;
    const newPattern: number[] = [];
    let currentTime = 0;
    
    for (let i = 0; i < length; i++) {
      newPattern.push(currentTime);
      currentTime += BEAT_INTERVAL;
    }
    
    return newPattern;
  }, []);

  const triggerGlow = useCallback(() => {
    glowAnim.setValue(0);
    Animated.sequence([
      Animated.timing(glowAnim, {
        toValue: 1,
        duration: 150,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: 0,
        duration: 150,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [glowAnim]);

  const finishGame = useCallback(async () => {
    setPhase('finished');
    if (beatTimeoutRef.current) {
      clearTimeout(beatTimeoutRef.current);
      beatTimeoutRef.current = null;
    }

    const total = TOTAL_ROUNDS;
    const accuracy = Math.round((correct / total) * 100);
    const xp = correct * 20;

    setFinalStats({ correct, total, accuracy, xp });

    try {
      const result = await logGameAndAward({
        type: 'tap', // Using 'tap' as closest match for rhythm game
        correct,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['rhythm-memory', 'pattern-recognition', 'auditory-motor-coordination'],
        meta: { rounds: round },
      });
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
    }

    speakTTS('Amazing! You copied all the rhythms!');
  }, [correct, round, router]);

  const playPattern = useCallback((patternToPlay: number[]) => {
    setPhase('listening');
    patternIndexRef.current = 0;
    
    const playNextBeat = () => {
      if (patternIndexRef.current >= patternToPlay.length) {
        setPhase('recording');
        speakTTS('Now copy the rhythm!');
        userTapsRef.current = [];
        recordingStartRef.current = Date.now();
        return;
      }

      triggerGlow();
      playSound('drum', 0.8, 1.0);
      
      patternIndexRef.current += 1;
      if (patternIndexRef.current < patternToPlay.length) {
        beatTimeoutRef.current = (setTimeout(playNextBeat, BEAT_INTERVAL)) as unknown as NodeJS.Timeout;
      } else {
        const timer = (setTimeout(() => {
          setPhase('recording');
          speakTTS('Now copy the rhythm!');
          userTapsRef.current = [];
          recordingStartRef.current = Date.now();
        }, BEAT_INTERVAL)) as unknown as NodeJS.Timeout;
        speechTimersRef.current.push(timer);
      }
    };

    // Start playing after a short delay
    const timer = (setTimeout(playNextBeat, 500)) as unknown as NodeJS.Timeout;
    speechTimersRef.current.push(timer);
  }, [triggerGlow]);

  const startRound = useCallback(() => {
    const newPattern = generatePattern();
    setPattern(newPattern);
    setUserPattern([]);
    playPattern(newPattern);
  }, [generatePattern, playPattern]);

  const handleTap = useCallback(() => {
    if (phase !== 'recording') return;

    const now = Date.now();
    const relativeTime = now - recordingStartRef.current;
    userTapsRef.current.push(relativeTime);

    // Visual feedback
    triggerGlow();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // Check if user has tapped enough times
    if (userTapsRef.current.length >= pattern.length) {
      // Compare patterns
      const tolerance = BEAT_INTERVAL * 0.4; // 40% tolerance
      let matches = 0;

      for (let i = 0; i < pattern.length; i++) {
        const expected = pattern[i];
        const actual = userTapsRef.current[i];
        if (Math.abs(actual - expected) <= tolerance) {
          matches += 1;
        }
      }

      const isCorrect = matches === pattern.length;
      if (isCorrect) {
        setCorrect((c) => c + 1);
        speakTTS('Perfect!');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else {
        speakTTS('Try again!');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }

      // Move to next round or finish
      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          startRound();
        } else {
          finishGame();
        }
      }, 1500);
    }
  }, [phase, pattern, round, startRound, triggerGlow, finishGame]);

  const startGame = useCallback(() => {
    setRound(1);
    setCorrect(0);
    startRound();
  }, [startRound]);

  useEffect(() => {
    if (phase === 'listening' || phase === 'recording') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 300,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 300,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [phase, pulseAnim]);

  const pulseStyle = {
    transform: [{ scale: pulseAnim }],
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
          <Text style={styles.emoji}>🎵</Text>
          <Text style={styles.title}>Rhythm Copy Complete!</Text>
          <Text style={styles.subtitle}>You matched the patterns perfectly!</Text>

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
        <Text style={styles.scoreText}>Correct: {correct}</Text>
      </View>

      {phase === 'idle' ? (
        <View style={styles.centerContent}>
          <Text style={styles.emoji}>🎵</Text>
          <Text style={styles.title}>Copy My Rhythm</Text>
          <Text style={styles.instructions}>
            Listen to the drum pattern,{'\n'}
            then tap the same rhythm!
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
          <Animated.View style={[styles.beatCircle, pulseStyle]}>
            <Animated.View style={[styles.glowRing, glowStyle]} />
            <LinearGradient
              colors={
                phase === 'listening'
                  ? ['#F59E0B', '#EF4444']
                  : phase === 'recording'
                  ? ['#10B981', '#059669']
                  : ['#6366F1', '#8B5CF6']
              }
              style={styles.circleGradient}
            >
              <Text style={styles.beatEmoji}>
                {phase === 'listening' ? '👂' : phase === 'recording' ? '👆' : '🥁'}
              </Text>
            </LinearGradient>
          </Animated.View>

          <Text style={styles.phaseText}>
            {phase === 'listening'
              ? 'LISTEN TO THE RHYTHM...'
              : phase === 'recording'
              ? 'NOW TAP THE SAME RHYTHM!'
              : 'GET READY...'}
          </Text>

          {phase === 'recording' && (
            <Text style={styles.tapCount}>
              Taps: {userTapsRef.current.length} / {pattern.length}
            </Text>
          )}

          {phase === 'recording' && (
            <TouchableOpacity
              style={styles.tapArea}
              onPress={handleTap}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#10B981', '#059669']}
                style={styles.tapButton}
              >
                <Text style={styles.tapButtonText}>TAP</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
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
    backgroundColor: '#F59E0B',
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
  phaseText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 16,
    textAlign: 'center',
  },
  tapCount: {
    fontSize: 18,
    color: '#6B7280',
    marginBottom: 32,
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


