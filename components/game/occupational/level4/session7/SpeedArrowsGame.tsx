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

const TOTAL_ROUNDS = 12;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const ARROW_SIZE = 150;
const INITIAL_DISPLAY_TIME = 2000; // Start with 2 seconds
const MIN_DISPLAY_TIME = 800; // Fastest: 0.8 seconds
const TIME_DECREASE = 150; // Decrease by 150ms each round

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

const SpeedArrowsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
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
  const [displayTime, setDisplayTime] = useState(INITIAL_DISPLAY_TIME);

  const arrowScale = useRef(new Animated.Value(1)).current;
  const arrowOpacity = useRef(new Animated.Value(0)).current;
  const leftHandScale = useRef(new Animated.Value(1)).current;
  const rightHandScale = useRef(new Animated.Value(1)).current;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

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
    arrowScale.setValue(0.5);
    
    // Quick appearance
    Animated.parallel([
      Animated.timing(arrowOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.spring(arrowScale, {
        toValue: 1,
        tension: 100,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
    
    // Calculate current display time (gets faster as rounds progress)
    const currentTime = Math.max(
      MIN_DISPLAY_TIME,
      INITIAL_DISPLAY_TIME - (round - 1) * TIME_DECREASE
    );
    setDisplayTime(currentTime);
    
    // Auto-hide after display time
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      if (!hasTapped && showArrow) {
        handleTimeout();
      }
    }, currentTime);
    
    const instruction = `Arrow ${dir}! Use ${expectedHand} hand!`;
    speak(instruction);
  }, [arrowOpacity, arrowScale, expectedHand, round, hasTapped, showArrow]);

  const handleLeftHandTap = useCallback(() => {
    if (done || !showArrow || hasTapped) return;
    
    if (expectedHand === 'left') {
      handleSuccess('left');
    } else {
      handleWrong();
    }
  }, [done, showArrow, hasTapped, expectedHand]);

  const handleRightHandTap = useCallback(() => {
    if (done || !showArrow || hasTapped) return;
    
    if (expectedHand === 'right') {
      handleSuccess('right');
    } else {
      handleWrong();
    }
  }, [done, showArrow, hasTapped, expectedHand]);

  const handleSuccess = useCallback((hand: 'left' | 'right') => {
    setHasTapped(true);
    setScore((s) => s + 1);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
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
    speak('Fast!');
    
    // Quick fade out
    Animated.parallel([
      Animated.timing(arrowOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(arrowScale, {
        toValue: 1.5,
        duration: 150,
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
      }, 300);
    });
  }, [round, arrowOpacity, arrowScale, leftHandScale, rightHandScale, generateArrow]);

  const handleWrong = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    speak(`Use ${expectedHand} hand!`);
    
    // Quick shake
    Animated.sequence([
      Animated.timing(arrowScale, {
        toValue: 0.9,
        duration: 80,
        useNativeDriver: true,
      }),
      Animated.timing(arrowScale, {
        toValue: 1,
        duration: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [arrowScale, expectedHand]);

  const handleTimeout = useCallback(() => {
    if (hasTapped) return;
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    speak('Too slow!');
    
    // Fade out
    Animated.parallel([
      Animated.timing(arrowOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(arrowScale, {
        toValue: 0.8,
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
  }, [hasTapped, round, arrowOpacity, arrowScale, generateArrow]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 18;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setShowArrow(false);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'speed-arrows',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['reaction-speed', 'cross-body-coordination', 'visual-motor'],
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
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
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

  const getSpeedText = () => {
    if (displayTime >= 1500) return 'Normal';
    if (displayTime >= 1000) return 'Fast';
    return 'Very Fast!';
  };

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Speed Arrows"
        emoji="⚡"
        description="Fast-changing arrows! React quickly with cross-body!"
        skills={['Reaction speed', 'Cross-body coordination']}
        suitableFor="Children learning fast reaction times and cross-body coordination"
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
            setDisplayTime(INITIAL_DISPLAY_TIME);
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
        <Text style={styles.title}>Speed Arrows</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.speedIndicator}>
          Speed: {getSpeedText()} ({displayTime}ms)
        </Text>
        <Text style={styles.instruction}>
          {showArrow && `Arrow ${arrowDirection} → Use ${expectedHand} hand!`}
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
            <View style={styles.timerBar}>
              <Animated.View
                style={[
                  styles.timerFill,
                  {
                    width: arrowOpacity.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
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
          Skills: Reaction speed • Cross-body coordination
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
    marginBottom: 8,
  },
  speedIndicator: {
    fontSize: 16,
    color: '#F59E0B',
    fontWeight: '700',
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
    marginBottom: 12,
  },
  timerBar: {
    width: 200,
    height: 4,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  timerFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
  },
  handsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
    marginTop: 40,
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

export default SpeedArrowsGame;
