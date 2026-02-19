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
    withTiming,
    withSequence,
} from 'react-native-reanimated';

const TOTAL_ROUNDS = 10;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const HOLD_SIZE = 120;
const TAP_SIZE = 100;
const HOLD_DURATION = 3000; // 3 seconds to hold

const HoldAndTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(true);
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [tapCount, setTapCount] = useState(0);
  const [targetTaps, setTargetTaps] = useState(5);
  const [holdSide, setHoldSide] = useState<'left' | 'right'>('left');

  const holdScale = useSharedValue(1);
  const tapScale = useSharedValue(1);
  const holdOpacity = useSharedValue(1);
  const tapOpacity = useSharedValue(1);
  const screenWidth = useRef(SCREEN_WIDTH);
  const screenHeight = useRef(SCREEN_HEIGHT);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  const startRound = useCallback(() => {
    setIsHolding(false);
    setHoldProgress(0);
    setTapCount(0);
    setTargetTaps(5);
    setHoldSide(Math.random() < 0.5 ? 'left' : 'right');
    holdScale.value = withSpring(1);
    tapScale.value = withSpring(1);
    holdOpacity.value = withTiming(1);
    tapOpacity.value = withTiming(1);
  }, [holdScale, tapScale, holdOpacity, tapOpacity]);

  const handleHoldStart = useCallback(() => {
    if (done || isHolding) return;
    setIsHolding(true);
    setHoldProgress(0);
    holdScale.value = withSpring(1.2);
    
    let progress = 0;
    progressTimerRef.current = setInterval(() => {
      progress += 100;
      setHoldProgress(progress);
      if (progress >= HOLD_DURATION) {
        clearInterval(progressTimerRef.current as unknown as ReturnType<typeof setInterval>);
        progressTimerRef.current = null;
        // Hold complete!
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        speakTTS('Hold complete! Now tap!', 0.8, 'en-US' );
      }
    }, 100) as unknown as NodeJS.Timeout;
  }, [done, isHolding, holdScale]);

  const handleHoldEnd = useCallback(() => {
    if (done || !isHolding) return;
    setIsHolding(false);
    holdScale.value = withSpring(1);
    setHoldProgress(0);
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current as unknown as ReturnType<typeof setInterval>);
      progressTimerRef.current = null;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    speakTTS('Keep holding!', 0.8, 'en-US' );
  }, [done, isHolding, holdScale]);

  const handleTap = useCallback(() => {
    if (done || !isHolding || holdProgress < HOLD_DURATION) return;
    
    setTapCount((c) => {
      const newCount = c + 1;
      tapScale.value = withSequence(
        withSpring(1.3),
        withSpring(1)
      );
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      
      if (newCount >= targetTaps) {
        // Completed!
        setIsHolding(false);
        if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current as unknown as ReturnType<typeof setInterval>);
          progressTimerRef.current = null;
        }
        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
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
        speakTTS('Perfect! Hand independence!', 0.9, 'en-US' );
      }
      return newCount;
    });
  }, [done, isHolding, holdProgress, targetTaps, tapScale, startRound]);

  const endGame = useCallback(async (finalScore: number) => {
    const total = TOTAL_ROUNDS;
    const xp = finalScore * 15;
    const accuracy = (finalScore / total) * 100;

    setFinalStats({ correct: finalScore, total, xp });
    setDone(true);
    setIsHolding(false);

    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      holdTimerRef.current = null;
    }
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current as unknown as ReturnType<typeof setInterval>);
      progressTimerRef.current = null;
    }

    try {
      await logGameAndAward({
        type: 'hold-and-tap',
        correct: finalScore,
        total,
        accuracy,
        xpAwarded: xp,
        skillTags: ['hand-independence', 'two-hand-tap'],
      });
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (error) {
      console.error('Failed to log game:', error);
    }
  }, [router]);

  useEffect(() => {
    if (!showInfo && !done) {
      startRound();
      speakTTS(`${holdSide === 'left' ? 'Left' : 'Right'} hand hold, other hand tap!`, { rate: 0.8, language: 'en-US' });
    }
  }, [showInfo, round, done, startRound, holdSide]);

  useEffect(() => {
    return () => {
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
      cleanupSounds();
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current as unknown as ReturnType<typeof setTimeout>);
      }
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current as unknown as ReturnType<typeof setInterval>);
      }
    };
  }, []);

  const holdStyle = useAnimatedStyle(() => ({
    transform: [{ scale: holdScale.value }],
    opacity: holdOpacity.value,
  }));

  const tapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: tapScale.value }],
    opacity: tapOpacity.value,
  }));

  const holdProgressStyle = {
    width: `${(holdProgress / HOLD_DURATION) * 100}%`,
  };

  if (showInfo) {
    return (
      <GameInfoScreen
        title="Hold & Tap"
        emoji="🤲"
        description="Hold with one hand, tap with the other hand!"
        skills={['Hand independence']}
        suitableFor="Children learning hand independence through hold and tap"
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
        <Text style={styles.title}>Hold & Tap</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🤲 Score: {score}
        </Text>
        <Text style={styles.instruction}>
          {holdSide === 'left' ? 'Hold LEFT, tap RIGHT!' : 'Hold RIGHT, tap LEFT!'}
        </Text>
        {isHolding && (
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, holdProgressStyle]} />
          </View>
        )}
        <Text style={styles.tapCount}>
          Taps: {tapCount}/{targetTaps}
        </Text>
      </View>

      <View
        style={styles.gameArea}
        onLayout={(e) => {
          screenWidth.current = e.nativeEvent.layout.width;
          screenHeight.current = e.nativeEvent.layout.height;
        }}
      >
        <View style={styles.handsContainer}>
          {holdSide === 'left' ? (
            <>
              <TouchableOpacity
                style={styles.holdWrapper}
                onPressIn={handleHoldStart}
                onPressOut={handleHoldEnd}
                activeOpacity={0.8}
              >
                <Animated.View style={[styles.holdButton, styles.leftHold, holdStyle]}>
                  <Text style={styles.holdEmoji}>👈</Text>
                  <Text style={styles.holdLabel}>HOLD</Text>
                </Animated.View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.tapWrapper}
                onPress={handleTap}
                activeOpacity={0.8}
                disabled={!isHolding || holdProgress < HOLD_DURATION}
              >
                <Animated.View style={[styles.tapButton, styles.rightTap, tapStyle]}>
                  <Text style={styles.tapEmoji}>👉</Text>
                  <Text style={styles.tapLabel}>TAP</Text>
                </Animated.View>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={styles.tapWrapper}
                onPress={handleTap}
                activeOpacity={0.8}
                disabled={!isHolding || holdProgress < HOLD_DURATION}
              >
                <Animated.View style={[styles.tapButton, styles.leftTap, tapStyle]}>
                  <Text style={styles.tapEmoji}>👈</Text>
                  <Text style={styles.tapLabel}>TAP</Text>
                </Animated.View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.holdWrapper}
                onPressIn={handleHoldStart}
                onPressOut={handleHoldEnd}
                activeOpacity={0.8}
              >
                <Animated.View style={[styles.holdButton, styles.rightHold, holdStyle]}>
                  <Text style={styles.holdEmoji}>👉</Text>
                  <Text style={styles.holdLabel}>HOLD</Text>
                </Animated.View>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Skills: Hand independence
        </Text>
        <Text style={styles.footerSubtext}>
          Hold with one hand, tap with the other hand!
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
    color: '#8B5CF6',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  progressContainer: {
    width: 200,
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 4,
  },
  tapCount: {
    fontSize: 14,
    color: '#8B5CF6',
    fontWeight: '700',
  },
  gameArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
  handsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  holdWrapper: {
    width: HOLD_SIZE,
    height: HOLD_SIZE,
  },
  tapWrapper: {
    width: TAP_SIZE,
    height: TAP_SIZE,
  },
  holdButton: {
    width: HOLD_SIZE,
    height: HOLD_SIZE,
    borderRadius: HOLD_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftHold: {
    backgroundColor: '#3B82F6',
    borderColor: '#2563EB',
  },
  rightHold: {
    backgroundColor: '#EF4444',
    borderColor: '#DC2626',
  },
  holdEmoji: {
    fontSize: 50,
    marginBottom: 5,
  },
  holdLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  tapButton: {
    width: TAP_SIZE,
    height: TAP_SIZE,
    borderRadius: TAP_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
  },
  leftTap: {
    backgroundColor: '#10B981',
    borderColor: '#059669',
  },
  rightTap: {
    backgroundColor: '#F59E0B',
    borderColor: '#D97706',
  },
  tapEmoji: {
    fontSize: 40,
    marginBottom: 5,
  },
  tapLabel: {
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
    marginBottom: 4,
    textAlign: 'center',
  },
  footerSubtext: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});

export default HoldAndTapGame;
