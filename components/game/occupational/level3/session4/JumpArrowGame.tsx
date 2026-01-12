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
const SWIPE_THRESHOLD = 80;
const ARROW_CENTER_Y = SCREEN_HEIGHT * 0.5;
const JUMP_HEIGHT = 100;

const JumpArrowGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showArrow, setShowArrow] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);
  const [arrowDirection, setArrowDirection] = useState<'up' | 'down'>('up');

  const arrowY = useRef(new Animated.Value(ARROW_CENTER_Y)).current;
  const arrowScale = useRef(new Animated.Value(1)).current;
  const arrowOpacity = useRef(new Animated.Value(1)).current;
  const characterY = useRef(new Animated.Value(ARROW_CENTER_Y + 80)).current;
  const characterScale = useRef(new Animated.Value(1)).current;
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
      },
      onPanResponderRelease: (evt) => {
        const distance = swipeDistance.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        
        if (showArrow && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          if (arrowDirection === 'up' && deltaY < 0) {
            // Correct: arrow up, swipe up
            handleSuccess();
          } else if (arrowDirection === 'down' && deltaY > 0) {
            // Correct: arrow down, swipe down
            handleSuccess();
          } else {
            // Wrong direction
            handleMiss();
          }
        }
      },
    })
  ).current;

  const showArrowObject = useCallback(() => {
    const direction: 'up' | 'down' = Math.random() > 0.5 ? 'up' : 'down';
    setArrowDirection(direction);
    setShowArrow(true);
    setHasSwiped(false);
    
    arrowY.setValue(ARROW_CENTER_Y);
    arrowScale.setValue(0);
    arrowOpacity.setValue(0);
    characterY.setValue(ARROW_CENTER_Y + 80);
    characterScale.setValue(1);
    
    // Animate arrow appearance
    Animated.parallel([
      Animated.spring(arrowScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
      Animated.timing(arrowOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse animation for arrow
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowScale, {
          toValue: 1.2,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(arrowScale, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    pulseAnim.start();

    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak(direction === 'up' ? 'Arrow upar aaye! Swipe up!' : 'Arrow neeche aaye! Swipe down!', { rate: 0.8 });
      }, 300);
    } else {
      Speech.speak(direction === 'up' ? 'Arrow upar aaye! Swipe up!' : 'Arrow neeche aaye! Swipe down!', { rate: 0.8 });
    }
  }, [arrowScale, arrowY, arrowOpacity, characterY]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Speech.speak('Perfect! Great response!', { rate: 0.9 });
    
    // Animate character jump
    const jumpY = arrowDirection === 'up' 
      ? ARROW_CENTER_Y + 80 - JUMP_HEIGHT 
      : ARROW_CENTER_Y + 80 + JUMP_HEIGHT;
    
    Animated.parallel([
      Animated.sequence([
        Animated.timing(characterY, {
          toValue: jumpY,
          duration: 300,
          useNativeDriver: false,
        }),
        Animated.timing(characterY, {
          toValue: ARROW_CENTER_Y + 80,
          duration: 300,
          useNativeDriver: false,
        }),
      ]),
      Animated.sequence([
        Animated.timing(characterScale, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(characterScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(arrowOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowArrow(false);
        arrowY.setValue(ARROW_CENTER_Y);
        arrowScale.setValue(1);
        arrowOpacity.setValue(1);
        characterY.setValue(ARROW_CENTER_Y + 80);
        characterScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, arrowDirection, characterY, characterScale, arrowOpacity]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    Speech.speak(arrowDirection === 'up' ? 'Try swiping up!' : 'Try swiping down!', { rate: 0.8 });
    // Shake arrow
    Animated.sequence([
      Animated.timing(arrowY, {
        toValue: ARROW_CENTER_Y - 10,
        duration: 100,
        useNativeDriver: false,
      }),
      Animated.timing(arrowY, {
        toValue: ARROW_CENTER_Y + 10,
        duration: 100,
        useNativeDriver: false,
      }),
      Animated.timing(arrowY, {
        toValue: ARROW_CENTER_Y,
        duration: 100,
        useNativeDriver: false,
      }),
    ]).start();
  }, [arrowDirection, arrowY]);

  const startRound = useCallback(() => {
    if (done) return;
    setTimeout(() => {
      showArrowObject();
    }, 500);
  }, [done, showArrowObject]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowArrow(false);

    try {
      await logGameAndAward({
        type: 'jump-arrow',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['visual-response'],
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
        title="Jump Arrow"
        emoji="⬆️"
        description="Arrow upar aaye → swipe up"
        skills={['Visual response']}
        suitableFor="Children learning to respond to visual cues with gestures"
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
            setShowArrow(false);
            setHasSwiped(false);
            arrowY.setValue(ARROW_CENTER_Y);
            arrowScale.setValue(1);
            arrowOpacity.setValue(1);
            characterY.setValue(ARROW_CENTER_Y + 80);
            characterScale.setValue(1);
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
        <Text style={styles.title}>⬆️ Jump Arrow</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.scoreText}>Round: {round}/{TOTAL_ROUNDS}</Text>
          <Text style={styles.scoreText}>Score: {score}</Text>
        </View>
      </View>

      <View style={styles.gameArea} {...panResponder.panHandlers}>
        {showArrow && (
          <Animated.View
            style={[
              styles.arrowContainer,
              {
                top: arrowY,
                opacity: arrowOpacity,
                transform: [{ scale: arrowScale }],
              },
            ]}
          >
            <Text style={styles.arrowEmoji}>
              {arrowDirection === 'up' ? '⬆️' : '⬇️'}
            </Text>
            <Text style={styles.instructionText}>
              {arrowDirection === 'up' ? 'Swipe UP!' : 'Swipe DOWN!'}
            </Text>
          </Animated.View>
        )}
        
        <Animated.View
          style={[
            styles.characterContainer,
            {
              top: characterY,
              transform: [{ scale: characterScale }],
            },
          ]}
        >
          <Text style={styles.characterEmoji}>🧍</Text>
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
  arrowContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowEmoji: {
    fontSize: 120,
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#78350F',
    marginTop: 10,
    textAlign: 'center',
  },
  characterContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  characterEmoji: {
    fontSize: 80,
  },
});

export default JumpArrowGame;

