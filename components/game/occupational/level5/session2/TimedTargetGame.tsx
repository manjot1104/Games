import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const TARGET_SIZE = 60;
const TOLERANCE = 50;
const TIME_LIMIT = 3000; // 3 seconds

interface Target {
  id: string;
  x: number;
  y: number;
  scale: number;
  timeLeft: number;
}

const TimedTargetGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [target, setTarget] = useState<Target | null>(null);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const hasSpokenRef = useRef(false);

  const generateTarget = useCallback(() => {
    const newTarget: Target = {
      id: `target-${Date.now()}`,
      x: Math.random() * (screenWidth.current - TARGET_SIZE) + TARGET_SIZE / 2,
      y: Math.random() * (screenHeight.current - TARGET_SIZE - 200) + TARGET_SIZE / 2 + 100,
      scale: 1,
      timeLeft: TIME_LIMIT,
    };
    setTarget(newTarget);

    // Start countdown
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    let timeRemaining = TIME_LIMIT;
    timerRef.current = setInterval(() => {
      timeRemaining -= 100;
      setTarget((prev) => prev ? { ...prev, timeLeft: timeRemaining } : null);

      if (timeRemaining <= 0) {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        // Time's up - move to next round
        setTimeout(() => {
          if (round < TOTAL_ROUNDS) {
            setRound((r) => r + 1);
            generateTarget();
          } else {
            endGame(score);
          }
        }, 1000);
      }
    }, 100);
  }, [round, score]);

  const handleTap = useCallback((tappedTarget: Target) => {
    if (done || !target || target.timeLeft <= 0 || tappedTarget.id !== target.id) return;
    
    // Hit in time!
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setTarget((prev) => prev ? { ...prev, scale: 1.8 } : null);
    setTimeout(() => {
      setTarget((prev) => prev ? { ...prev, scale: 1 } : null);
    }, 200);

    setScore((s) => {
      const newScore = s + 1;
      if (newScore >= TOTAL_ROUNDS) {
        setTimeout(() => {
          endGame(newScore);
        }, 1000);
      } else {
        setTimeout(() => {
          setRound((r) => r + 1);
          generateTarget();
        }, 1500);
      }
      return newScore;
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Fast and accurate!', 0.9, 'en-US' );
  }, [done, target, generateTarget]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'timed-target',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['speed', 'accuracy', 'reaction-time', 'time-pressure'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      // Stop any ongoing TTS when new round starts
      stopTTS();
      if (round === 1) {
        hasSpokenRef.current = false;
      }
      generateTarget();
      setTimeout(() => {
        if (!hasSpokenRef.current) {
          hasSpokenRef.current = true;
          speakTTS('Tap quickly before time runs out!', 0.8, 'en-US' );
        }
      }, 500);
    }
  }, [showInfo, round, done, generateTarget]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Timed Target"
        emoji="⏱️"
        description="Tap the target before time runs out! Build speed and accuracy."
        skills={['Speed + accuracy']}
        suitableFor="Children learning to work under time pressure with accuracy"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={() => {
          stopTTS();
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  if (done && finalStats) {
    return (
      <SafeAreaView style={styles.container}>
        <ResultCard
          correct={finalStats.correct}
          total={finalStats.total}
          xpAwarded={finalStats.xp}
          onHome={() => {
            stopTTS();
            stopAllSpeech();
            cleanupSounds();
            onBack?.();
          }}
          onPlayAgain={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            generateTarget();
          }}
        />
      </SafeAreaView>
    );
  }

  const timePercent = target ? (target.timeLeft / TIME_LIMIT) * 100 : 0;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopTTS();
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Timed Target</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⏱️ Score: {score}
        </Text>
        <View style={styles.timerContainer}>
          <View style={styles.timerBar}>
            <View style={[styles.timerFill, { width: `${timePercent}%` }]} />
          </View>
          <Text style={styles.timerText}>
            {target ? `${(target.timeLeft / 1000).toFixed(1)}s` : '0.0s'}
          </Text>
        </View>
        <Text style={styles.instruction}>
          Tap quickly before time runs out!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        {target && target.timeLeft > 0 && (
          <Pressable
            onPress={() => handleTap(target)}
            style={[
              styles.target,
              {
                left: target.x - TARGET_SIZE / 2,
                top: target.y - TARGET_SIZE / 2,
                transform: [{ scale: target.scale }],
                opacity: target.timeLeft > 0 ? 1 : 0.5,
              },
            ]}
          >
            <Text style={styles.targetEmoji}>🎯</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Speed + accuracy
        </Text>
        <Text style={styles.footerSubtext}>
          Tap quickly before time runs out!
        </Text>
      </View>
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
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 12,
  },
  timerContainer: {
    width: '80%',
    marginBottom: 12,
  },
  timerBar: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 4,
  },
  timerFill: {
    height: '100%',
    backgroundColor: '#EF4444',
  },
  timerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#EF4444',
    textAlign: 'center',
  },
  instruction: {
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    marginVertical: 40,
  },
  target: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: '#10B981',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#059669',
    shadowColor: '#10B981',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  targetEmoji: {
    fontSize: 35,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default TimedTargetGame;
