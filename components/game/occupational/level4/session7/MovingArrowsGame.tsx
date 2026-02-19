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
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ARROW_SIZE = 100;
const ARROW_SPEED = 3000; // milliseconds to cross screen

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

const MovingArrowsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [arrowDirection, setArrowDirection] = useState<ArrowDirection>('left');
  const [expectedHand, setExpectedHand] = useState<'left' | 'right'>('right');
  const [showArrow, setShowArrow] = useState(false);
  const [hasTapped, setHasTapped] = useState(false);

  const arrowX = useRef(new Animated.Value(0)).current;
  const arrowY = useRef(new Animated.Value(0)).current;
  const arrowOpacity = useRef(new Animated.Value(0)).current;
  const arrowScale = useRef(new Animated.Value(1)).current;
  const leftHandScale = useRef(new Animated.Value(1)).current;
  const rightHandScale = useRef(new Animated.Value(1)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);

  const generateArrow = useCallback(() => {
    const directions: ArrowDirection[] = ['left', 'right', 'up', 'down'];
    const dir = directions[Math.floor(Math.random() * directions.length)];
    setArrowDirection(dir);
    
    // Cross-body mapping: left arrow → right hand, right arrow → left hand
    if (dir === 'left') {
      setExpectedHand('right');
    } else if (dir === 'right') {
      setExpectedHand('left');
    } else {
      // For up/down, randomly assign cross-body
      setExpectedHand(Math.random() < 0.5 ? 'left' : 'right');
    }
    
    setShowArrow(true);
    setHasTapped(false);
    arrowOpacity.setValue(0);
    arrowScale.setValue(1);
    
    // Start position based on direction
    let startX = 0;
    let startY = 0;
    let endX = 0;
    let endY = 0;
    
    if (dir === 'left') {
      startX = SCREEN_WIDTH + ARROW_SIZE;
      endX = -ARROW_SIZE;
      startY = SCREEN_HEIGHT * 0.4;
      endY = startY;
    } else if (dir === 'right') {
      startX = -ARROW_SIZE;
      endX = SCREEN_WIDTH + ARROW_SIZE;
      startY = SCREEN_HEIGHT * 0.4;
      endY = startY;
    } else if (dir === 'up') {
      startX = SCREEN_WIDTH * 0.5;
      endX = startX;
      startY = SCREEN_HEIGHT + ARROW_SIZE;
      endY = -ARROW_SIZE;
    } else {
      startX = SCREEN_WIDTH * 0.5;
      endX = startX;
      startY = -ARROW_SIZE;
      endY = SCREEN_HEIGHT + ARROW_SIZE;
    }
    
    arrowX.setValue(startX);
    arrowY.setValue(startY);
    
    // Fade in
    Animated.timing(arrowOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
    
    // Move arrow
    const moveAnimation = Animated.parallel([
      Animated.timing(arrowX, {
        toValue: endX,
        duration: ARROW_SPEED,
        useNativeDriver: true,
      }),
      Animated.timing(arrowY, {
        toValue: endY,
        duration: ARROW_SPEED,
        useNativeDriver: true,
      }),
    ]);
    
    animationRef.current = moveAnimation;
    moveAnimation.start((finished) => {
      if (finished && !hasTapped) {
        // Arrow passed without being tapped
        handleMiss();
      }
    });
    
    const instruction = `Arrow ${dir} moving! Use ${expectedHand} hand!`;
    speak(instruction);
  }, [arrowX, arrowY, arrowOpacity, arrowScale, expectedHand, hasTapped]);

  const handleLeftHandTap = useCallback(() => {
    if (done || !showArrow || hasTapped) return;
    
    if (expectedHand === 'left') {
      // Stop animation
      if (animationRef.current) {
        animationRef.current.stop();
      }
      handleSuccess('left');
    } else {
      handleMiss();
    }
  }, [done, showArrow, hasTapped, expectedHand]);

  const handleRightHandTap = useCallback(() => {
    if (done || !showArrow || hasTapped) return;
    
    if (expectedHand === 'right') {
      // Stop animation
      if (animationRef.current) {
        animationRef.current.stop();
      }
      handleSuccess('right');
    } else {
      handleMiss();
    }
  }, [done, showArrow, hasTapped, expectedHand]);

  const handleSuccess = useCallback((hand: 'left' | 'right') => {
    setHasTapped(true);
    setScore((s) => s + 1);
    
    const handScale = hand === 'left' ? leftHandScale : rightHandScale;
    handScale.setValue(1);
    
    Animated.sequence([
      Animated.timing(handScale, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(handScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speak('Perfect!');
    
    // Fade out arrow
    Animated.parallel([
      Animated.timing(arrowOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(arrowScale, {
        toValue: 1.5,
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
      }, 1000);
    });
  }, [round, arrowOpacity, arrowScale, leftHandScale, rightHandScale, generateArrow]);

  const handleMiss = useCallback(() => {
    if (hasTapped) return;
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speak(`Use ${expectedHand} hand!`);
    
    // Shake arrow
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
    
    // Continue and let arrow pass, then move to next round
    setTimeout(() => {
      if (showArrow && !hasTapped) {
        setShowArrow(false);
        arrowOpacity.setValue(0);
        
        setTimeout(() => {
          if (round < TOTAL_ROUNDS) {
            setRound((r) => r + 1);
            generateArrow();
          } else {
            endGame();
          }
        }, 500);
      }
    }, 500);
  }, [hasTapped, arrowScale, expectedHand, showArrow, round, arrowOpacity, generateArrow]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 15;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowArrow(false);
    
    if (animationRef.current) {
      animationRef.current.stop();
    }

    try {
      await logGameAndAward({
        type: 'moving-arrows',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['tracking-skills', 'cross-body-coordination', 'visual-motor'],
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
      if (animationRef.current) {
        animationRef.current.stop();
      }
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
        title="Moving Arrows"
        emoji="➡️"
        description="Arrows move hote hue! Track and tap with cross-body!"
        skills={['Tracking skills', 'Cross-body coordination']}
        suitableFor="Children learning to track moving objects and cross-body coordination"
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
    <SafeAreaView style={styles.container}>
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
        <Text style={styles.title}>Moving Arrows</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {showArrow && `Track the arrow! Use ${expectedHand} hand!`}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {showArrow && (
          <Animated.View
            style={[
              styles.arrowContainer,
              {
                opacity: arrowOpacity,
                transform: [
                  { translateX: arrowX },
                  { translateY: arrowY },
                  { scale: arrowScale },
                ],
              },
            ]}
          >
            <Text style={styles.arrowEmoji}>{getArrowEmoji(arrowDirection)}</Text>
          </Animated.View>
        )}

        <View style={styles.handsContainer}>
          <TouchableOpacity
            style={styles.handButton}
            onPress={handleLeftHandTap}
            activeOpacity={0.8}
          >
            <Animated.View
              style={[
                styles.handTarget,
                styles.leftHand,
                { transform: [{ scale: leftHandScale }] },
              ]}
            >
              <Text style={styles.handEmoji}>👈</Text>
              <Text style={styles.handLabel}>LEFT</Text>
              {showArrow && expectedHand === 'left' && (
                <View style={styles.highlightIndicator}>
                  <Text style={styles.highlightText}>TAP!</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.handButton}
            onPress={handleRightHandTap}
            activeOpacity={0.8}
          >
            <Animated.View
              style={[
                styles.handTarget,
                styles.rightHand,
                { transform: [{ scale: rightHandScale }] },
              ]}
            >
              <Text style={styles.handEmoji}>👉</Text>
              <Text style={styles.handLabel}>RIGHT</Text>
              {showArrow && expectedHand === 'right' && (
                <View style={styles.highlightIndicator}>
                  <Text style={styles.highlightText}>TAP!</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Tracking skills • Cross-body coordination
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
    position: 'absolute',
    width: ARROW_SIZE,
    height: ARROW_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowEmoji: {
    fontSize: 80,
  },
  handsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
    marginTop: 40,
    position: 'absolute',
    bottom: 100,
  },
  handButton: {
    width: 140,
    height: 140,
  },
  handTarget: {
    width: 140,
    height: 140,
    borderRadius: 70,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    position: 'relative',
  },
  leftHand: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightHand: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  handEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  handLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  highlightIndicator: {
    position: 'absolute',
    top: -30,
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  highlightText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#fff',
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

export default MovingArrowsGame;
