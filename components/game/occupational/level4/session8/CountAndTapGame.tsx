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

type Side = 'left' | 'right';

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

const CountAndTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [currentNumber, setCurrentNumber] = useState<number | null>(null);
  const [expectedSide, setExpectedSide] = useState<Side | null>(null);
  const [hasTapped, setHasTapped] = useState(false);

  const numberScale = useRef(new Animated.Value(1)).current;
  const leftTargetScale = useRef(new Animated.Value(1)).current;
  const rightTargetScale = useRef(new Animated.Value(1)).current;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showNumber = useCallback(() => {
    // Generate random number between 1 and 20
    const number = Math.floor(Math.random() * 20) + 1;
    setCurrentNumber(number);
    
    // Odd = left, Even = right
    const side: Side = number % 2 === 1 ? 'left' : 'right';
    setExpectedSide(side);
    setHasTapped(false);
    
    // Reset scales
    numberScale.setValue(1);
    leftTargetScale.setValue(1);
    rightTargetScale.setValue(1);
    
    // Animate number appearance
    numberScale.setValue(0.5);
    Animated.spring(numberScale, {
      toValue: 1,
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();
    
    speak(`Number ${number}! ${number % 2 === 1 ? 'Odd' : 'Even'} = ${side} side!`);
    
    // Auto-advance after 4 seconds if not tapped
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      if (!hasTapped && currentNumber === number) {
        handleTimeout();
      }
    }, 4000);
  }, [numberScale, hasTapped, currentNumber]);

  const handleLeftTap = useCallback(() => {
    if (done || !expectedSide || hasTapped) return;
    
    if (expectedSide === 'left') {
      handleSuccess('left');
    } else {
      handleWrong();
    }
  }, [done, expectedSide, hasTapped]);

  const handleRightTap = useCallback(() => {
    if (done || !expectedSide || hasTapped) return;
    
    if (expectedSide === 'right') {
      handleSuccess('right');
    } else {
      handleWrong();
    }
  }, [done, expectedSide, hasTapped]);

  const handleSuccess = useCallback((side: Side) => {
    setHasTapped(true);
    setScore((s) => s + 1);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    const targetScale = side === 'left' ? leftTargetScale : rightTargetScale;
    
    Animated.sequence([
      Animated.timing(targetScale, {
        toValue: 1.3,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(targetScale, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start();
    
    // Number celebration
    Animated.sequence([
      Animated.timing(numberScale, {
        toValue: 1.5,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(numberScale, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speak('Perfect!');
    
    setTimeout(() => {
      setCurrentNumber(null);
      setExpectedSide(null);
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        showNumber();
      } else {
        endGame();
      }
    }, 1000);
  }, [round, leftTargetScale, rightTargetScale, numberScale, showNumber]);

  const handleWrong = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    const isOdd = currentNumber! % 2 === 1;
    speak(`${currentNumber} is ${isOdd ? 'odd' : 'even'}! Tap ${expectedSide} side!`);
    
    // Shake number
    Animated.sequence([
      Animated.timing(numberScale, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(numberScale, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, [currentNumber, expectedSide, numberScale]);

  const handleTimeout = useCallback(() => {
    if (hasTapped) return;
    
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    speak('Too slow!');
    
    setCurrentNumber(null);
    setExpectedSide(null);
    
    setTimeout(() => {
      if (round < TOTAL_ROUNDS) {
        setRound((r) => r + 1);
        showNumber();
      } else {
        endGame();
      }
    }, 500);
  }, [hasTapped, round, showNumber]);

  const endGame = useCallback(async () => {
    const total = TOTAL_ROUNDS;
    const xp = score * 18;
    const accuracy = (score / total) * 100;

    setFinalStats({ correct: score, total, xp });
    setDone(true);
    setCurrentNumber(null);
    setExpectedSide(null);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    try {
      await logGameAndAward({
        type: 'count-and-tap',
        correct: score,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['cognitive-motor-link', 'number-recognition', 'alternating-sides'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [score, router]);

  useEffect(() => {
    if (!showInfo && !done && round <= TOTAL_ROUNDS) {
      setTimeout(() => {
        showNumber();
      }, 500);
    }
  }, [showInfo, round, done, showNumber]);

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

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Count & Tap"
        emoji="🔢"
        description="Odd = left, even = right! Cognitive-motor link!"
        skills={['Cognitive-motor link', 'Number recognition', 'Alternating sides']}
        suitableFor="Children learning to connect numbers with motor actions"
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
            setCurrentNumber(null);
            setExpectedSide(null);
            numberScale.setValue(1);
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
        <Text style={styles.title}>Count & Tap</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {currentNumber !== null
            ? `${currentNumber} is ${currentNumber % 2 === 1 ? 'ODD' : 'EVEN'} → Tap ${expectedSide}!`
            : 'Wait for number...'}
        </Text>
      </View>

      <View style={styles.gameArea}>
        {currentNumber !== null && (
          <Animated.View
            style={[
              styles.numberContainer,
              { transform: [{ scale: numberScale }] },
            ]}
          >
            <Text style={styles.numberText}>{currentNumber}</Text>
            <Text style={styles.numberLabel}>
              {currentNumber % 2 === 1 ? 'ODD' : 'EVEN'}
            </Text>
          </Animated.View>
        )}

        <View style={styles.targetsContainer}>
          <TouchableOpacity
            style={styles.targetButton}
            onPress={handleLeftTap}
            activeOpacity={0.8}
          >
            <Animated.View
              style={[
                styles.target,
                styles.leftTarget,
                { transform: [{ scale: leftTargetScale }] },
              ]}
            >
              <Text style={styles.targetEmoji}>👈</Text>
              <Text style={styles.targetLabel}>ODD</Text>
              <Text style={styles.targetSubLabel}>LEFT</Text>
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.targetButton}
            onPress={handleRightTap}
            activeOpacity={0.8}
          >
            <Animated.View
              style={[
                styles.target,
                styles.rightTarget,
                { transform: [{ scale: rightTargetScale }] },
              ]}
            >
              <Text style={styles.targetEmoji}>👉</Text>
              <Text style={styles.targetLabel}>EVEN</Text>
              <Text style={styles.targetSubLabel}>RIGHT</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Cognitive-motor link • Number recognition • Alternating sides
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
  numberContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 60,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingHorizontal: 40,
    paddingVertical: 30,
    borderRadius: 30,
  },
  numberText: {
    fontSize: 80,
    fontWeight: '900',
    color: '#3B82F6',
    marginBottom: 10,
  },
  numberLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#3B82F6',
  },
  targetsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  targetButton: {
    width: 140,
    height: 160,
  },
  target: {
    width: 140,
    height: 160,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftTarget: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightTarget: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  targetEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  targetLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
  },
  targetSubLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    opacity: 0.9,
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

export default CountAndTapGame;
