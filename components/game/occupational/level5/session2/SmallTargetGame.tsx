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
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    Pressable,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const TARGET_SIZE = 30; // Small target
const TOLERANCE = 40;

interface Target {
  id: string;
  x: number;
  y: number;
  scale: number;
}

const SmallTargetGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [targets, setTargets] = useState<Target[]>([]);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const hasSpokenRef = useRef(false);

  const generateTarget = useCallback(() => {
    const newTarget: Target = {
      id: `target-${Date.now()}`,
      x: Math.random() * (screenWidth.current - TARGET_SIZE) + TARGET_SIZE / 2,
      y: Math.random() * (screenHeight.current - TARGET_SIZE - 200) + TARGET_SIZE / 2 + 100,
      scale: 1,
    };
    setTargets([newTarget]);
  }, []);

  const handleTargetHit = useCallback((targetId: string) => {
    if (done || targets.length === 0) return;
    
    const target = targets.find(t => t.id === targetId);
    if (!target) return;

    // Hit!
    setTargets((prev) => prev.map((t) => 
      t.id === targetId ? { ...t, scale: 1.8 } : t
    ));
    setTimeout(() => {
      setTargets((prev) => prev.map((t) => 
        t.id === targetId ? { ...t, scale: 1 } : t
      ));
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
    speakTTS('Perfect!', 0.9, 'en-US' );
  }, [done, targets, generateTarget]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'small-target',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['finger-precision', 'fine-motor-control', 'accuracy'],
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
      // Only speak once when game starts, not on every round
      if (!hasSpokenRef.current) {
        hasSpokenRef.current = true;
        setTimeout(() => {
          speakTTS('Tap the tiny target!', 0.8, 'en-US' );
        }, 500);
      }
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
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Small Target"
        emoji="🎯"
        description="Tap the tiny target! Build your finger precision."
        skills={['Finger precision']}
        suitableFor="Children learning fine motor control and precision tapping"
        onStart={() => {
          setShowInfo(false);
        }}
        onBack={() => {
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
            stopAllSpeech();
            cleanupSounds();
            onBack?.();
          }}
          onPlayAgain={() => {
            setRound(1);
            setScore(0);
            setDone(false);
            setFinalStats(null);
            hasSpokenRef.current = false;
            generateTarget();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Small Target</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎯 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap the tiny target!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        {targets.map((target) => (
          <Pressable
            key={target.id}
            onPress={() => handleTargetHit(target.id)}
            style={[
              styles.target,
              {
                left: target.x - TARGET_SIZE / 2,
                top: target.y - TARGET_SIZE / 2,
                transform: [{ scale: target.scale }],
              },
            ]}
          >
            <Text style={styles.targetEmoji}>🎯</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Finger precision
        </Text>
        <Text style={styles.footerSubtext}>
          Tap the tiny target!
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
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#DC2626',
    shadowColor: '#EF4444',
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  targetEmoji: {
    fontSize: 18,
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

export default SmallTargetGame;
