import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
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
const SWIPE_THRESHOLD = 80; // Minimum swipe distance for left/right gesture

type ArrowDirection = 'left' | 'right';

const ArrowMatchGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [showArrow, setShowArrow] = useState(false);
  const [hasSwiped, setHasSwiped] = useState(false);
  const [arrowDirection, setArrowDirection] = useState<ArrowDirection>('left');

  const arrowScale = useRef(new Animated.Value(1)).current;
  const arrowOpacity = useRef(new Animated.Value(0)).current;
  const swipeStartX = useRef(0);
  const swipeDistance = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
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
        
        if (showArrow && !hasSwiped && distance >= SWIPE_THRESHOLD) {
          const swipeDir: ArrowDirection = deltaX < 0 ? 'left' : 'right';
          
          if (swipeDir === arrowDirection) {
            // Correct match!
            handleSuccess();
          } else {
            // Wrong direction
            handleMiss();
          }
        } else if (showArrow && !hasSwiped && distance < SWIPE_THRESHOLD) {
          // Not enough swipe
          handleMiss();
        }
      },
    })
  ).current;

  const showArrowObject = useCallback(() => {
    // Random arrow direction
    const dir: ArrowDirection = Math.random() > 0.5 ? 'left' : 'right';
    setArrowDirection(dir);
    
    setShowArrow(true);
    setHasSwiped(false);
    arrowOpacity.setValue(0);
    arrowScale.setValue(0.5);
    
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

    const instruction = dir === 'left' 
      ? 'Arrow left hai, left swipe karo!' 
      : 'Arrow right hai, right swipe karo!';
    
    if (Platform.OS === 'web') {
      setTimeout(() => {
        Speech.speak(instruction, { rate: 0.8 });
      }, 300);
    } else {
      Speech.speak(instruction, { rate: 0.8 });
    }
  }, [arrowScale, arrowOpacity]);

  const handleSuccess = useCallback(() => {
    setHasSwiped(true);
    setScore((s) => s + 1);
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Speech.speak('Perfect match!', { rate: 0.9 });
    
    Animated.sequence([
      Animated.parallel([
        Animated.timing(arrowScale, {
          toValue: 1.3,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(arrowOpacity, {
          toValue: 0.8,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(arrowScale, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(arrowOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        setShowArrow(false);
        arrowOpacity.setValue(0);
        arrowScale.setValue(1);
      } else {
        endGame();
      }
    }, 1000);
  }, [round, arrowScale, arrowOpacity]);

  const handleMiss = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    const correctDirection = arrowDirection === 'left' ? 'left' : 'right';
    Speech.speak(`Arrow ${correctDirection} hai, ${correctDirection} swipe karo!`, { rate: 0.8 });
    
    // Shake animation
    Animated.sequence([
      Animated.timing(arrowScale, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(arrowScale, {
        toValue: 1.1,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(arrowScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [arrowScale, arrowDirection]);

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
        type: 'arrow-match',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['visual-motor-link', 'direction-matching'],
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
        title="Arrow Match"
        emoji="⬅️"
        description="Match the arrow direction with your swipe!"
        skills={['Visual-motor link', 'Direction matching']}
        suitableFor="Children learning left-right gestures and visual-motor coordination"
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
        <Text style={styles.title}>Arrow Match</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⬅️ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          Arrow ki direction ke hisab se swipe karo!
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showArrow && (
          <Animated.View
            style={[
              styles.arrowContainer,
              {
                transform: [{ scale: arrowScale }],
                opacity: arrowOpacity,
              },
            ]}
          >
            <Text style={styles.arrowEmoji}>
              {arrowDirection === 'left' ? '⬅️' : '➡️'}
            </Text>
            <Text style={styles.arrowLabel}>
              {arrowDirection === 'left' ? 'LEFT SWIPE' : 'RIGHT SWIPE'}
            </Text>
          </Animated.View>
        )}

        {!showArrow && (
          <View style={styles.waitingContainer}>
            <Text style={styles.waitingText}>Get ready...</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Visual-motor link • Direction matching
        </Text>
        <Text style={styles.footerSubtext}>
          Match the arrow direction with your swipe!
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
    fontSize: 16,
    color: '#3B82F6',
    fontWeight: '600',
    textAlign: 'center',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginVertical: 40,
  },
  arrowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowEmoji: {
    fontSize: 120,
    marginBottom: 20,
  },
  arrowLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    overflow: 'hidden',
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

export default ArrowMatchGame;


