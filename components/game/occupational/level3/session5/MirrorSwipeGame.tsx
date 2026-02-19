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
const OBJECT_START_X = SCREEN_WIDTH * 0.5;
const OBJECT_LEFT_X = SCREEN_WIDTH * 0.2;
const OBJECT_RIGHT_X = SCREEN_WIDTH * 0.8;

type SwipeDirection = 'left' | 'right';

const MirrorSwipeGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showObject, setShowObject] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<SwipeDirection>('left');

  const objectX = useRef(new Animated.Value(OBJECT_START_X)).current;
  const objectScale = useRef(new Animated.Value(1)).current;
  const objectRotation = useRef(new Animated.Value(0)).current;
  const swipeStartX = useRef(0);
  const swipeDistance = useRef(0);

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
        
        if (showObject && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          const swipeDir: SwipeDirection = deltaX < 0 ? 'left' : 'right';
          setSwipeDirection(swipeDir);
          
          // Mirror effect: left swipe shows right animation, right swipe shows left animation
          const mirrorDir: SwipeDirection = swipeDir === 'left' ? 'right' : 'left';
          handleSuccess(mirrorDir);
        } else if (showObject && !hasSwiped && distance < SWIPE_THRESHOLD) {
          // Not enough swipe
          handleMiss();
        }
      },
    })
  ).current;

  const showObjectOnScreen = useCallback(() => {
    setShowObject(true);
    setHasSwiped(false);
    objectX.setValue(OBJECT_START_X);
    objectRotation.setValue(0);
    objectScale.setValue(1);
    
    Animated.spring(objectScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        speakTTS('Mirror mode! Left swipe shows right, right swipe shows left!', { rate: 0.8, language: 'en-US' });
      }, 300);
    } else {
      speakTTS('Mirror mode! Left swipe shows right, right swipe shows left!', { rate: 0.8, language: 'en-US' });
    }
  }, [objectScale, objectX, objectRotation]);

  const handleSuccess = useCallback((mirrorDirection: SwipeDirection) => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect mirror!', 0.9, 'en-US' );
    
    const targetX = mirrorDirection === 'left' ? OBJECT_LEFT_X : OBJECT_RIGHT_X;
    const rotation = mirrorDirection === 'left' ? -30 : 30;
    
    Animated.parallel([
      Animated.timing(objectX, {
        toValue: targetX,
        duration: 500,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.timing(objectRotation, {
          toValue: rotation,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(objectRotation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.timing(objectScale, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(objectScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowObject(false);
        objectX.setValue(OBJECT_START_X);
        objectRotation.setValue(0);
        objectScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, objectX, objectRotation, objectScale]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speakTTS('Try again! In mirror mode, it moves in the opposite direction!', { rate: 0.8, language: 'en-US' });
    
    // Shake animation
    Animated.sequence([
      Animated.timing(objectX, {
        toValue: OBJECT_START_X - 10,
        duration: 100,
        useNativeDriver: false,
      }),
      Animated.timing(objectX, {
        toValue: OBJECT_START_X + 10,
        duration: 100,
        useNativeDriver: false,
      }),
      Animated.timing(objectX, {
        toValue: OBJECT_START_X,
        duration: 100,
        useNativeDriver: false,
      }),
    ]).start();
  }, [objectX]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showObjectOnScreen();
    }, 500);
  }, [done, showObjectOnScreen]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowObject(false);

    try {
      await logGameAndAward({
        type: 'mirror-swipe',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['brain-flexibility', 'cognitive-flexibility'],
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
        title="Mirror Swipe"
        emoji="🪞"
        description="Left swipe shows right animation, right swipe shows left!"
        skills={['Brain flexibility', 'Cognitive flexibility']}
        suitableFor="Children learning left-right gestures and cognitive flexibility"
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
            setShowObject(false);
            setHasSwiped(false);
            objectX.setValue(OBJECT_START_X);
            objectRotation.setValue(0);
            objectScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  // Determine which direction the object should move based on swipe
  const objectDirection = hasSwiped && showObject 
    ? (swipeDirection === 'left' ? 'right' : 'left') 
    : null;

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
        <Text style={styles.title} selectable={false}>Mirror Swipe</Text>
        <Text style={styles.subtitle} selectable={false}>
          Round {round}/{TOTAL_ROUNDS} • 🪞 Score: {score}
        </Text>
        <Text style={styles.instruction} selectable={false}>
          Mirror mode! Left swipe → right animation, Right swipe → left animation
        </Text>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showObject && (
          <Animated.View
            style={[
              styles.objectContainer,
              {
                left: objectX,
                transform: [
                  { rotate: objectRotation.interpolate({
                    inputRange: [-30, 30],
                    outputRange: ['-30deg', '30deg'],
                  }) },
                  { scale: objectScale },
                ],
              },
            ]}
          >
            <Text style={styles.objectEmoji} selectable={false}>✨</Text>
            {objectDirection && (
              <View style={styles.directionIndicator}>
                <Text style={styles.directionArrow} selectable={false}>
                  {objectDirection === 'left' ? '← LEFT' : 'RIGHT →'}
                </Text>
              </View>
            )}
          </Animated.View>
        )}

        {!showObject && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText} selectable={false}>Get ready for mirror mode...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText} selectable={false}>
          Skills: Brain flexibility • Cognitive flexibility
        </Text>
        <Text style={styles.footerSubtext} selectable={false}>
          Swipe in any direction - the object will move in the opposite direction!
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
    marginVertical: 40,
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
    color: '#8B5CF6',
    fontWeight: '600',
    textAlign: 'center',
  },
  objectContainer: {
    position: 'absolute',
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -70,
    marginTop: -70,
  },
  objectEmoji: {
    fontSize: 120,
  },
  directionIndicator: {
    position: 'absolute',
    bottom: -40,
    backgroundColor: 'rgba(139, 92, 246, 0.9)',
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

export default MirrorSwipeGame;


