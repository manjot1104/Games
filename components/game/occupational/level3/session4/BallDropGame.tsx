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
const SWIPE_THRESHOLD = 80; // Minimum swipe distance for down gesture
const BALL_START_Y = SCREEN_HEIGHT * 0.2;
const BALL_END_Y = SCREEN_HEIGHT * 0.8;

const BallDropGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showBall, setShowBall] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);

  const ballY = useRef(new Animated.Value(BALL_START_Y)).current;
  const ballScale = useRef(new Animated.Value(1)).current;
  const ballRotation = useRef(new Animated.Value(0)).current;
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
        
        // Move ball down as user swipes down
        if (deltaY > 0) {
          const newY = Math.min(BALL_END_Y, BALL_START_Y + deltaY);
          ballY.setValue(newY);
          ballRotation.setValue(deltaY * 0.1);
        }
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        
        if (showBall && !hasSwiped && distance >= SWIPE_THRESHOLD && deltaY > 0) {
          // Swipe down detected
          handleSuccess();
        } else if (showBall && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          // Wrong direction
          handleMiss();
        }
      },
    })
  ).current;

  const showBallObject = useCallback(() => {
    setShowBall(true);
    setHasSwiped(false);
    ballY.setValue(BALL_START_Y);
    ballScale.setValue(1);
    ballRotation.setValue(0);
    
    Animated.spring(ballScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS('Swipe down to drop the ball!', 0.8 );
      }, 300);
    } else {
      speakTTS('Swipe down to drop the ball!', 0.8 );
    }
  }, [ballScale, ballY, ballRotation]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Great! Ball dropped!', 0.9 );
    
    Animated.parallel([
      Animated.timing(ballY, {
        toValue: BALL_END_Y,
        duration: 500,
        useNativeDriver: false,
      }),
      Animated.timing(ballRotation, {
        toValue: 360,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(ballScale, {
          toValue: 1.2,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(ballScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowBall(false);
        ballY.setValue(BALL_START_Y);
        ballScale.setValue(1);
        ballRotation.setValue(0);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, ballY, ballScale, ballRotation]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speakTTS('Try swiping down!', 0.8 );
    // Reset ball position
    Animated.timing(ballY, {
      toValue: BALL_START_Y,
      duration: 300,
      useNativeDriver: false,
    }).start();
    ballRotation.setValue(0);
  }, [ballY, ballRotation]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showBallObject();
    }, 500);
  }, [done, showBallObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowBall(false);

    try {
      await logGameAndAward({
        type: 'ball-drop',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['vertical-movement-understanding'],
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
        title="Ball Drop"
        emoji="⚽"
        description="Swipe down to drop the ball!"
        skills={['Vertical movement understanding']}
        suitableFor="Children learning up-down gestures and vertical movement"
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
            setShowBall(false);
            setHasSwiped(false);
            ballY.setValue(BALL_START_Y);
            ballScale.setValue(1);
            ballRotation.setValue(0);
          }}
        />
      </SafeAreaView>
    );
  }

  const rotateInterpolate = ballRotation.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

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
        <Text style={styles.title}>⚽ Ball Drop</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showBall && (
          <View style={styles.instructionContainer}>
            <Text style={styles.instructionText}>⬇️ Swipe DOWN to drop the ball!</Text>
          </View>
        )}
        
        <Animated.View
          style={[
            styles.ballContainer,
            {
              top: ballY,
              transform: [
                { scale: ballScale },
                { rotate: rotateInterpolate },
              ],
            },
          ]}
        >
          <LinearGradient
            colors={['#3B82F6', '#2563EB', '#1D4ED8']}
            style={styles.ball}
          >
            <Text style={styles.ballEmoji}>⚽</Text>
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
  ballContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ball: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.5,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  ballEmoji: {
    fontSize: 60,
  },
});

export default BallDropGame;

