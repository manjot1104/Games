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
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FOOD_SIZE = 50;
const MONSTER_SIZE = 120;
const TOLERANCE = 60;

const FeedTheMonsterGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const foodX = useSharedValue(SCREEN_WIDTH * 0.15);
  const foodY = useSharedValue(SCREEN_HEIGHT * 0.4);
  const foodScale = useSharedValue(1);
  const monsterX = useSharedValue(SCREEN_WIDTH * 0.85);
  const monsterY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setIsDragging(true);
      foodScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      const newX = e.x;
      const newY = e.y;
      foodX.value = Math.max(FOOD_SIZE / 2, Math.min(screenWidth.current - FOOD_SIZE / 2, newX));
      foodY.value = Math.max(FOOD_SIZE / 2, Math.min(screenHeight.current - FOOD_SIZE / 2, newY));
    })
    .onEnd(() => {
      if (done) return;
      setIsDragging(false);
      foodScale.value = withSpring(1);

      const distance = Math.sqrt(
        Math.pow(foodX.value - monsterX.value, 2) + Math.pow(foodY.value - monsterY.value, 2)
      );

      if (distance <= TOLERANCE) {
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              resetFood();
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Monster fed!', 0.9, 'en-US' );
      } else {
        resetFood();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        speakTTS('Drag food to the monster!', 0.8, 'en-US' );
      }
    });

  const resetFood = useCallback(() => {
    foodX.value = withSpring(screenWidth.current * 0.15);
    foodY.value = withSpring(screenHeight.current * 0.4);
  }, [foodX, foodY, screenWidth, screenHeight]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'feed-monster',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['direction-control', 'arm-coordination', 'drag-left-right'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetFood();
      speakTTS('Drag food from left to right monster!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, resetFood]);

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

  const foodStyle = useAnimatedStyle(() => ({
    left: foodX.value - FOOD_SIZE / 2,
    top: foodY.value - FOOD_SIZE / 2,
    transform: [{ scale: foodScale.value }],
  }));

  const monsterStyle = useAnimatedStyle(() => ({
    left: monsterX.value - MONSTER_SIZE / 2,
    top: monsterY.value - MONSTER_SIZE / 2,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Feed the Monster"
        emoji="👹"
        description="Drag food from left side to right side monster!"
        skills={['Direction control', 'Arm coordination']}
        suitableFor="Children learning direction control and arm coordination"
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
            resetFood();
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
        <Text style={styles.title}>Feed the Monster</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 👹 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Drag food from left to right monster!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          monsterX.value = screenWidth.current * 0.85;
          monsterY.value = screenHeight.current * 0.5;
          resetFood();
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.monster, monsterStyle]}>
              <Text style={styles.monsterEmoji}>👹</Text>
              <Text style={styles.monsterLabel}>FEED ME!</Text>
            </Animated.View>

            <Animated.View style={[styles.food, foodStyle]}>
              <Text style={styles.foodEmoji}>🍎</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Direction control • Arm coordination
        </Text>
        <Text style={styles.footerSubtext}>
          Drag food from left side to right side monster!
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
    color: '#F59E0B',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    marginVertical: 40,
  },
  gestureArea: {
    flex: 1,
    position: 'relative',
  },
  monster: {
    position: 'absolute',
    width: MONSTER_SIZE,
    height: MONSTER_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  monsterEmoji: {
    fontSize: 80,
    marginBottom: 5,
  },
  monsterLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#EF4444',
  },
  food: {
    position: 'absolute',
    width: FOOD_SIZE,
    height: FOOD_SIZE,
    borderRadius: FOOD_SIZE / 2,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  foodEmoji: {
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

export default FeedTheMonsterGame;
