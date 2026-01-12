import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
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
const SWIPE_THRESHOLD = 80;
const FLOOR_HEIGHT = SCREEN_HEIGHT * 0.15;
const GROUND_FLOOR_Y = SCREEN_HEIGHT * 0.7;
const TOP_FLOOR_Y = SCREEN_HEIGHT * 0.2;

type Floor = 'ground' | 'top';

const ElevatorGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [targetFloor, setTargetFloor] = useState<Floor>('top');
  const [showElevator, setShowElevator] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);
  const [currentFloor, setCurrentFloor] = useState<Floor>('ground');

  const elevatorY = useRef(new Animated.Value(GROUND_FLOOR_Y)).current;
  const elevatorScale = useRef(new Animated.Value(1)).current;
  const swipeStartY = useRef(0);
  const swipeDistance = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        swipeStartY.current = evt.nativeEvent.pageY;
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt) => {
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        swipeDistance.current = Math.abs(deltaY);
        
        // Move elevator based on swipe direction
        if (deltaY < 0) {
          // Swiping up
          const newY = Math.max(TOP_FLOOR_Y, elevatorY._value + deltaY * 0.5);
          elevatorY.setValue(newY);
        } else {
          // Swiping down
          const newY = Math.min(GROUND_FLOOR_Y, elevatorY._value + deltaY * 0.5);
          elevatorY.setValue(newY);
        }
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        
        if (showElevator && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          const isUp = deltaY < 0;
          const isDown = deltaY > 0;
          
          if (targetFloor === 'top' && isUp) {
            handleSuccess();
          } else if (targetFloor === 'ground' && isDown) {
            handleSuccess();
          } else {
            handleMiss();
          }
        }
      },
    })
  ).current;

  const showElevatorObject = useCallback(() => {
    const floor: Floor = Math.random() > 0.5 ? 'top' : 'ground';
    setTargetFloor(floor);
    setCurrentFloor(floor === 'top' ? 'ground' : 'top');
    setShowElevator(true);
    setHasSwiped(false);
    
    const startY = floor === 'top' ? GROUND_FLOOR_Y : TOP_FLOOR_Y;
    elevatorY.setValue(startY);
    elevatorScale.setValue(1);
    
    Animated.spring(elevatorScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak(floor === 'top' ? 'Swipe up to go to top floor!' : 'Swipe down to go to ground floor!', { rate: 0.8 });
      }, 300);
    } else {
      Speech.speak(floor === 'top' ? 'Swipe up to go to top floor!' : 'Swipe down to go to ground floor!', { rate: 0.8 });
    }
  }, [elevatorScale, elevatorY]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Speech.speak('Great! Elevator moved!', { rate: 0.9 });
    
    const targetY = targetFloor === 'top' ? TOP_FLOOR_Y : GROUND_FLOOR_Y;
    
    Animated.parallel([
      Animated.timing(elevatorY, {
        toValue: targetY,
        duration: 500,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.timing(elevatorScale, {
          toValue: 1.1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(elevatorScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowElevator(false);
        elevatorY.setValue(GROUND_FLOOR_Y);
        elevatorScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, targetFloor, elevatorY, elevatorScale]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    Speech.speak(targetFloor === 'top' ? 'Try swiping up!' : 'Try swiping down!', { rate: 0.8 });
    // Reset elevator position
    const startY = targetFloor === 'top' ? GROUND_FLOOR_Y : TOP_FLOOR_Y;
    Animated.timing(elevatorY, {
      toValue: startY,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [targetFloor, elevatorY]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showElevatorObject();
    }, 500);
  }, [done, showElevatorObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowElevator(false);

    try {
      await logGameAndAward({
        type: 'elevator-game',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['concept-clarity', 'up-down'],
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
        title="Elevator Game"
        emoji="🛗"
        description="Up = top floor, Down = ground"
        skills={['Concept clarity (up/down)']}
        suitableFor="Children learning up-down concepts and spatial understanding"
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
            setShowElevator(false);
            setHasSwiped(false);
            elevatorY.setValue(GROUND_FLOOR_Y);
            elevatorScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F3F4F6', '#E5E7EB', '#D1D5DB']}
        style={StyleSheet.absoluteFillObject}
      />
      
      <TouchableOpacity
        onPress={() => {
          try {
            Speech.stop();
          } catch (e) {
            // Ignore errors
          }
          stopAllSpeech();
          cleanupSounds();
          if (onBack) onBack();
        }}
        style={styles.backButton}
      >
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>🛗 Elevator Game</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showElevator && (
          <View style={styles.instructionContainer}>
            <Text style={styles.instructionText}>
              {targetFloor === 'top' ? '⬆️ Swipe UP to top floor!' : '⬇️ Swipe DOWN to ground!'}
            </Text>
          </View>
        )}
        
        {/* Building floors */}
        <View style={[styles.floor, { top: TOP_FLOOR_Y }]}>
          <Text style={styles.floorLabel}>TOP FLOOR</Text>
        </View>
        <View style={[styles.floor, { top: GROUND_FLOOR_Y }]}>
          <Text style={styles.floorLabel}>GROUND FLOOR</Text>
        </View>
        
        <Animated.View
          style={[
            styles.elevatorContainer,
            {
              top: elevatorY,
              transform: [{ scale: elevatorScale }],
            },
          ]}
        >
          <LinearGradient
            colors={['#6366F1', '#4F46E5', '#4338CA']}
            style={styles.elevator}
          >
            <Text style={styles.elevatorEmoji}>🛗</Text>
            <View style={styles.elevatorDoor}>
              <View style={styles.doorLine} />
            </View>
          </LinearGradient>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  backText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  header: {
    paddingTop: 100,
    paddingHorizontal: 24,
    paddingBottom: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#1F2937',
    marginBottom: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  instructionContainer: {
    position: 'absolute',
    top: 40,
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1F2937',
    textAlign: 'center',
  },
  floor: {
    position: 'absolute',
    left: SCREEN_WIDTH * 0.1,
    right: SCREEN_WIDTH * 0.1,
    height: 60,
    backgroundColor: '#9CA3AF',
    borderWidth: 2,
    borderColor: '#6B7280',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  floorLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
  },
  elevatorContainer: {
    position: 'absolute',
    left: SCREEN_WIDTH * 0.15,
    width: SCREEN_WIDTH * 0.7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  elevator: {
    width: SCREEN_WIDTH * 0.6,
    height: 100,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#6366F1',
    shadowOpacity: 0.5,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  elevatorEmoji: {
    fontSize: 50,
  },
  elevatorDoor: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  doorLine: {
    width: 2,
    height: '80%',
    backgroundColor: '#FFFFFF',
    opacity: 0.5,
  },
});

export default ElevatorGame;

