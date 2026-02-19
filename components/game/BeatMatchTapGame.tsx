import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, playSound, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ResultCard from './ResultCard';

const TOTAL_ROUNDS = 10;
const INITIAL_BEAT_INTERVAL = 1000; // 1 beat per second
const MIN_BEAT_INTERVAL = 400; // Fastest: ~2.5 beats per second
const BEAT_INTERVAL_DECREASE = 100; // Decrease by 100ms each round

export const BeatMatchTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'finished'>('idle');
  const [isLit, setIsLit] = useState(false);
  const [beatInterval, setBeatInterval] = useState(INITIAL_BEAT_INTERVAL);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; accuracy: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const beatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastBeatTimeRef = useRef<number>(0);
  const lastTapTimeRef = useRef<number>(0);
  const correctTapsRef = useRef(0);
  const totalTapsRef = useRef(0);
  
  // Track all speech timers
  const speechTimersRef = useRef<Array<NodeJS.Timeout>>([]);

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const startPulse = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: beatInterval / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: beatInterval / 2,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim, beatInterval]);

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

  const startGame = useCallback(() => {
    setGameState('playing');
    setRound(1);
    setScore(0);
    setBeatInterval(INITIAL_BEAT_INTERVAL);
    correctTapsRef.current = 0;
    totalTapsRef.current = 0;
    lastBeatTimeRef.current = Date.now();
    lastTapTimeRef.current = 0;
    speakTTS('Tap when you hear the drum beat!');
    startPulse();
  }, [startPulse]);

  // Beat generation
  useEffect(() => {
    if (gameState !== 'playing') return;

    const playBeat = () => {
      const now = Date.now();
      lastBeatTimeRef.current = now;
      setIsLit(true);
      triggerGlow();
      playSound('drum', 0.8, 1.0);
      
      setTimeout(() => {
        setIsLit(false);
      }, 200);
    };

    // Play first beat immediately
    playBeat();

    // Set up interval for subsequent beats
    beatIntervalRef.current = setInterval(() => {
      playBeat();
    }, beatInterval);

    return () => {
      if (beatIntervalRef.current) {
        clearInterval(beatIntervalRef.current);
        beatIntervalRef.current = null;
      }
      // Clear all speech timers
      speechTimersRef.current.forEach(timer => clearTimeout(timer));
      speechTimersRef.current = [];
      stopAllSpeech();
      cleanupSounds();
    };
  }, [gameState, beatInterval, triggerGlow]);

  const handleTap = useCallback(() => {
    if (gameState !== 'playing') return;

    const now = Date.now();
    const timeSinceBeat = now - lastBeatTimeRef.current;
    const windowSize = beatInterval * 0.5; // 50% of beat interval is acceptable

    totalTapsRef.current += 1;

    if (timeSinceBeat >= 0 && timeSinceBeat <= windowSize) {
      // Good tap!
      correctTapsRef.current += 1;
      setScore((s) => s + 1);
      
      // Success animation
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.2,
          duration: 100,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 100,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      // Check if round complete
      if (score + 1 >= round * 3) {
        // Move to next round with faster beat
        if (round < TOTAL_ROUNDS) {
          const newInterval = Math.max(MIN_BEAT_INTERVAL, beatInterval - BEAT_INTERVAL_DECREASE);
          setBeatInterval(newInterval);
          setRound((r) => r + 1);
          speakTTS(`Round ${round + 1}! Faster beats!`);
        } else {
          // Game complete
          finishGame();
        }
      }
    } else {
      // Missed or too early
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }

    lastTapTimeRef.current = now;
  }, [gameState, score, round, beatInterval, scaleAnim]);

  const finishGame = useCallback(async () => {
    setGameState('finished');
    if (beatIntervalRef.current) {
      clearInterval(beatIntervalRef.current);
      beatIntervalRef.current = null;
    }

    const correct = correctTapsRef.current;
    const total = totalTapsRef.current;
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
    const xp = correct * 12;

    setFinalStats({ correct, total, accuracy, xp });

    try {
      const result = await logGameAndAward({
        type: 'beat-match-tap',
        correct,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['rhythm-timing', 'auditory-motor-coordination', 'beat-synchronization'],
        meta: { rounds: round, finalBeatInterval: beatInterval },
      });
      setLogTimestamp(result?.last?.at ?? null);
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
    }

    speakTTS('Amazing! You matched the beats perfectly!');
  }, [round, beatInterval, router]);

  const pulseStyle = {
    transform: [{ scale: pulseAnim }],
  };

  const glowStyle = {
    opacity: glowAnim,
  };

  const scaleStyle = {
    transform: [{ scale: scaleAnim }],
  };

  // Results screen
  if (gameState === 'finished' && finalStats) {
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
          <Text style={styles.emoji}>🥁</Text>
          <Text style={styles.title}>Beat Match Complete!</Text>
          <Text style={styles.subtitle}>You tapped with the rhythm!</Text>

          <ResultCard
            correct={finalStats.correct}
            total={finalStats.total}
            xpAwarded={finalStats.xp}
            accuracy={finalStats.accuracy}
            logTimestamp={logTimestamp}
            onPlayAgain={() => {
              setGameState('idle');
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

      {gameState === 'idle' ? (
        <View style={styles.centerContent}>
          <Text style={styles.emoji}>🥁</Text>
          <Text style={styles.title}>Beat Match Tap</Text>
          <Text style={styles.instructions}>
            Tap when you hear the drum beat!{'\n'}
            The beats will get faster each round.
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
          <Animated.View style={[styles.beatCircle, pulseStyle, scaleStyle]}>
            <Animated.View style={[styles.glowRing, glowStyle, { opacity: isLit ? 0.8 : 0 }]} />
            <LinearGradient
              colors={isLit ? ['#F59E0B', '#EF4444'] : ['#6366F1', '#8B5CF6']}
              style={styles.circleGradient}
            >
              <Text style={styles.beatEmoji}>🥁</Text>
            </LinearGradient>
          </Animated.View>

          <Text style={styles.tapHint}>TAP WHEN YOU HEAR THE BEAT!</Text>
          <Text style={styles.beatInfo}>
            {Math.round(1000 / beatInterval * 10) / 10} beats per second
          </Text>

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
  tapHint: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
    textAlign: 'center',
  },
  beatInfo: {
    fontSize: 16,
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


