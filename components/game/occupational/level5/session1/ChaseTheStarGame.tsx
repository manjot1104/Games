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
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const STAR_SIZE = 60;
const TOLERANCE = 50;

const ChaseTheStarGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  
  const starX = useSharedValue(SCREEN_WIDTH * 0.5);
  const starY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const starScale = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const animationRef = useRef<number | null>(null);
  const directionX = useRef(1);
  const directionY = useRef(1);
  const speedX = useRef(2);
  const speedY = useRef(2);
  const lastChangeTime = useRef(Date.now());

  const moveStar = useCallback(() => {
    const move = () => {
      'worklet';
      const now = Date.now();
      
      // Change direction randomly every 1-2 seconds
      if (now - lastChangeTime.current > 1000 + Math.random() * 1000) {
        directionX.current = Math.random() > 0.5 ? 1 : -1;
        directionY.current = Math.random() > 0.5 ? 1 : -1;
        speedX.current = 1.5 + Math.random() * 1.5;
        speedY.current = 1.5 + Math.random() * 1.5;
        lastChangeTime.current = now;
      }

      const newX = starX.value + speedX.current * directionX.current;
      const newY = starY.value + speedY.current * directionY.current;

      // Bounce off walls
      if (newX <= STAR_SIZE / 2 || newX >= screenWidth.current - STAR_SIZE / 2) {
        directionX.current *= -1;
        starX.value = Math.max(STAR_SIZE / 2, Math.min(screenWidth.current - STAR_SIZE / 2, newX));
      } else {
        starX.value = newX;
      }

      if (newY <= STAR_SIZE / 2 + 100 || newY >= screenHeight.current - STAR_SIZE / 2 - 100) {
        directionY.current *= -1;
        starY.value = Math.max(STAR_SIZE / 2 + 100, Math.min(screenHeight.current - STAR_SIZE / 2 - 100, newY));
      } else {
        starY.value = newY;
      }
    };

    const interval = setInterval(() => {
      move();
    }, 16); // ~60fps

    animationRef.current = interval as unknown as number;
  }, []);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    const distance = Math.sqrt(
      Math.pow(tapX - starX.value, 2) + Math.pow(tapY - starY.value, 2)
    );

    if (distance <= TOLERANCE + STAR_SIZE / 2) {
      // Success!
      starScale.value = withSpring(1.5, {}, () => {
        starScale.value = withSpring(1);
      });

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            resetStar();
          }, 1500);
        }
        return newScore;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Star caught!', 0.9, 'en-US' );
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [done, starX, starY, starScale]);

  const resetStar = useCallback(() => {
    // Random starting position
    starX.value = withSpring(Math.random() * (screenWidth.current - STAR_SIZE) + STAR_SIZE / 2);
    starY.value = withSpring(Math.random() * (screenHeight.current - STAR_SIZE - 200) + STAR_SIZE / 2 + 100);
    
    // Random direction
    directionX.current = Math.random() > 0.5 ? 1 : -1;
    directionY.current = Math.random() > 0.5 ? 1 : -1;
    
    // Random speed
    speedX.current = 1.5 + Math.random() * 1.5;
    speedY.current = 1.5 + Math.random() * 1.5;
    lastChangeTime.current = Date.now();
  }, [starX, starY]);

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
        type: 'chase-the-star',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['predictive-tracking', 'visual-tracking', 'reaction-time'],
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
      resetStar();
      setTimeout(() => {
        moveStar();
        speakTTS('Chase the moving star!', 0.8, 'en-US' );
      }, 500);
    }
  }, [showInfo, round, done, resetStar, moveStar]);

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

  const starStyle = useAnimatedStyle(() => ({
    left: starX.value - STAR_SIZE / 2,
    top: starY.value - STAR_SIZE / 2,
    transform: [{ scale: starScale.value }],
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Chase the Star"
        emoji="⭐"
        description="Chase and tap the star as it moves around!"
        skills={['Predictive tracking', 'Visual tracking']}
        suitableFor="Children learning predictive tracking"
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
            resetStar();
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
        <Text style={styles.title}>Chase the Star</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⭐ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Chase and tap the moving star!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
        onTouchEnd={handleTap}
      >
        <Animated.View style={[styles.star, starStyle]}>
          <Text style={styles.starEmoji}>⭐</Text>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Predictive tracking • Visual tracking
        </Text>
        <Text style={styles.footerSubtext}>
          Chase the star as it moves around!
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
  star: {
    position: 'absolute',
    width: STAR_SIZE,
    height: STAR_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FCD34D',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  starEmoji: {
    fontSize: 50,
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

export default ChaseTheStarGame;
