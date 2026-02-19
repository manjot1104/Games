import GameInfoScreen from '@/components/game/GameInfoScreen';
import ResultCard from '@/components/game/ResultCard';
import { logGameAndAward } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Dimensions,
    Platform,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withSequence,
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const FLASH_DURATION = 1500; // 1.5 seconds to respond
const FLASH_DELAY = 2000; // 2 seconds between flashes

const FlashSideGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [flashedSide, setFlashedSide] = useState<'left' | 'right' | null>(null);
  const [waitingForResponse, setWaitingForResponse] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(FLASH_DURATION);

  const leftFlash = useSharedValue(0);
  const rightFlash = useSharedValue(0);
  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const flashTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerFlash = useCallback(() => {
    if (done) return;
    
    const side = Math.random() < 0.5 ? 'left' : 'right';
    setFlashedSide(side);
    setWaitingForResponse(true);
    setTimeRemaining(FLASH_DURATION);
    
    // Flash animation
    if (side === 'left') {
      leftFlash.value = withSequence(
        withTiming(1, { duration: 200 }),
        withTiming(0.3, { duration: 1300 }),
        withTiming(0, { duration: 0 })
      );
    } else {
      rightFlash.value = withSequence(
        withTiming(1, { duration: 200 }),
        withTiming(0.3, { duration: 1300 }),
        withTiming(0, { duration: 0 })
      );
    }
    
    speakTTS(`Flash ${side}! Use ${side} hand!`, 0.8, 'en-US' );
    
    // Timer countdown
    let timeLeft = FLASH_DURATION;
    timerRef.current = setInterval(() => {
      timeLeft -= 100;
      setTimeRemaining(timeLeft);
      if (timeLeft <= 0) {
        clearInterval(timerRef.current as unknown as ReturnType<typeof setInterval>);
        timerRef.current = null;
        // Time's up
        setWaitingForResponse(false);
        setFlashedSide(null);
        leftFlash.value = 0;
        rightFlash.value = 0;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        speakTTS('Too slow! Try again!', 0.8, 'en-US' );
        
        // Next flash
        flashTimerRef.current = setTimeout(() => {
          triggerFlash();
        }, FLASH_DELAY) as unknown as NodeJS.Timeout;
      }
    }, 100) as unknown as NodeJS.Timeout;
  }, [done, leftFlash, rightFlash]);

  const handleLeftTap = useCallback(() => {
    if (done || !waitingForResponse || flashedSide !== 'left') {
      if (waitingForResponse && flashedSide === 'right') {
        // Wrong side
        leftScale.value = withSequence(
          withSpring(0.8),
          withSpring(1)
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Wrong side! Use right hand!', 0.8, 'en-US' );
      }
      return;
    }

    // Correct!
    if (timerRef.current) {
      clearInterval(timerRef.current as unknown as ReturnType<typeof setInterval>);
      timerRef.current = null;
    }
    
    leftScale.value = withSequence(
      withSpring(1.3),
      withSpring(1)
    );
    leftFlash.value = 0;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect!', 0.9, 'en-US' );
    
    setWaitingForResponse(false);
    setFlashedSide(null);
    
    setScore((s) => {
      const newScore = s + 1;
      if (newScore >= TOTAL_ROUNDS) {
        setTimeout(() => {
          endGame(newScore);
        }, 1000);
      } else {
        setTimeout(() => {
          setRound((r) => r + 1);
          triggerFlash();
        }, 1500);
      }
      return newScore;
    });
  }, [done, waitingForResponse, flashedSide, leftScale, leftFlash, triggerFlash]);

  const handleRightTap = useCallback(() => {
    if (done || !waitingForResponse || flashedSide !== 'right') {
      if (waitingForResponse && flashedSide === 'left') {
        // Wrong side
        rightScale.value = withSequence(
          withSpring(0.8),
          withSpring(1)
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        speakTTS('Wrong side! Use left hand!', 0.8, 'en-US' );
      }
      return;
    }

    // Correct!
    if (timerRef.current) {
      clearInterval(timerRef.current as unknown as ReturnType<typeof setInterval>);
      timerRef.current = null;
    }
    
    rightScale.value = withSequence(
      withSpring(1.3),
      withSpring(1)
    );
    rightFlash.value = 0;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    speakTTS('Perfect!', 0.9, 'en-US' );
    
    setWaitingForResponse(false);
    setFlashedSide(null);
    
    setScore((s) => {
      const newScore = s + 1;
      if (newScore >= TOTAL_ROUNDS) {
        setTimeout(() => {
          endGame(newScore);
        }, 1000);
      } else {
        setTimeout(() => {
          setRound((r) => r + 1);
          triggerFlash();
        }, 1500);
      }
      return newScore;
    });
  }, [done, waitingForResponse, flashedSide, rightScale, rightFlash, triggerFlash]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);
    setWaitingForResponse(false);
    setFlashedSide(null);

    if (timerRef.current) {
      clearInterval(timerRef.current as unknown as ReturnType<typeof setInterval>);
      timerRef.current = null;
    }
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      flashTimerRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'flash-side',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['decision-making', 'reaction-time', 'hand-selection'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      setTimeout(() => {
        triggerFlash();
      }, 500);
    }
  }, [showInfo, round, done, triggerFlash]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (timerRef.current) {
        clearInterval(timerRef.current as unknown as ReturnType<typeof setInterval>);
      }
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      }
    };
  }, []);

  const leftStyle = useAnimatedStyle(() => ({
    transform: [{ scale: leftScale.value }],
    opacity: 0.3 + leftFlash.value * 0.7,
    backgroundColor: leftFlash.value > 0.5 ? '#F59E0B' : '#3B82F6',
  }));

  const rightStyle = useAnimatedStyle(() => ({
    transform: [{ scale: rightScale.value }],
    opacity: 0.3 + rightFlash.value * 0.7,
    backgroundColor: rightFlash.value > 0.5 ? '#F59E0B' : '#EF4444',
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Flash Side Game"
        emoji="⚡"
        description="Screen side flash → same hand response!"
        skills={['Decision making']}
        suitableFor="Children learning decision making through flash response"
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
            setFlashedSide(null);
            setWaitingForResponse(false);
            triggerFlash();
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
        <Text style={styles.title}>Flash Side Game</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⚡ Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {waitingForResponse && flashedSide
            ? `Flash ${flashedSide.toUpperCase()}! Use ${flashedSide} hand!`
            : 'Watch for the flash...'}
        </Text>
        {waitingForResponse && (
          <Text style={styles.timer}>
            Time: {(timeRemaining / 1000).toFixed(1)}s
          </Text>
        )}
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <View style={styles.sidesContainer}>
          <TouchableOpacity
            style={styles.sideWrapper}
            onPress={handleLeftTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.side, styles.leftSide, leftStyle]}>
              <Text style={styles.sideEmoji}>👈</Text>
              <Text style={styles.sideLabel}>LEFT</Text>
              {flashedSide === 'left' && waitingForResponse && (
                <View style={styles.flashIndicator}>
                  <Text style={styles.flashText}>⚡ FLASH!</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.sideWrapper}
            onPress={handleRightTap}
            activeOpacity={0.8}
          >
            <Animated.View style={[styles.side, styles.rightSide, rightStyle]}>
              <Text style={styles.sideEmoji}>👉</Text>
              <Text style={styles.sideLabel}>RIGHT</Text>
              {flashedSide === 'right' && waitingForResponse && (
                <View style={styles.flashIndicator}>
                  <Text style={styles.flashText}>⚡ FLASH!</Text>
                </View>
              )}
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Decision making
        </Text>
        <Text style={styles.footerSubtext}>
          When side flashes, use the same hand!
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
    color: '#F59E0B',
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  timer: {
    fontSize: 16,
    color: '#EF4444',
    fontWeight: '700',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  sidesContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
  },
  sideWrapper: {
    flex: 1,
    height: 300,
    marginHorizontal: 10,
  },
  side: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#CBD5E1',
    position: 'relative',
  },
  leftSide: {
    // Animated color
  },
  rightSide: {
    // Animated color
  },
  sideEmoji: {
    fontSize: 80,
    marginBottom: 10,
  },
  sideLabel: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
  },
  flashIndicator: {
    position: 'absolute',
    top: 20,
    backgroundColor: '#F59E0B',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  flashText: {
    fontSize: 16,
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
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default FlashSideGame;
