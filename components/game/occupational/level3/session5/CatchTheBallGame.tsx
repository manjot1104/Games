import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
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
const SWIPE_THRESHOLD = 80; // Minimum swipe distance for left/right gesture
const BALL_START_X_LEFT = SCREEN_WIDTH * 0.1;
const BALL_START_X_RIGHT = SCREEN_WIDTH * 0.9;
const BALL_CENTER_X = SCREEN_WIDTH * 0.5;
const BALL_Y = SCREEN_HEIGHT * 0.3;
const CATCH_Y = SCREEN_HEIGHT * 0.6;

type BallDirection = 'left' | 'right';

const CatchTheBallGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showBall, setShowBall] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);
  const [ballComingFrom, setBallComingFrom] = useState<BallDirection>('left');
  const [ballAnimation, setBallAnimation] = useState<any>(null);

  const ballX = useRef(new Animated.Value(BALL_CENTER_X)).current;
  const ballY = useRef(new Animated.Value(BALL_Y)).current;
  const ballScale = useRef(new Animated.Value(1)).current;
  const ballOpacity = useRef(new Animated.Value(0)).current;
  const swipeStartX = useRef(0);
  const swipeDistance = useRef(0);
  const ballAnimationRef = useRef<any>(null);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        swipeStartX.current = evt.nativeEvent.pageX;
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt) => {
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        swipeDistance.current = Math.abs(deltaX);
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        
        if (showBall && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          const swipeDir: BallDirection = deltaX < 0 ? 'left' : 'right';
          
          // Stop ball animation
          if (ballAnimationRef.current) {
            ballAnimationRef.current.stop();
          }
          
          if (swipeDir === ballComingFrom) {
            // Correct direction - caught!
            handleSuccess();
          } else {
            // Wrong direction - missed
            handleMiss();
          }
        }
      },
    })
  ).current;

  const showBallObject = useCallback(() => {
    // Random direction for ball to come from
    const direction: BallDirection = Math.random() > 0.5 ? 'left' : 'right';
    setBallComingFrom(direction);
    
    setShowBall(true);
    setHasSwiped(false);
    ballOpacity.setValue(0);
    ballScale.setValue(0.5);
    
    const startX = direction === 'left' ? BALL_START_X_LEFT : BALL_START_X_RIGHT;
    ballX.setValue(startX);
    ballY.setValue(BALL_Y);
    
    // Fade in and scale up
    Animated.parallel([
      Animated.spring(ballScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(ballOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // Animate ball coming towards center
    const animation = Animated.timing(ballY, {
      toValue: CATCH_Y,
      duration: 2000,
      useNativeDriver: false,
    });
    
    ballAnimationRef.current = animation;
    setBallAnimation(animation);
    
    animation.start((finished) => {
      if (finished && showBall && !hasSwiped) {
        // Ball reached catch zone but wasn't caught
        handleMiss();
      }
    });

    const instruction = direction === 'left' 
      ? 'Ball coming from left! Swipe left!' 
      : 'Ball coming from right! Swipe right!';
    
    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS(instruction, 0.8, 'en-US' );
      }, 300);
    } else {
      speakTTS(instruction, 0.8, 'en-US' );
    }
  }, [ballScale, ballX, ballY, ballOpacity, showBall, hasSwiped]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Ball caught!', 0.9, 'en-US' );
    
    Animated.parallel([
      Animated.timing(ballY, {
        toValue: CATCH_Y + 100,
        duration: 400,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.timing(ballScale, {
          toValue: 1.5,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(ballScale, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(ballOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowBall(false);
        ballX.setValue(BALL_CENTER_X);
        ballY.setValue(BALL_Y);
        ballOpacity.setValue(0);
        ballScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, ballX, ballY, ballScale, ballOpacity]);

  const handleMiss = useCallback(() => {
    if (ballAnimationRef.current) {
      ballAnimationRef.current.stop();
    }
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    const correctDirection = ballComingFrom === 'left' ? 'left' : 'right';
    speakTTS(`Ball was coming from ${correctDirection}, you should swipe ${correctDirection}!`, { rate: 0.8, language: 'en-US' });
    
    // Ball continues falling
    Animated.parallel([
      Animated.timing(ballY, {
        toValue: SCREEN_HEIGHT + 100,
        duration: 500,
        useNativeDriver: false,
      }),
      Animated.timing(ballOpacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (round < TOTAL_ROUNDS) {
        setTimeout(() => {
          setRound((r) => r + 1);
          setShowBall(false);
          ballX.setValue(BALL_CENTER_X);
          ballY.setValue(BALL_Y);
          ballOpacity.setValue(0);
          ballScale.setValue(1);
        }, 500);
      } else {
        endGame();
      }
    });
  }, [ballY, ballOpacity, ballComingFrom, round, ballX, ballScale]);

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

    if (ballAnimationRef.current) {
      ballAnimationRef.current.stop();
    }

    try {
      await logGameAndAward({
        type: 'catch-the-ball',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['reaction-time', 'direction-discrimination'],
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
      if (ballAnimationRef.current) {
        ballAnimationRef.current.stop();
      }
    };
  }, []);

  // Show info screen
  if (showInfo) {
    return (
      <GameInfoScreen
        title="Catch the Ball"
        emoji="⚽"
        description="Ball comes from left or right → swipe in the same direction!"
        skills={['Reaction time', 'Direction discrimination']}
        suitableFor="Children learning left-right gestures and reaction timing"
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
            ballX.setValue(BALL_CENTER_X);
            ballY.setValue(BALL_Y);
            ballOpacity.setValue(0);
            ballScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText} selectable={false}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title} selectable={false}>Catch the Ball</Text>
        <Text style={styles.subtitle} selectable={false}>
          Round {round}/{TOTAL_ROUNDS} • ⚽ Score: {score}
        </Text>
        <Text style={styles.instruction} selectable={false}>
          {ballComingFrom === 'left' ? 'Ball coming from left! Swipe left!' : 'Ball coming from right! Swipe right!'}
        </Text>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {/* Catch zone indicator */}
        <View style={styles.catchZone}>
          <Text style={styles.catchZoneText} selectable={false}>CATCH HERE ↓</Text>
        </View>

        {showBall && (
          <Animated.View
            style={[
              styles.ballContainer,
              {
                left: ballX,
                top: ballY,
                transform: [{ scale: ballScale }],
                opacity: ballOpacity,
              },
            ]}
          >
            <Text style={styles.ballEmoji} selectable={false}>⚽</Text>
            <View style={styles.directionIndicator}>
              <Text style={styles.directionArrow} selectable={false}>
                {ballComingFrom === 'left' ? '← FROM LEFT' : 'FROM RIGHT →'}
              </Text>
            </View>
          </Animated.View>
        )}

        {!showBall && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText} selectable={false}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText} selectable={false}>
          Skills: Reaction time • Direction discrimination
        </Text>
        <Text style={styles.footerSubtext} selectable={false}>
          Watch the ball direction and swipe to catch it!
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
    ...(Platform.OS === 'web' && {
      userSelect: 'none',
      WebkitUserSelect: 'none',
      MozUserSelect: 'none',
      msUserSelect: 'none',
    } as any),
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 20,
    ...(Platform.OS === 'web' && {
      userSelect: 'none',
      WebkitUserSelect: 'none',
      touchAction: 'pan-y pan-x',
    } as any),
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
    color: '#EF4444',
    fontWeight: '600',
    textAlign: 'center',
  },
  catchZone: {
    position: 'absolute',
    top: CATCH_Y,
    left: SCREEN_WIDTH * 0.25,
    right: SCREEN_WIDTH * 0.25,
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    paddingVertical: 20,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#22C55E',
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  catchZoneText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#22C55E',
  },
  ballContainer: {
    position: 'absolute',
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -50,
    marginTop: -50,
  },
  ballEmoji: {
    fontSize: 80,
  },
  directionIndicator: {
    position: 'absolute',
    top: -30,
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  directionArrow: {
    fontSize: 14,
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

export default CatchTheBallGame;

