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
const BIG_OBJECT_SIZE = 180;
const SMALL_OBJECT_SIZE = 60;
const BIG_SWIPE_THRESHOLD = SCREEN_HEIGHT * 0.4; // 40% of screen for big swipe
const SMALL_SWIPE_THRESHOLD = SCREEN_HEIGHT * 0.15; // 15% of screen for small swipe

type ObjectSize = 'big' | 'small';

const CompareAndMoveGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentObjectSize, setCurrentObjectSize] = useState<ObjectSize>('big');
  const [showTarget, setShowTarget] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);

  const objectScale = useRef(new Animated.Value(0)).current;
  const objectOpacity = useRef(new Animated.Value(0)).current;
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
        swipeDistance.current = Math.abs(evt.nativeEvent.pageY - swipeStartY.current);
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        
        if (showTarget && !hasSwiped) {
          const requiredDistance = currentObjectSize === 'big' 
            ? BIG_SWIPE_THRESHOLD 
            : SMALL_SWIPE_THRESHOLD;
          
          if (distance >= requiredDistance) {
            handleSuccess();
          } else {
            handleMiss();
          }
        }
      },
    })
  ).current;

  const showObject = useCallback(() => {
    const size: ObjectSize = Math.random() > 0.5 ? 'big' : 'small';
    setCurrentObjectSize(size);
    setShowTarget(true);
    setHasSwiped(false);
    
    Animated.parallel([
      Animated.spring(objectScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(objectOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak(
          size === 'big' 
            ? 'BIG object! Make a BIG swipe!' 
            : 'SMALL object! Make a SMALL swipe!', 
          { rate: 0.8 }
        );
      }, 300);
    } else {
      Speech.speak(
        size === 'big' 
          ? 'BIG object! Make a BIG swipe!' 
          : 'SMALL object! Make a SMALL swipe!', 
        { rate: 0.8 }
      );
    }
  }, [objectScale, objectOpacity]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    
    Animated.parallel([
      Animated.timing(objectScale, {
        toValue: 1.2,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(objectOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowTarget(false);
        objectScale.setValue(0);
        objectOpacity.setValue(0);
      } else {
        endGame();
      }
    }, 500);
  }, [round, objectScale, objectOpacity]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    // Show feedback and try again
    setTimeout(() => {
      setHasSwiped(false);
      swipeDistance.current = 0;
    }, 500);
  }, []);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showObject();
    }, 500);
  }, [done, showObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowTarget(false);

    try {
      await logGameAndAward({
        type: 'compare-and-move',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['decision-making', 'body-scaling'],
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
        title="Compare & Move"
        emoji="🔄"
        description="Big object requires big swipe, small object requires small swipe"
        skills={['Decision making', 'Body scaling']}
        suitableFor="Children who want to develop decision making and body scaling skills"
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
            objectScale.setValue(0);
            objectOpacity.setValue(0);
          }}
        />
      </SafeAreaView>
    );
  }

  const objectSize = currentObjectSize === 'big' ? BIG_OBJECT_SIZE : SMALL_OBJECT_SIZE;
  const colors = currentObjectSize === 'big' 
    ? ['#3B82F6', '#2563EB'] 
    : ['#F59E0B', '#D97706'];
  const requiredSwipe = currentObjectSize === 'big' ? 'BIG' : 'SMALL';

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#ECFDF5', '#D1FAE5', '#A7F3D0']}
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
        <Text style={styles.title}>🔄 Compare & Move</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showTarget && (
          <View style={styles.instructionContainer}>
            <Text style={styles.instructionText}>
              {currentObjectSize === 'big' ? 'BIG object → BIG swipe!' : 'SMALL object → SMALL swipe!'}
            </Text>
          </View>
        )}
        
        {showTarget && (
          <Animated.View
            style={[
              styles.object,
              {
                width: objectSize,
                height: objectSize,
                borderRadius: objectSize / 2,
                transform: [{ scale: objectScale }],
                opacity: objectOpacity,
              },
            ]}
          >
            <LinearGradient
              colors={colors}
              style={styles.objectGradient}
            >
              <Text style={[styles.sizeText, { fontSize: currentObjectSize === 'big' ? 48 : 24 }]}>
                {currentObjectSize === 'big' ? 'BIG' : 'SMALL'}
              </Text>
            </LinearGradient>
          </Animated.View>
        )}
        
        {!showTarget && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready... 👀</Text>
          </View>
        )}
        
        {showTarget && !hasSwiped && (
          <View style={styles.hintContainer}>
            <Text style={styles.hintText}>
              Swipe {requiredSwipe.toLowerCase()} to match!
            </Text>
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
  instructionContainer: {
    position: 'absolute',
    top: 40,
    alignItems: 'center',
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#065F46',
    textAlign: 'center',
  },
  object: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  objectGradient: {
    width: '100%',
    height: '100%',
    borderRadius: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  sizeText: {
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 2,
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
  hintContainer: {
    position: 'absolute',
    bottom: 60,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#059669',
    textAlign: 'center',
  },
});

export default CompareAndMoveGame;




