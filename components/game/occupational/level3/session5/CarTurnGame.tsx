import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Dimensions,
    PanResponder,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const SWIPE_THRESHOLD = 80; // Minimum swipe distance for left/right gesture
const CAR_START_X = SCREEN_WIDTH * 0.5;
const CAR_LEFT_X = SCREEN_WIDTH * 0.2;
const CAR_RIGHT_X = SCREEN_WIDTH * 0.8;

type SwipeDirection = 'left' | 'right';

const CarTurnGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showCar, setShowCar] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);
  const [targetDirection, setTargetDirection] = useState<SwipeDirection>('left');

  const carX = useRef(new Animated.Value(CAR_START_X)).current;
  const carRotation = useRef(new Animated.Value(0)).current;
  const carScale = useRef(new Animated.Value(1)).current;
  const swipeStartX = useRef(0);
  const swipeDistance = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        swipeStartX.current = evt.nativeEvent.pageX;
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt) => {
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        swipeDistance.current = Math.abs(deltaX);
        
        // Move car as user swipes
        if (deltaX < 0) {
          // Swiping left
          const newX = Math.max(CAR_LEFT_X, CAR_START_X + deltaX);
          carX.setValue(newX);
          carRotation.setValue(-15);
        } else if (deltaX > 0) {
          // Swiping right
          const newX = Math.min(CAR_RIGHT_X, CAR_START_X + deltaX);
          carX.setValue(newX);
          carRotation.setValue(15);
        }
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        
        if (showCar && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          const swipeDir: SwipeDirection = deltaX < 0 ? 'left' : 'right';
          
          if (swipeDir === targetDirection) {
            // Correct direction
            handleSuccess(swipeDir);
          } else {
            // Wrong direction
            handleMiss();
          }
        } else if (showCar && !hasSwiped && distance < SWIPE_THRESHOLD) {
          // Not enough swipe
          handleMiss();
        }
        
        // Reset rotation
        Animated.timing(carRotation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  const showCarObject = useCallback(() => {
    // Random target direction
    const dir: SwipeDirection = Math.random() > 0.5 ? 'left' : 'right';
    setTargetDirection(dir);
    
    setShowCar(true);
    setHasSwiped(false);
    carX.setValue(CAR_START_X);
    carRotation.setValue(0);
    carScale.setValue(1);
    
    Animated.spring(carScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    const instruction = dir === 'left' 
      ? 'Swipe left to turn the car left!' 
      : 'Swipe right to turn the car right!';
    
    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak(instruction, { rate: 0.8 });
      }, 300);
    } else {
      Speech.speak(instruction, { rate: 0.8 });
    }
  }, [carScale, carX, carRotation]);

  const handleSuccess = useCallback((direction: SwipeDirection) => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Speech.speak('Great turn!', { rate: 0.9 });
    
    const targetX = direction === 'left' ? CAR_LEFT_X : CAR_RIGHT_X;
    const rotation = direction === 'left' ? -30 : 30;
    
    Animated.parallel([
      Animated.timing(carX, {
        toValue: targetX,
        duration: 500,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.timing(carRotation, {
          toValue: rotation,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(carRotation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(carScale, {
          toValue: 1.2,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(carScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowCar(false);
        carX.setValue(CAR_START_X);
        carRotation.setValue(0);
        carScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, carX, carRotation, carScale]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    const correctDirection = targetDirection === 'left' ? 'left' : 'right';
    Speech.speak(`Try swiping ${correctDirection}!`, { rate: 0.8 });
    // Reset car position
    Animated.parallel([
      Animated.timing(carX, {
        toValue: CAR_START_X,
        duration: 300,
        useNativeDriver: false,
      }),
      Animated.timing(carRotation, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [carX, carRotation, targetDirection]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showCarObject();
    }, 500);
  }, [done, showCarObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowCar(false);

    try {
      await logGameAndAward({
        type: 'car-turn',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['direction-discrimination', 'lateral-movement'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      startRound();
    }
  }, [showInfo, round, done, startRound]);

  useEffect(() => {
    return () => {
      try {
        Speech.stop();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Car Turn"
        emoji="🚗"
        description="Swipe left or right to turn the car!"
        skills={['Direction discrimination', 'Lateral movement']}
        suitableFor="Children learning left-right gestures and direction discrimination"
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

  // Result screen
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
            setShowCar(false);
            setHasSwiped(false);
            carX.setValue(CAR_START_X);
            carRotation.setValue(0);
            carScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} {...panResponder.panHandlers}>
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
        <Text style={styles.title}>Car Turn</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🚗 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {targetDirection === 'left' ? 'Swipe left to turn left!' : 'Swipe right to turn right!'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showCar && (
          <Animated.View
            style={[
              styles.carContainer,
              {
                left: carX,
                transform: [
                  { rotate: carRotation.interpolate({
                    inputRange: [-30, 30],
                    outputRange: ['-30deg', '30deg'],
                  }) },
                  { scale: carScale },
                ],
              },
            ]}
          >
            <Text style={styles.carEmoji}>🚗</Text>
            {targetDirection === 'left' && (
              <View style={styles.directionIndicator}>
                <Text style={styles.directionArrow}>←</Text>
              </View>
            )}
            {targetDirection === 'right' && (
              <View style={styles.directionIndicator}>
                <Text style={styles.directionArrow}>→</Text>
              </View>
            )}
          </Animated.View>
        )}

        {!showCar && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Direction discrimination • Lateral movement
        </Text>
        <Text style={styles.footerSubtext}>
          Swipe in the correct direction to turn the car!
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
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  carContainer: {
    position: 'absolute',
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -60,
    marginTop: -60,
  },
  carEmoji: {
    fontSize: 100,
  },
  directionIndicator: {
    position: 'absolute',
    top: -30,
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  directionArrow: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '800',
  },
  waitingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingText: {
    fontSize: 20,
    color: '#64748B',
    fontWeight: '600',
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

export default CarTurnGame;


