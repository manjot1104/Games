import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
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
const SWIPE_THRESHOLD = 100; // Need bigger swipe for whole arm coordination
const HAND_START_Y = SCREEN_HEIGHT * 0.7;
const HAND_UP_Y = SCREEN_HEIGHT * 0.3;
const RAIN_DROP_SPEED = 2;

const RainCatchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showRain, setShowRain] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);
  const [rainDrops, setRainDrops] = useState<Array<{ id: number; y: Animated.Value }>>([]);
  const [caughtDrops, setCaughtDrops] = useState(0);

  const handY = useRef(new Animated.Value(HAND_START_Y)).current;
  const handScale = useRef(new Animated.Value(1)).current;
  const swipeStartY = useRef(0);
  const swipeDistance = useRef(0);
  const rainDropIdCounter = useRef(0);

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
        
        // Move hands up as user swipes up
        if (deltaY < 0) {
          const newY = Math.max(HAND_UP_Y, HAND_START_Y + deltaY);
          handY.setValue(newY);
        }
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        
        if (showRain && !hasSwiped && distance >= SWIPE_THRESHOLD && deltaY < 0) {
          // Swipe up detected - check if caught rain drops
          checkRainCatch();
        } else if (showRain && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          // Wrong direction
          handleMiss();
        }
      },
    })
  ).current;

  const createRainDrop = useCallback(() => {
    const id = rainDropIdCounter.current++;
    const y = new Animated.Value(SCREEN_HEIGHT * 0.1);
    
    setRainDrops((prev) => [...prev, { id, y }]);
    
    // Animate rain drop falling
    Animated.timing(y, {
      toValue: SCREEN_HEIGHT * 0.9,
      duration: 2000,
      useNativeDriver: false,
    }).start(() => {
      // Remove rain drop when it reaches bottom
      setRainDrops((prev) => prev.filter((drop) => drop.id !== id));
    });
  }, []);

  const checkRainCatch = useCallback(() => {
    const handPosition = handY._value;
    const caught = rainDrops.filter((drop) => {
      const dropPosition = drop.y._value;
      return dropPosition >= handPosition - 50 && dropPosition <= handPosition + 50;
    }).length;

    if (caught > 0) {
      setCaughtDrops((c) => c + caught);
      handleSuccess(caught);
    } else {
      handleMiss();
    }
  }, [rainDrops, handY]);

  const showRainObject = useCallback(() => {
    setShowRain(true);
    setHasSwiped(false);
    setCaughtDrops(0);
    setRainDrops([]);
    handY.setValue(HAND_START_Y);
    handScale.setValue(1);
    rainDropIdCounter.current = 0;
    
    Animated.spring(handScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    // Create rain drops periodically
    let dropCount = 0;
    const maxDrops = 6;
    const rainInterval = setInterval(() => {
      dropCount++;
      if (dropCount <= maxDrops) {
        createRainDrop();
      } else {
        clearInterval(rainInterval);
      }
    }, 800);

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS('Hands up to catch rain drops!', 0.8 );
      }, 300);
    } else {
      speakTTS('Hands up to catch rain drops!', 0.8 );
    }
  }, [handScale, handY, createRainDrop]);

  const handleSuccess = useCallback((caught: number) => {
    setHasSwiped(true);
    setScore((s) => s + caught);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS(`Great! Caught ${caught} rain drop${caught > 1 ? 's' : ''}!`, 0.9 );
    
    Animated.sequence([
      Animated.timing(handScale, {
        toValue: 1.3,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(handScale, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Remove caught rain drops
    setRainDrops([]);

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowRain(false);
        handY.setValue(HAND_START_Y);
        handScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, handScale, handY]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speakTTS('Try swiping up with your hands!', 0.8 );
    // Reset hand position
    Animated.timing(handY, {
      toValue: HAND_START_Y,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [handY]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showRainObject();
    }, 500);
  }, [done, showRainObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowRain(false);

    try {
      await logGameAndAward({
        type: 'rain-catch',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['whole-arm-coordination'],
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
        stopTTS();
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
        title="Rain Catch"
        emoji="🌧️"
        description="Hands up to catch rain drops"
        skills={['Whole arm coordination']}
        suitableFor="Children learning whole arm movements and coordination"
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
            setShowRain(false);
            setHasSwiped(false);
            setRainDrops([]);
            handY.setValue(HAND_START_Y);
            handScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#DBEAFE', '#BFDBFE', '#93C5FD']}
        style={StyleSheet.absoluteFillObject}
      />
      
      <TouchableOpacity
        onPress={() => {
          try {
            stopTTS();
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
        <Text style={styles.title}>🌧️ Rain Catch</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showRain && (
          <View style={styles.instructionContainer}>
            <Text style={styles.instructionText}>⬆️ Hands UP to catch rain!</Text>
          </View>
        )}
        
        {/* Rain drops */}
        {rainDrops.map((drop) => (
          <Animated.View
            key={drop.id}
            style={[
              styles.rainDrop,
              {
                top: drop.y,
                left: Math.random() * SCREEN_WIDTH * 0.8 + SCREEN_WIDTH * 0.1,
              },
            ]}
          >
            <Text style={styles.rainEmoji}>💧</Text>
          </Animated.View>
        ))}
        
        <Animated.View
          style={[
            styles.handContainer,
            {
              top: handY,
              transform: [{ scale: handScale }],
            },
          ]}
        >
          <Text style={styles.handEmoji}>🙌</Text>
          <View style={styles.handGlow} />
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
    color: '#1E40AF',
    marginBottom: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E3A8A',
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
    color: '#1E40AF',
    textAlign: 'center',
  },
  rainDrop: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rainEmoji: {
    fontSize: 30,
  },
  handContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handEmoji: {
    fontSize: 100,
    zIndex: 2,
  },
  handGlow: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#3B82F6',
    opacity: 0.3,
    zIndex: 1,
  },
});

export default RainCatchGame;

