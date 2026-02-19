import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS, DEFAULT_TTS_RATE } from '@/utils/tts';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
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
const SWIPE_THRESHOLD = 100; // Minimum swipe distance

type ArrowDirection = 'left' | 'right' | 'up' | 'down';

// Use shared TTS utility (speech-to-speech on web, expo-speech on native)
// Safe speech helper
const speak = (text: string, rate = DEFAULT_TTS_RATE) => {
  try {
    stopAllSpeech();
    speakTTS(text, rate);
  } catch (e) {
    console.warn('Speech error:', e);
  }
};

const ArrowSwipeGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [arrowDirection, setArrowDirection] = useState<ArrowDirection>('left');
  const [expectedSwipe, setExpectedSwipe] = useState<ArrowDirection>('right');
  const [showArrow, setShowArrow] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);

  const arrowScale = useRef(new Animated.Value(1)).current;
  const arrowOpacity = useRef(new Animated.Value(0)).current;
  const swipeStartX = useRef(0);
  const swipeStartY = useRef(0);
  const swipeDistance = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: (evt) => {
        if (done || !showArrow || hasSwiped) return;
        swipeStartX.current = evt.nativeEvent.pageX;
        swipeStartY.current = evt.nativeEvent.pageY;
        swipeDistance.current = 0;
      },
      onPanResponderMove: (evt) => {
        if (done || !showArrow || hasSwiped) return;
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        swipeDistance.current = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      },
      onPanResponderRelease: (evt) => {
        if (done || !showArrow || hasSwiped) return;
        
        const distance = swipeDistance.current;
        const deltaX = evt.nativeEvent.pageX - swipeStartX.current;
        const deltaY = evt.nativeEvent.pageY - swipeStartY.current;
        
        if (distance >= SWIPE_THRESHOLD) {
          // Determine swipe direction
          const absX = Math.abs(deltaX);
          const absY = Math.abs(deltaY);
          let swipeDir: ArrowDirection;
          
          if (absX > absY) {
            swipeDir = deltaX < 0 ? 'left' : 'right';
          } else {
            swipeDir = deltaY < 0 ? 'up' : 'down';
          }
          
          if (swipeDir === expectedSwipe) {
            handleSuccess();
          } else {
            handleMiss();
          }
        } else {
          handleMiss();
        }
      },
    })
  ).current;

  const generateArrow = useCallback(() => {
    const directions: ArrowDirection[] = ['left', 'right', 'up', 'down'];
    const dir = directions[Math.floor(Math.random() * directions.length)];
    setArrowDirection(dir);
    
    // Cross-body mapping: left arrow → right swipe, right arrow → left swipe
    // Up arrow → down swipe, down arrow → up swipe (cross-body)
    if (dir === 'left') {
      setExpectedSwipe('right');
    } else if (dir === 'right') {
      setExpectedSwipe('left');
    } else if (dir === 'up') {
      setExpectedSwipe('down');
    } else {
      setExpectedSwipe('up');
    }
    
    setShowArrow(true);
    setHasSwiped(false);
    arrowOpacity.setValue(0);
    arrowScale.setValue(0.5);
    
    Animated.parallel([
      Animated.timing(arrowOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(arrowScale, {
        toValue: 1,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
    
    const instruction = `Arrow ${dir}, swipe ${expectedSwipe}!`;
    speak(instruction);
  }, [arrowOpacity, arrowScale, expectedSwipe]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speak('Perfect swipe!');
    
    Animated.sequence([
      Animated.timing(arrowScale, {
        toValue: 1.3,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(arrowOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShowArrow(false);
      
      setTimeout(() => {
        if (round < TOTAL_ROUNDS) {
          setRound((r) => r + 1);
          generateArrow();
        } else {
          endGame();
        }
      }, 500);
    });
  }, [round, arrowScale, arrowOpacity, generateArrow]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speak(`Swipe ${expectedSwipe}!`);
    
    Animated.sequence([
      Animated.timing(arrowScale, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(arrowScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [arrowScale, expectedSwipe]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowArrow(false);

    try {
      await logGameAndAward({
        type: 'arrow-swipe',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['cross-body-coordination', 'direction-control', 'visual-motor'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      setTimeout(() => {
        generateArrow();
      }, 500);
    }
  }, [showInfo, round, done, generateArrow]);

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

  const getArrowEmoji = (dir: ArrowDirection) => {
    switch (dir) {
      case 'left': return '⬅️';
      case 'right': return '➡️';
      case 'up': return '⬆️';
      case 'down': return '⬇️';
    }
  };

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Arrow Swipe"
        emoji="➡️"
        description="Cross-body swipe! Left arrow → right swipe!"
        skills={['Direction control', 'Cross-body coordination']}
        suitableFor="Children learning cross-body movements and direction control"
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
            arrowOpacity.setValue(0);
            arrowScale.setValue(1);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} {...panResponder.panHandlers}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      >
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.title}>Arrow Swipe</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {showArrow && `Arrow ${arrowDirection} → Swipe ${expectedSwipe}!`}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showArrow && (
          <Animated.View
            style={[
              styles.arrowContainer,
              {
                opacity: arrowOpacity,
                transform: [{ scale: arrowScale }],
              },
            ]}
          >
            <Text style={styles.arrowEmoji}>{getArrowEmoji(arrowDirection)}</Text>
            <Text style={styles.arrowLabel}>{arrowDirection.toUpperCase()}</Text>
          </Animated.View>
        )}

        <View style={styles.instructionBox}>
          <Text style={styles.instructionText}>
            {showArrow ? `Swipe ${expectedSwipe} direction!` : 'Wait for arrow...'}
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Direction control • Cross-body coordination
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
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
    fontSize: 18,
    color: '#3B82F6',
    fontWeight: '700',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  arrowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 60,
  },
  arrowEmoji: {
    fontSize: 120,
    marginBottom: 10,
  },
  arrowLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
  },
  instructionBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 40,
  },
  instructionText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#3B82F6',
    textAlign: 'center',
  },
  footer: {
    padding: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
});

export default ArrowSwipeGame;
