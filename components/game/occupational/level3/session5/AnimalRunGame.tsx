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
const ANIMAL_START_X = SCREEN_WIDTH * 0.5;
const ANIMAL_LEFT_X = SCREEN_WIDTH * 0.2;
const ANIMAL_RIGHT_X = SCREEN_WIDTH * 0.8;

type SwipeDirection = 'left' | 'right';
type AnimalType = 'dog' | 'cat' | 'rabbit' | 'chicken';

const ANIMAL_EMOJIS: Record<AnimalType, string> = {
  dog: '🐕',
  cat: '🐱',
  rabbit: '🐰',
  chicken: '🐔',
};

const AnimalRunGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showAnimal, setShowAnimal] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);
  const [targetDirection, setTargetDirection] = useState<SwipeDirection>('left');
  const [animalType, setAnimalType] = useState<AnimalType>('dog');

  const animalX = useRef(new Animated.Value(ANIMAL_START_X)).current;
  const animalScale = useRef(new Animated.Value(1)).current;
  const animalRotation = useRef(new Animated.Value(0)).current;
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
        
        // Move animal as user swipes
        if (deltaX < 0) {
          // Swiping left
          const newX = Math.max(ANIMAL_LEFT_X, ANIMAL_START_X + deltaX);
          animalX.setValue(newX);
          animalRotation.setValue(-10);
        } else if (deltaX > 0) {
          // Swiping right
          const newX = Math.min(ANIMAL_RIGHT_X, ANIMAL_START_X + deltaX);
          animalX.setValue(newX);
          animalRotation.setValue(10);
        }
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        
        if (showAnimal && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          const swipeDir: SwipeDirection = deltaX < 0 ? 'left' : 'right';
          
          if (swipeDir === targetDirection) {
            // Correct direction
            handleSuccess(swipeDir);
          } else {
            // Wrong direction
            handleMiss();
          }
        } else if (showAnimal && !hasSwiped && distance < SWIPE_THRESHOLD) {
          // Not enough swipe
          handleMiss();
        }
        
        // Reset rotation
        Animated.timing(animalRotation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  const showAnimalObject = useCallback(() => {
    // Random target direction
    const dir: SwipeDirection = Math.random() > 0.5 ? 'left' : 'right';
    setTargetDirection(dir);
    
    // Random animal
    const animals: AnimalType[] = ['dog', 'cat', 'rabbit', 'chicken'];
    const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
    setAnimalType(randomAnimal);
    
    setShowAnimal(true);
    setHasSwiped(false);
    animalX.setValue(ANIMAL_START_X);
    animalRotation.setValue(0);
    animalScale.setValue(1);
    
    Animated.spring(animalScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    const instruction = dir === 'left' 
      ? `${ANIMAL_EMOJIS[randomAnimal]} ko left le jao!` 
      : `${ANIMAL_EMOJIS[randomAnimal]} ko right le jao!`;
    
    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak(instruction, { rate: 0.8 });
      }, 300);
    } else {
      Speech.speak(instruction, { rate: 0.8 });
    }
  }, [animalScale, animalX, animalRotation]);

  const handleSuccess = useCallback((direction: SwipeDirection) => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Speech.speak('Great! Animal bhag gaya!', { rate: 0.9 });
    
    const targetX = direction === 'left' ? ANIMAL_LEFT_X : ANIMAL_RIGHT_X;
    const rotation = direction === 'left' ? -20 : 20;
    
    Animated.parallel([
      Animated.timing(animalX, {
        toValue: targetX,
        duration: 600,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.timing(animalRotation, {
          toValue: rotation,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(animalRotation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(animalScale, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(animalScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowAnimal(false);
        animalX.setValue(ANIMAL_START_X);
        animalRotation.setValue(0);
        animalScale.setValue(1);
      } else {
        endGame();
      }
    }, 1200);
  }, [round, animalX, animalRotation, animalScale]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    const correctDirection = targetDirection === 'left' ? 'left' : 'right';
    Speech.speak(`${correctDirection} swipe karo!`, { rate: 0.8 });
    // Reset animal position
    Animated.parallel([
      Animated.timing(animalX, {
        toValue: ANIMAL_START_X,
        duration: 300,
        useNativeDriver: false,
      }),
      Animated.timing(animalRotation, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [animalX, animalRotation, targetDirection]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showAnimalObject();
    }, 500);
  }, [done, showAnimalObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowAnimal(false);

    try {
      await logGameAndAward({
        type: 'animal-run',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['bilateral-coordination', 'direction-discrimination'],
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
        title="Animal Run"
        emoji="🐕"
        description="Swipe left or right to make the animal run!"
        skills={['Bilateral coordination', 'Direction discrimination']}
        suitableFor="Children learning left-right gestures and bilateral coordination"
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
            setShowAnimal(false);
            setHasSwiped(false);
            animalX.setValue(ANIMAL_START_X);
            animalRotation.setValue(0);
            animalScale.setValue(1);
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
        <Text style={styles.title}>Animal Run</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🐕 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {targetDirection === 'left' ? `${ANIMAL_EMOJIS[animalType]} ko left le jao!` : `${ANIMAL_EMOJIS[animalType]} ko right le jao!`}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showAnimal && (
          <Animated.View
            style={[
              styles.animalContainer,
              {
                left: animalX,
                transform: [
                  { rotate: animalRotation.interpolate({
                    inputRange: [-20, 20],
                    outputRange: ['-20deg', '20deg'],
                  }) },
                  { scale: animalScale },
                ],
              },
            ]}
          >
            <Text style={styles.animalEmoji}>{ANIMAL_EMOJIS[animalType]}</Text>
            {targetDirection === 'left' && (
              <View style={styles.directionIndicator}>
                <Text style={styles.directionArrow}>← LEFT</Text>
              </View>
            )}
            {targetDirection === 'right' && (
              <View style={styles.directionIndicator}>
                <Text style={styles.directionArrow}>RIGHT →</Text>
              </View>
            )}
          </Animated.View>
        )}

        {!showAnimal && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Bilateral coordination • Direction discrimination
        </Text>
        <Text style={styles.footerSubtext}>
          Swipe in the correct direction to make the animal run!
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
  animalContainer: {
    position: 'absolute',
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -70,
    marginTop: -70,
  },
  animalEmoji: {
    fontSize: 120,
  },
  directionIndicator: {
    position: 'absolute',
    bottom: -40,
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  directionArrow: {
    fontSize: 18,
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

export default AnimalRunGame;


