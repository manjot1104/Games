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
const DOT_SIZE = 50;
const TOLERANCE = 50;
const SPEED = 0.5; // Slow speed for better visibility and control

interface MovingDot {
  id: string;
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  scale: number;
}

const MovingTargetGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const [dot, setDot] = useState<MovingDot | null>(null);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const animationRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);

  const generateDot = useCallback(() => {
    const newDot: MovingDot = {
      id: `dot-${Date.now()}`,
      x: Math.random() * (screenWidth.current - DOT_SIZE) + DOT_SIZE / 2,
      y: Math.random() * (screenHeight.current - DOT_SIZE - 200) + DOT_SIZE / 2 + 100,
      directionX: (Math.random() > 0.5 ? 1 : -1) * SPEED,
      directionY: (Math.random() > 0.5 ? 1 : -1) * SPEED,
      scale: 1,
    };
    setDot(newDot);
  }, []);

  const moveDot = useCallback(() => {
    if (!dot || done) return;

    const move = () => {
      setDot((prev) => {
        if (!prev) return null;
        
        let newX = prev.x + prev.directionX;
        let newY = prev.y + prev.directionY;
        let newDirX = prev.directionX;
        let newDirY = prev.directionY;

        // Bounce off walls
        if (newX <= DOT_SIZE / 2 || newX >= screenWidth.current - DOT_SIZE / 2) {
          newDirX *= -1;
          newX = Math.max(DOT_SIZE / 2, Math.min(screenWidth.current - DOT_SIZE / 2, newX));
        }
        if (newY <= DOT_SIZE / 2 + 100 || newY >= screenHeight.current - DOT_SIZE / 2 - 100) {
          newDirY *= -1;
          newY = Math.max(DOT_SIZE / 2 + 100, Math.min(screenHeight.current - DOT_SIZE / 2 - 100, newY));
        }

        return {
          ...prev,
          x: newX,
          y: newY,
          directionX: newDirX,
          directionY: newDirY,
        };
      });
    };

    const interval = setInterval(move, 30); // Slower update for better visibility
    animationRef.current = interval as unknown as number;
  }, [dot, done]);

  const handleDotHit = useCallback(() => {
    if (done || !dot) return;

    // Hit!
    setDot((prev) => prev ? { ...prev, scale: 1.8 } : null);
    setTimeout(() => {
      setDot((prev) => prev ? { ...prev, scale: 1 } : null);
    }, 200);

    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }

    setScore((s) => {
      const newScore = s + 1;
      if (newScore >= TOTAL_ROUNDS) {
        setTimeout(() => {
          endGame(newScore);
        }, 1000);
      } else {
        setTimeout(() => {
          setRound((r) => r + 1);
          generateDot();
        }, 1500);
      }
      return newScore;
    });

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Great timing!', 0.9, 'en-US' );
  }, [done, dot, generateDot]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    if (animationRef.current) {
      clearInterval(animationRef.current);
      animationRef.current = null;
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'moving-target',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['timing-control', 'hand-eye-coordination', 'reaction-time'],
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
      generateDot();
      setTimeout(() => {
        moveDot();
        // Only speak once when game starts, not on every round
        if (!hasSpokenRef.current) {
          hasSpokenRef.current = true;
          speakTTS('Tap the moving dot!', 0.8, 'en-US' );
        }
      }, 500);
    }
  }, [showInfo, round, done, generateDot, moveDot]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (animationRef.current) {
        clearInterval(animationRef.current);
      }
    };
  }, []);

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Moving Target"
        emoji="⚫"
        description="Tap the moving dot! Build your timing control."
        skills={['Timing control']}
        suitableFor="Children learning timing and hand-eye coordination"
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
            generateDot();
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
        <Text style={styles.title}>Moving Target</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⚫ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Tap the moving dot!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        {dot && (
          <Pressable
            onPress={handleDotHit}
            style={[
              styles.dot,
              {
                left: dot.x - DOT_SIZE / 2,
                top: dot.y - DOT_SIZE / 2,
                transform: [{ scale: dot.scale }],
              },
            ]}
          >
            <Text style={styles.dotEmoji}>⚫</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Timing control
        </Text>
        <Text style={styles.footerSubtext}>
          Tap the moving dot!
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
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: '#1F2937',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#000',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  dotEmoji: {
    fontSize: 30,
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

export default MovingTargetGame;
