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

const TOTAL_ROUNDS = 12;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FAST_SWIPE_THRESHOLD = 300; // Maximum time for fast swipe (ms)
const SLOW_SWIPE_THRESHOLD = 1000; // Minimum time for slow swipe (ms)
const MIN_SWIPE_DISTANCE = 50;

type LightColor = 'green' | 'yellow' | 'red';

const TrafficLightGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentLight, setCurrentLight] = useState<LightColor>('green');
  const [showLight, setShowLight] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);

  const lightScale = useRef(new Animated.Value(0)).current;
  const lightOpacity = useRef(new Animated.Value(0)).current;
  const swipeStartTime = useRef(0);
  const swipeDistance = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        swipeStartTime.current = Date.now();
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt, gestureState) => {
        swipeDistance.current = Math.sqrt(gestureState.dx * gestureState.dx + gestureState.dy * gestureState.dy);
      },
      onPanResponderRelease: (evt) => {
        const swipeTime = Date.now() - swipeStartTime.current;
        const distance = swipeDistance.current;
        
        if (showLight && !hasSwiped && distance >= MIN_SWIPE_DISTANCE) {
          if (currentLight === 'green') {
            // Green = fast
            if (swipeTime <= FAST_SWIPE_THRESHOLD) {
              handleSuccess();
            } else {
              handleMiss();
            }
          } else if (currentLight === 'yellow') {
            // Yellow = slow
            if (swipeTime >= SLOW_SWIPE_THRESHOLD) {
              handleSuccess();
            } else {
              handleMiss();
            }
          } else {
            // Red = no swipe (wait)
            handleMiss();
          }
        }
      },
    })
  ).current;

  const showTrafficLight = useCallback(() => {
    // Randomly choose green or yellow (red would be too hard)
    const light: LightColor = Math.random() > 0.5 ? 'green' : 'yellow';
    setCurrentLight(light);
    setShowLight(true);
    setHasSwiped(false);
    
    Animated.parallel([
      Animated.spring(lightScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(lightOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak(light === 'green' ? 'Green light! Go fast!' : 'Yellow light! Go slow!', { rate: 0.8 });
      }, 300);
    } else {
      Speech.speak(light === 'green' ? 'Green light! Go fast!' : 'Yellow light! Go slow!', { rate: 0.8 });
    }
  }, [lightScale, lightOpacity]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    Animated.parallel([
      Animated.timing(lightScale, {
        toValue: 1.2,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(lightOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowLight(false);
        lightScale.setValue(0);
        lightOpacity.setValue(0);
      } else {
        endGame();
      }
    }, 500);
  }, [round, lightScale, lightOpacity]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    setTimeout(() => {
      setHasSwiped(false);
      swipeDistance.current = 0;
    }, 500);
  }, []);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showTrafficLight();
    }, 500);
  }, [done, showTrafficLight]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 12;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowLight(false);

    try {
      await logGameAndAward({
        type: 'traffic-light-game',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['rule-following', 'response-inhibition'],
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
        title="Traffic Light Game"
        emoji="🚦"
        description="Green = fast, Yellow = slow. Follow the traffic light rules!"
        skills={['Rule following', 'Response inhibition']}
        suitableFor="Children who want to develop rule following and response inhibition"
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
            setShowLight(false);
            setHasSwiped(false);
            lightScale.setValue(0);
            lightOpacity.setValue(0);
          }}
        />
      </SafeAreaView>
    );
  }

  const lightColor = currentLight === 'green' ? '#10B981' : '#F59E0B';
  const lightText = currentLight === 'green' ? 'GO FAST!' : 'GO SLOW!';

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
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
        <Text style={styles.title}>🚦 Traffic Light</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showLight && (
          <Animated.View
            style={[
              styles.trafficLight,
              {
                transform: [{ scale: lightScale }],
                opacity: lightOpacity,
              },
            ]}
          >
            <View style={styles.lightContainer}>
              <View style={[styles.light, { backgroundColor: currentLight === 'red' ? '#EF4444' : '#4B5563' }]} />
              <View style={[styles.light, { backgroundColor: currentLight === 'yellow' ? '#F59E0B' : '#4B5563' }]} />
              <View style={[styles.light, { backgroundColor: currentLight === 'green' ? '#10B981' : '#4B5563' }]} />
            </View>
            <Text style={[styles.lightText, { color: lightColor }]}>{lightText}</Text>
          </Animated.View>
        )}
        
        {!showLight && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready... 👀</Text>
          </View>
        )}
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
    color: '#78350F',
    marginBottom: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#92400E',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  trafficLight: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightContainer: {
    width: 120,
    height: 300,
    backgroundColor: '#1F2937',
    borderRadius: 60,
    padding: 20,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
    borderWidth: 4,
    borderColor: '#374151',
  },
  light: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: '#111827',
  },
  lightText: {
    fontSize: 36,
    fontWeight: '900',
    textAlign: 'center',
  },
  waitingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#92400E',
  },
});

export default TrafficLightGame;

