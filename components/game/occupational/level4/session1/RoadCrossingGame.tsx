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
const CAR_SIZE = 70;
const ROAD_WIDTH = 150;
const TOLERANCE = 60;

const RoadCrossingGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const carX = useSharedValue(SCREEN_WIDTH * 0.15);
  const carY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const carScale = useSharedValue(1);
  const leftRoadX = useSharedValue(SCREEN_WIDTH * 0.15);
  const leftRoadY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const rightRoadX = useSharedValue(SCREEN_WIDTH * 0.85);
  const rightRoadY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      if (done) return;
      setIsDragging(true);
      carScale.value = withSpring(1.2);
    })
    .onUpdate((e) => {
      if (done) return;
      const newX = e.x;
      const newY = e.y;
      carX.value = Math.max(CAR_SIZE / 2, Math.min(screenWidth.current - CAR_SIZE / 2, newX));
      carY.value = Math.max(CAR_SIZE / 2, Math.min(screenHeight.current - CAR_SIZE / 2, newY));
    })
    .onEnd(() => {
      if (done) return;
      setIsDragging(false);
      carScale.value = withSpring(1);

      const distance = Math.sqrt(
        Math.pow(carX.value - rightRoadX.value, 2) + Math.pow(carY.value - rightRoadY.value, 2)
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
              resetCar();
            }, 1500);
          }
          return newScore;
        });

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Car crossed!', 0.9, 'en-US' );
      } else {
        resetCar();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        speakTTS('Drag car to the right road!', 0.8, 'en-US' );
      }
    });

  const resetCar = useCallback(() => {
    carX.value = withSpring(leftRoadX.value);
    carY.value = withSpring(leftRoadY.value);
  }, [carX, carY, leftRoadX, leftRoadY]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'road-crossing',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['spatial-planning', 'drag-left-right'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      resetCar();
      speakTTS('Drag car from left road to right road!', 0.8, 'en-US' );
    }
  }, [showInfo, round, done, resetCar]);

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

  const carStyle = useAnimatedStyle(() => ({
    left: carX.value - CAR_SIZE / 2,
    top: carY.value - CAR_SIZE / 2,
    transform: [{ scale: carScale.value }],
  }));

  const leftRoadStyle = useAnimatedStyle(() => ({
    left: leftRoadX.value - ROAD_WIDTH / 2,
    top: leftRoadY.value - ROAD_WIDTH / 2,
  }));

  const rightRoadStyle = useAnimatedStyle(() => ({
    left: rightRoadX.value - ROAD_WIDTH / 2,
    top: rightRoadY.value - ROAD_WIDTH / 2,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Road Crossing"
        emoji="🚗"
        description="Drag car from left road to right road!"
        skills={['Spatial planning']}
        suitableFor="Children learning spatial planning through road crossing"
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
            resetCar();
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
        <Text style={styles.title}>Road Crossing</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🚗 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Drag car from left road to right road!
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
          leftRoadX.value = screenWidth.current * 0.15;
          leftRoadY.value = screenHeight.current * 0.5;
          rightRoadX.value = screenWidth.current * 0.85;
          rightRoadY.value = screenHeight.current * 0.5;
          resetCar();
        }}
      >
        <GestureDetector gesture={panGesture}>
          <Animated.View style={styles.gestureArea}>
            <Animated.View style={[styles.road, leftRoadStyle]}>
              <Text style={styles.roadLabel}>LEFT</Text>
            </Animated.View>

            <Animated.View style={[styles.road, rightRoadStyle]}>
              <Text style={styles.roadLabel}>RIGHT</Text>
            </Animated.View>

            <Animated.View style={[styles.car, carStyle]}>
              <Text style={styles.carEmoji}>🚗</Text>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Spatial planning
        </Text>
        <Text style={styles.footerSubtext}>
          Drag car from left road to right road!
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
    color: '#8B5CF6',
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
  road: {
    position: 'absolute',
    width: ROAD_WIDTH,
    height: ROAD_WIDTH,
    backgroundColor: '#6B7280',
    borderRadius: 12,
    borderWidth: 3,
    borderColor: '#4B5563',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  roadLabel: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  car: {
    position: 'absolute',
    width: CAR_SIZE,
    height: CAR_SIZE,
    borderRadius: CAR_SIZE / 2,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  carEmoji: {
    fontSize: 40,
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

export default RoadCrossingGame;
