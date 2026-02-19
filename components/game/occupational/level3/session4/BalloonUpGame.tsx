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
const SWIPE_THRESHOLD = 80; // Minimum swipe distance for up gesture
const BALLOON_START_Y = SCREEN_HEIGHT * 0.8;
const BALLOON_END_Y = SCREEN_HEIGHT * 0.2;

const BalloonUpGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showBalloon, setShowBalloon] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);

  const balloonY = useRef(new Animated.Value(BALLOON_START_Y)).current;
  const balloonScale = useRef(new Animated.Value(1)).current;
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
        
        // Move balloon up as user swipes up
        if (deltaY < 0) {
          const newY = Math.max(BALLOON_END_Y, BALLOON_START_Y + deltaY);
          balloonY.setValue(newY);
        }
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        
        if (showBalloon && !hasSwiped && distance >= SWIPE_THRESHOLD && deltaY < 0) {
          // Swipe up detected
          handleSuccess();
        } else if (showBalloon && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          // Wrong direction
          handleMiss();
        }
      },
    })
  ).current;

  const showBalloonObject = useCallback(() => {
    setShowBalloon(true);
    setHasSwiped(false);
    balloonY.setValue(BALLOON_START_Y);
    balloonScale.setValue(1);
    
    Animated.spring(balloonScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS('Swipe up to lift the balloon!', 0.8 );
      }, 300);
    } else {
      speakTTS('Swipe up to lift the balloon!', 0.8 );
    }
  }, [balloonScale, balloonY]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Great! Balloon lifted!', 0.9 );
    
    Animated.parallel([
      Animated.timing(balloonY, {
        toValue: BALLOON_END_Y,
        duration: 500,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.timing(balloonScale, {
          toValue: 1.2,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(balloonScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowBalloon(false);
        balloonY.setValue(BALLOON_START_Y);
        balloonScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, balloonY, balloonScale]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speakTTS('Try swiping up!', 0.8 );
    // Reset balloon position
    Animated.timing(balloonY, {
      toValue: BALLOON_START_Y,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [balloonY]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showBalloonObject();
    }, 500);
  }, [done, showBalloonObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowBalloon(false);

    try {
      await logGameAndAward({
        type: 'balloon-up',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['direction-awareness', 'shoulder-movement'],
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
        title="Balloon Up"
        emoji="🎈"
        description="Swipe up to lift the balloon!"
        skills={['Direction awareness', 'Shoulder movement']}
        suitableFor="Children learning up-down gestures and shoulder movement"
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
            setShowBalloon(false);
            setHasSwiped(false);
            balloonY.setValue(BALLOON_START_Y);
            balloonScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#E0F2FE', '#BAE6FD', '#7DD3FC']}
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
        <Text style={styles.title}>🎈 Balloon Up</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showBalloon && (
          <View style={styles.instructionContainer}>
            <Text style={styles.instructionText}>⬆️ Swipe UP to lift the balloon!</Text>
          </View>
        )}
        
        <Animated.View
          style={[
            styles.balloonContainer,
            {
              top: balloonY,
              transform: [{ scale: balloonScale }],
            },
          ]}
        >
          <LinearGradient
            colors={['#F97316', '#EA580C', '#DC2626']}
            style={styles.balloon}
          >
            <Text style={styles.balloonEmoji}>🎈</Text>
          </LinearGradient>
          <View style={styles.balloonString} />
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
    color: '#0C4A6E',
    marginBottom: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#075985',
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
    color: '#0C4A6E',
    textAlign: 'center',
  },
  balloonContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  balloon: {
    width: 100,
    height: 120,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#F97316',
    shadowOpacity: 0.5,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  balloonEmoji: {
    fontSize: 60,
  },
  balloonString: {
    width: 2,
    height: 80,
    backgroundColor: '#78350F',
    marginTop: 5,
  },
});

export default BalloonUpGame;

