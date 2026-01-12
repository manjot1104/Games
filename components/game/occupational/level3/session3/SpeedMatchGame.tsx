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

type SpeedType = 'FAST' | 'SLOW';

const SpeedMatchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState<SpeedType>('FAST');
  const [showInstruction, setShowInstruction] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);

  const instructionScale = useRef(new Animated.Value(0)).current;
  const instructionOpacity = useRef(new Animated.Value(0)).current;
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
        
        if (showInstruction && !hasSwiped && distance >= MIN_SWIPE_DISTANCE) {
          const isFast = swipeTime <= FAST_SWIPE_THRESHOLD;
          const isSlow = swipeTime >= SLOW_SWIPE_THRESHOLD;
          
          if ((currentSpeed === 'FAST' && isFast) || (currentSpeed === 'SLOW' && isSlow)) {
            handleSuccess();
          } else {
            handleMiss();
          }
        }
      },
    })
  ).current;

  const showSpeedInstruction = useCallback(() => {
    const speed: SpeedType = Math.random() > 0.5 ? 'FAST' : 'SLOW';
    setCurrentSpeed(speed);
    setShowInstruction(true);
    setHasSwiped(false);
    
    Animated.parallel([
      Animated.spring(instructionScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(instructionOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak(speed === 'FAST' ? 'FAST! Swipe quickly!' : 'SLOW! Swipe slowly!', { rate: 0.8 });
      }, 300);
    } else {
      Speech.speak(speed === 'FAST' ? 'FAST! Swipe quickly!' : 'SLOW! Swipe slowly!', { rate: 0.8 });
    }
  }, [instructionScale, instructionOpacity]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    Animated.parallel([
      Animated.timing(instructionScale, {
        toValue: 1.2,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(instructionOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowInstruction(false);
        instructionScale.setValue(0);
        instructionOpacity.setValue(0);
      } else {
        endGame();
      }
    }, 500);
  }, [round, instructionScale, instructionOpacity]);

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
      showSpeedInstruction();
    }, 500);
  }, [done, showSpeedInstruction]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 12;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowInstruction(false);

    try {
      await logGameAndAward({
        type: 'speed-match',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['listening', 'movement-sync'],
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
        title="Speed Match"
        emoji="⚡🐢"
        description="Screen shows instruction: FAST or SLOW. Match the speed with your swipe!"
        skills={['Listening + movement sync']}
        suitableFor="Children who want to develop listening and movement synchronization"
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
            setShowInstruction(false);
            setHasSwiped(false);
            instructionScale.setValue(0);
            instructionOpacity.setValue(0);
          }}
        />
      </SafeAreaView>
    );
  }

  const colors = currentSpeed === 'FAST' 
    ? ['#F59E0B', '#D97706'] 
    : ['#3B82F6', '#2563EB'];

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#F0FDF4', '#DCFCE7', '#BBF7D0']}
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
        <Text style={styles.title}>⚡🐢 Speed Match</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showInstruction && (
          <Animated.View
            style={[
              styles.instructionBox,
              {
                transform: [{ scale: instructionScale }],
                opacity: instructionOpacity,
              },
            ]}
          >
            <LinearGradient
              colors={colors}
              style={styles.instructionGradient}
            >
              <Text style={styles.instructionText}>{currentSpeed}</Text>
              <Text style={styles.instructionSubtext}>
                {currentSpeed === 'FAST' ? 'Swipe quickly!' : 'Swipe slowly!'}
              </Text>
            </LinearGradient>
          </Animated.View>
        )}
        
        {!showInstruction && (
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
    color: '#065F46',
    marginBottom: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#047857',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  instructionBox: {
    width: SCREEN_WIDTH * 0.7,
    height: 200,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  instructionGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  instructionText: {
    fontSize: 72,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 4,
    marginBottom: 10,
  },
  instructionSubtext: {
    fontSize: 24,
    fontWeight: '700',
    color: '#E0E7FF',
  },
  waitingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#047857',
  },
});

export default SpeedMatchGame;

