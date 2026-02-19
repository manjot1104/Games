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
const MIN_BALLOON_SIZE = 80;
const MAX_BALLOON_SIZE = 300;
const SWIPE_THRESHOLD = 50; // Minimum swipe distance

type SwipeDirection = 'big' | 'small';

const BalloonInflateGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [targetDirection, setTargetDirection] = useState<SwipeDirection>('big');
  const [balloonSize, setBalloonSize] = useState(MIN_BALLOON_SIZE);
  const [showTarget, setShowTarget] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);

  const balloonScale = useRef(new Animated.Value(1)).current;
  const balloonSizeAnim = useRef(new Animated.Value(MIN_BALLOON_SIZE)).current;
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
      onPanResponderMove: (evt, gestureState) => {
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        swipeDistance.current = Math.abs(deltaY);
        
        // Animate balloon based on swipe
        if (deltaY < 0) {
          // Swiping up = inflate (bigger)
          const newSize = Math.min(MAX_BALLOON_SIZE, MIN_BALLOON_SIZE + Math.abs(deltaY) * 0.5);
          balloonSizeAnim.setValue(newSize);
        } else {
          // Swiping down = deflate (smaller)
          const newSize = Math.max(MIN_BALLOON_SIZE, MAX_BALLOON_SIZE - deltaY * 0.5);
          balloonSizeAnim.setValue(newSize);
        }
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        
        if (showTarget && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          const direction: SwipeDirection = deltaY < 0 ? 'big' : 'small';
          
          if (direction === targetDirection) {
            handleSuccess();
          } else {
            handleMiss();
          }
        }
      },
    })
  ).current;

  const showTargetObject = useCallback(() => {
    const direction: SwipeDirection = Math.random() > 0.5 ? 'big' : 'small';
    setTargetDirection(direction);
    setShowTarget(true);
    setHasSwiped(false);
    setBalloonSize(MIN_BALLOON_SIZE);
    balloonSizeAnim.setValue(MIN_BALLOON_SIZE);
    
    Animated.spring(balloonScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS(direction === 'big' ? 'Swipe up to make it BIG!' : 'Swipe down to make it SMALL!', 0.8 );
      }, 300);
    } else {
      speakTTS(direction === 'big' ? 'Swipe up to make it BIG!' : 'Swipe down to make it SMALL!', 0.8 );
    }
  }, [balloonScale, balloonSizeAnim]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    Animated.parallel([
      Animated.timing(balloonScale, {
        toValue: 1.2,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(balloonSizeAnim, {
        toValue: targetDirection === 'big' ? MAX_BALLOON_SIZE : MIN_BALLOON_SIZE,
        duration: 300,
        useNativeDriver: false,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowTarget(false);
        balloonScale.setValue(1);
        balloonSizeAnim.setValue(MIN_BALLOON_SIZE);
      } else {
        endGame();
      }
    }, 800);
  }, [round, targetDirection, balloonScale, balloonSizeAnim]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    // Reset balloon
    Animated.timing(balloonSizeAnim, {
      toValue: MIN_BALLOON_SIZE,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [balloonSizeAnim]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showTargetObject();
    }, 500);
  }, [done, showTargetObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowTarget(false);

    try {
      await logGameAndAward({
        type: 'balloon-inflate',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['pressure-control', 'hand-strength-awareness'],
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
    const listener = balloonSizeAnim.addListener(({ value }) => {
      setBalloonSize(value);
    });
    return () => {
      balloonSizeAnim.removeListener(listener);
    };
  }, [balloonSizeAnim]);

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
        title="Balloon Inflate"
        emoji="🎈"
        description="Swipe to make balloon big or small"
        skills={['Pressure control', 'Hand strength awareness']}
        suitableFor="Children who want to develop pressure control and hand strength awareness"
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
            setShowTarget(false);
            setHasSwiped(false);
            balloonScale.setValue(1);
            balloonSizeAnim.setValue(MIN_BALLOON_SIZE);
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
        <Text style={styles.title}>🎈 Balloon Inflate</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showTarget && (
          <View style={styles.instructionContainer}>
            <Text style={styles.instructionText}>
              {targetDirection === 'big' ? '⬆️ Swipe UP to make BIG!' : '⬇️ Swipe DOWN to make SMALL!'}
            </Text>
          </View>
        )}
        
        <Animated.View
          style={[
            styles.balloonContainer,
            {
              transform: [{ scale: balloonScale }],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.balloon,
              {
                width: balloonSizeAnim,
                height: balloonSizeAnim,
                borderRadius: balloonSizeAnim.interpolate({
                  inputRange: [MIN_BALLOON_SIZE, MAX_BALLOON_SIZE],
                  outputRange: [MIN_BALLOON_SIZE / 2, MAX_BALLOON_SIZE / 2],
                }),
              },
            ]}
          >
            <LinearGradient
              colors={['#F97316', '#EA580C', '#DC2626']}
              style={styles.balloonGradient}
            >
              <Text style={styles.balloonEmoji}>🎈</Text>
            </LinearGradient>
          </Animated.View>
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
  instructionContainer: {
    position: 'absolute',
    top: 40,
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#78350F',
    textAlign: 'center',
  },
  balloonContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  balloon: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F97316',
    shadowOpacity: 0.5,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  balloonGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  balloonEmoji: {
    fontSize: 60,
  },
});

export default BalloonInflateGame;

