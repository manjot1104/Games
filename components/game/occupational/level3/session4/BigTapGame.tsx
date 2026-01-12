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

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BIG_CIRCLE_SIZE = Math.min(SCREEN_WIDTH * 0.8, SCREEN_HEIGHT * 0.6); // Large circle

const BigTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showTarget, setShowTarget] = useState(false);
  const [hasTapped, setHasTapped] = useState(false);

  const circleScale = useRef(new Animated.Value(0)).current;
  const circleOpacity = useRef(new Animated.Value(0)).current;
  const swipeDistance = useRef(0);
  const swipeStartY = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        swipeStartY.current = evt.nativeEvent.pageY;
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt) => {
        swipeDistance.current = Math.abs(evt.nativeEvent.pageY - swipeStartY.current);
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        // Require significant swipe (at least 30% of screen height) for big tap
        const minSwipeDistance = SCREEN_HEIGHT * 0.3;
        
        if (showTarget && !hasTapped && distance >= minSwipeDistance) {
          handleSuccess();
        }
      },
    })
  ).current;

  const showCircle = useCallback(() => {
    setShowTarget(true);
    setHasTapped(false);
    
    Animated.parallel([
      Animated.spring(circleScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(circleOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak('BIG! Tap or swipe anywhere on screen!', { rate: 0.8 });
      }, 300);
    } else {
      Speech.speak('BIG! Tap or swipe anywhere on screen!', { rate: 0.8 });
    }
  }, [circleScale, circleOpacity]);

  const handleTap = useCallback(() => {
    if (showTarget && !hasTapped && !done) {
      handleSuccess();
    }
  }, [showTarget, hasTapped, done]);

  const handleSuccess = useCallback(() => {
    setHasTapped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    Animated.parallel([
      Animated.timing(circleScale, {
        toValue: 1.2,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(circleOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowTarget(false);
        circleScale.setValue(0);
        circleOpacity.setValue(0);
      } else {
        endGame();
      }
    }, 500);
  }, [round, circleScale, circleOpacity]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showCircle();
    }, 500);
  }, [done, showCircle]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowTarget(false);

    try {
      await logGameAndAward({
        type: 'big-tap',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['large-muscle-movement', 'spatial-awareness'],
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
        title="Big Tap"
        emoji="👆"
        description="Screen shows BIG circle → child needs to tap or swipe anywhere on full screen"
        skills={['Large muscle movement', 'Spatial awareness']}
        suitableFor="Children who want to develop large muscle movements and spatial awareness"
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
            setHasTapped(false);
            circleScale.setValue(0);
            circleOpacity.setValue(0);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#E0F2FE', '#DBEAFE', '#BFDBFE']}
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
        <Text style={styles.title}>👆 Big Tap</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View 
        style={styles.gameArea}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          onPress={handleTap}
          activeOpacity={1}
        >
          {showTarget && (
            <Animated.View
              style={[
                styles.bigCircle,
                {
                  transform: [{ scale: circleScale }],
                  opacity: circleOpacity,
                },
              ]}
            >
              <LinearGradient
                colors={['#3B82F6', '#2563EB']}
                style={styles.circleGradient}
              >
                <Text style={styles.bigText}>BIG</Text>
                <Text style={styles.instructionText}>Tap or Swipe!</Text>
              </LinearGradient>
            </Animated.View>
          )}
          
          {!showTarget && (
            <View style={styles.waitingContainer}>
              <Text style={styles.waitingText}>Get ready... 👀</Text>
            </View>
          )}
        </TouchableOpacity>
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
    color: '#1E293B',
    marginBottom: 16,
  },
  scoreContainer: {
    flexDirection: 'row',
    gap: 20,
  },
  scoreText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#475569',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  bigCircle: {
    width: BIG_CIRCLE_SIZE,
    height: BIG_CIRCLE_SIZE,
    borderRadius: BIG_CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 10 },
    elevation: 15,
  },
  circleGradient: {
    width: '100%',
    height: '100%',
    borderRadius: BIG_CIRCLE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 6,
    borderColor: '#FFFFFF',
  },
  bigText: {
    fontSize: 64,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 10,
  },
  instructionText: {
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
    color: '#64748B',
  },
});

export default BigTapGame;




