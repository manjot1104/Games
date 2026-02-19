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
const FAST_SWIPE_THRESHOLD = 300; // Maximum time for fast swipe (ms)
const MIN_SWIPE_DISTANCE = 50;

const FastRabbitRunGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showRabbit, setShowRabbit] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const rabbitX = useRef(new Animated.Value(SCREEN_WIDTH * 0.1)).current;
  const rabbitY = useRef(new Animated.Value(SCREEN_HEIGHT * 0.5)).current;
  const swipeStartTime = useRef(0);
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeDistance = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        swipeStartTime.current = Date.now();
        swipeStartX.current = evt.nativeEvent.pageX;
        swipeStartY.current = evt.nativeEvent.pageY;
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt) => {
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        swipeDistance.current = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        // Move rabbit quickly as user swipes
        if (swipeDistance.current > 10) {
          const newX = Math.max(SCREEN_WIDTH * 0.1, Math.min(SCREEN_WIDTH * 0.9, rabbitX._value + deltaX * 0.5));
          rabbitX.setValue(newX);
        }
      },
      onPanResponderRelease: (evt) => {
        const swipeTime = Date.now() - swipeStartTime.current;
        const distance = swipeDistance.current;
        
        if (showRabbit && !hasRun && distance >= MIN_SWIPE_DISTANCE) {
          // Check if swipe was fast (took less than threshold time)
          if (swipeTime <= FAST_SWIPE_THRESHOLD) {
            handleSuccess();
          } else {
            handleMiss();
          }
        }
      },
    })
  ).current;

  const showRabbitObject = useCallback(() => {
    setShowRabbit(true);
    setHasRun(false);
    rabbitX.setValue(SCREEN_WIDTH * 0.1);
    rabbitY.setValue(SCREEN_HEIGHT * 0.5);
    
    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS('Run the rabbit fast! Swipe quickly!', 0.8 );
      }, 300);
    } else {
      speakTTS('Run the rabbit fast! Swipe quickly!', 0.8 );
    }
  }, [rabbitX, rabbitY]);

  const handleSuccess = useCallback(() => {
    setHasRun(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    // Animate rabbit to finish line quickly
    Animated.timing(rabbitX, {
      toValue: SCREEN_WIDTH * 0.9,
      duration: 500,
      useNativeDriver: false,
    }).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowRabbit(false);
      } else {
        endGame();
      }
    }, 800);
  }, [round, rabbitX]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    // Reset rabbit position
    rabbitX.setValue(SCREEN_WIDTH * 0.1);
    setTimeout(() => {
      setHasRun(false);
    }, 500);
  }, [rabbitX]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showRabbitObject();
    }, 500);
  }, [done, showRabbitObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 12;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowRabbit(false);

    try {
      await logGameAndAward({
        type: 'fast-rabbit-run',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['speed-coordination', 'energy-control'],
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
        title="Fast Rabbit Run"
        emoji="🐰"
        description="Run the rabbit with fast swipe"
        skills={['Speed coordination', 'Energy control']}
        suitableFor="Children who want to develop speed coordination and energy control"
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
            setShowRabbit(false);
            setHasRun(false);
            rabbitX.setValue(SCREEN_WIDTH * 0.1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#FEF3C7', '#FDE68A', '#FCD34D']}
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
        <Text style={styles.title}>🐰 Fast Rabbit Run</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showRabbit && (
          <View style={styles.instructionContainer}>
            <Text style={styles.instructionText}>⚡ Swipe FAST to run rabbit!</Text>
          </View>
        )}
        
        {showRabbit && (
          <Animated.View
            style={[
              styles.rabbit,
              {
                left: rabbitX,
                top: rabbitY,
              },
            ]}
          >
            <Text style={styles.rabbitEmoji}>🐰</Text>
          </Animated.View>
        )}
        
        {!showRabbit && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready... 👀</Text>
          </View>
        )}
        
        {/* Finish line */}
        {showRabbit && (
          <View style={[styles.finishLine, { left: SCREEN_WIDTH * 0.85 }]}>
            <Text style={styles.finishText}>🏁</Text>
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
    position: 'relative',
  },
  instructionContainer: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#78350F',
    textAlign: 'center',
  },
  rabbit: {
    position: 'absolute',
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rabbitEmoji: {
    fontSize: 60,
  },
  waitingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#92400E',
  },
  finishLine: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.4,
    width: 4,
    height: 100,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishText: {
    fontSize: 30,
    marginTop: -40,
  },
});

export default FastRabbitRunGame;




