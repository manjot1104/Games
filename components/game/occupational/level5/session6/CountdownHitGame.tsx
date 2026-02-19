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
    withTiming,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 8;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const TARGET_SIZE = 70;
const TOLERANCE = 50;
const COUNTDOWN_TIME = 3000; // 3 seconds

const CountdownHitGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [targetVisible, setTargetVisible] = useState(false);
  
  const targetX = useSharedValue(SCREEN_WIDTH * 0.5);
  const targetY = useSharedValue(SCREEN_HEIGHT * 0.5);
  const targetScale = useSharedValue(1);
  const targetOpacity = useSharedValue(0);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startRound = useCallback(() => {
    // Stop any ongoing TTS when new round starts
    stopTTS();
    setCountdown(3);
    setTargetVisible(false);
    targetOpacity.value = 0;
    
    let currentCount = 3;
    const countdownInterval = setInterval(() => {
      currentCount--;
      setCountdown(currentCount);
      speakTTS(currentCount.toString(), 0.9, 'en-US' );
      
      if (currentCount === 0) {
        clearInterval(countdownInterval);
        // Show target
        targetX.value = Math.random() * (screenWidth.current - TARGET_SIZE) + TARGET_SIZE / 2;
        targetY.value = Math.random() * (screenHeight.current - TARGET_SIZE - 200) + TARGET_SIZE / 2 + 100;
        targetOpacity.value = withTiming(1, { duration: 300 });
        targetScale.value = withSpring(1.2, {}, () => {
          targetScale.value = withSpring(1);
        });
        setTargetVisible(true);
        speakTTS('Tap now!', 0.9, 'en-US' );
      }
    }, 1000);
    
    countdownTimerRef.current = countdownInterval;
  }, [targetX, targetY, targetOpacity, targetScale]);

  const handleTap = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    if (done || !targetVisible) return;
    
    const tapX = event.nativeEvent.pageX;
    const tapY = event.nativeEvent.pageY;
    
    const distance = Math.sqrt(
      Math.pow(tapX - targetX.value, 2) + Math.pow(tapY - targetY.value, 2)
    );

    if (distance <= TOLERANCE + TARGET_SIZE / 2) {
      targetOpacity.value = withTiming(0, { duration: 200 });
      setTargetVisible(false);

      setScore((s) => {
        const newScore = s + 1;
        if (newScore >= TOTAL_ROUNDS) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
          }
          setTimeout(() => {
            endGame(newScore);
          }, 1000);
        } else {
          setTimeout(() => {
            setRound((r) => r + 1);
            startRound();
          }, 1500);
        }
        return newScore;
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      speakTTS('Perfect timing!', 0.9, 'en-US' );
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [done, targetVisible, targetX, targetY, targetOpacity, startRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 18;
    const accuracy = (finalScore / total) * 100;

    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);

    try {
      await logGameAndAward({
        type: 'countdown-hit',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['anticipation', 'timing', 'countdown-response'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
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
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
      }
    };
  }, []);

  const targetStyle = useAnimatedStyle(() => ({
    left: targetX.value - TARGET_SIZE / 2,
    top: targetY.value - TARGET_SIZE / 2,
    transform: [{ scale: targetScale.value }],
    opacity: targetOpacity.value,
  }));

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Countdown Hit"
        emoji="⏰"
        description="Wait for the countdown, then tap! Build anticipation."
        skills={['Anticipation']}
        suitableFor="Children learning anticipation and timing"
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
            startRound();
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
        <Text style={styles.title}>Countdown Hit</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ⏰ Score: {score}
        </Text>
        <View style={styles.countdownContainer}>
          {!targetVisible && countdown > 0 && (
            <Text style={styles.countdownText}>{countdown}</Text>
          )}
          {targetVisible && (
            <Text style={styles.tapText}>TAP NOW!</Text>
          )}
        </View>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
        onTouchEnd={handleTap}
      >
        <Animated.View style={[styles.target, targetStyle]}>
          <Text style={styles.targetEmoji}>🎯</Text>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Anticipation
        </Text>
        <Text style={styles.footerSubtext}>
          Wait for countdown, then tap!
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
  countdownContainer: {
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 48,
    fontWeight: '900',
    color: '#EF4444',
  },
  tapText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#10B981',
  },
  gameArea: {
    flex: 1,
    position: 'relative',
    marginVertical: 40,
  },
  target: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#D97706',
    shadowColor: '#F59E0B',
    shadowOpacity: 0.6,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  targetEmoji: {
    fontSize: 40,
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

export default CountdownHitGame;
