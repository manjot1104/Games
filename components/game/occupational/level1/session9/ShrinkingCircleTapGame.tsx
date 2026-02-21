import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { SparkleBurst } from '@/components/game/FX';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { speak as speakTTS } from '@/utils/tts';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withTiming,
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const INITIAL_CIRCLE_SIZE = 220; // Large circle
const MIN_CIRCLE_SIZE = 20; // Smallest before disappearing (almost invisible)
const SHRINK_DURATION = 6000; // 6 seconds to shrink very slowly
const TIMER_BAR_HEIGHT = 8;

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri },
        { volume: 0.6, shouldPlay: false },
      );
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch {}
  }, [ensureSound]);

  return play;
};

const ShrinkingCircleTapGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(false);
  const [lastResult, setLastResult] = useState<'hit' | 'miss' | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [sparkleKey, setSparkleKey] = useState(0);

  // Animation values
  const circleSize = useSharedValue(INITIAL_CIRCLE_SIZE);
  const circleOpacity = useSharedValue(1);
  const circleScale = useSharedValue(1);
  const timerProgress = useSharedValue(0);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const feedbackOpacity = useSharedValue(0);

  const animationRef = useRef<any>(null);
  const roundActiveRef = useRef(false);
  const roundRef = useRef(1);
  const scoreRef = useRef(0);
  const circleX = useSharedValue(50); // Center position (%)
  const circleY = useSharedValue(50);
  const timeoutRefs = useRef<NodeJS.Timeout[]>([]);

  // Keep refs in sync
  useEffect(() => {
    roundRef.current = round;
    scoreRef.current = score;
  }, [round, score]);

  // End game function
  const endGame = useCallback(async () => {
    if (done) return;
    setDone(true);
    setRoundActive(false);
    roundActiveRef.current = false;

    if (animationRef.current) {
      animationRef.current.stop();
    }

    const finalScore = scoreRef.current;
    const totalRounds = TOTAL_ROUNDS;
    const xp = Math.floor((finalScore / totalRounds) * 50);

    try {
      const timestamp = await recordGame({
        type: 'shrinkingCircleTap',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
      });

      await logGameAndAward({
        gameType: 'shrinkingCircleTap',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
        xp,
      });

      setFinalStats({
        correct: finalScore,
        total: totalRounds,
        xp,
      });
      setLogTimestamp(timestamp);
      setShowCongratulations(true);
      speakTTS('Amazing work! You completed the game!', 0.78);
    } catch (error) {
      console.error('Failed to save game result:', error);
      // Still show congratulations even if logging fails
      setShowCongratulations(true);
      speakTTS('Amazing work! You completed the game!', 0.78);
    }
  }, [done]);

  // Start round ref for handleMiss
  const startRoundRef = useRef<() => void>();

  // Handle miss (defined before startRound) - with optional message
  const handleMiss = useCallback(async (message?: string) => {
    if (!roundActiveRef.current || done) return;

    setLastResult('miss');
    if (message) {
      setFeedbackMessage(message);
    } else {
      setFeedbackMessage('Try again!');
    }
    setShowFeedback(true);
    setRoundActive(false);
    roundActiveRef.current = false;

    if (animationRef.current) {
      animationRef.current.stop();
    }

    // Gentle shake animation
    circleScale.value = withSequence(
      withTiming(0.95, { duration: 100, easing: Easing.out(Easing.ease) }),
      withTiming(1.05, { duration: 100, easing: Easing.in(Easing.ease) }),
      withTiming(1, { duration: 100, easing: Easing.out(Easing.ease) })
    );

    feedbackOpacity.value = withTiming(1, { duration: 200 });

    try {
      await playError();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      speakTTS(message || 'Try again!', 0.78);
    } catch {}

    // Gentle reset and retry after showing feedback
    const timeout1 = setTimeout(() => {
      setShowFeedback(false);
      feedbackOpacity.value = 0;
      // Reset circle to initial state
      circleSize.value = INITIAL_CIRCLE_SIZE;
      circleOpacity.value = 1;
      circleScale.value = 1;
      timerProgress.value = 0;
      const timeout2 = setTimeout(() => {
        if (startRoundRef.current) {
          startRoundRef.current();
        }
      }, 300);
      timeoutRefs.current.push(timeout2);
    }, 2000);
    timeoutRefs.current.push(timeout1);
  }, [done, circleScale, feedbackOpacity, playError, circleSize, circleOpacity, timerProgress]);

  // Start a new round
  const startRound = useCallback(() => {
    if (done) return;

    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    feedbackOpacity.value = 0;

    // Fixed center position - circle position doesn't change
    circleX.value = 50; // Center horizontally
    circleY.value = 50; // Center vertically

    // Reset circle first - make it appear large
    circleSize.value = INITIAL_CIRCLE_SIZE;
    circleOpacity.value = 1;
    circleScale.value = 1;
    timerProgress.value = 0;

    // Start shrink animation immediately - circle shrinks gradually over 6 seconds
    // Use linear easing for consistent, clearly visible shrinking
    const shrinkAnim = withTiming(
      MIN_CIRCLE_SIZE,
      {
        duration: SHRINK_DURATION,
        easing: Easing.linear, // Linear for consistent, clearly visible shrinking
      },
      (finished) => {
        if (finished && roundActiveRef.current) {
          // Circle disappeared - too late
          runOnJS(() => handleMiss('Too late! Tap before it disappears!'))();
        }
      }
    );

    circleSize.value = shrinkAnim;

    // Timer bar animation
    timerProgress.value = withTiming(1, {
      duration: SHRINK_DURATION,
      easing: Easing.linear,
    });

    animationRef.current = { stop: () => {
      circleSize.value = withTiming(MIN_CIRCLE_SIZE, { duration: 0 });
      timerProgress.value = withTiming(1, { duration: 0 });
    }};
  }, [done, circleSize, circleOpacity, circleScale, timerProgress, circleX, circleY, feedbackOpacity, handleMiss]);
  
  // Set ref after startRound is defined
  useEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  // Handle circle tap
  const handleCircleTap = useCallback(async () => {
    if (!roundActiveRef.current || done) return;

    const currentSize = circleSize.value;
    
    // Check if circle is still visible (not disappeared) - if user taps before it disappears, it's perfect!
    if (currentSize > MIN_CIRCLE_SIZE + 10) {
      // Circle is still visible - perfect tap before it disappears!
      setLastResult('hit');
      setFeedbackMessage('Perfect!');
      setShowFeedback(true);
      setRoundActive(false);
      roundActiveRef.current = false;
      setScore((s) => s + 1);

      // Stop animation
      if (animationRef.current) {
        animationRef.current.stop();
      }

      // Success animation
      circleScale.value = withSequence(
        withTiming(1.3, { duration: 150, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) })
      );

      circleOpacity.value = withTiming(0, { duration: 200 });

      feedbackOpacity.value = withTiming(1, { duration: 200 });

      // Sparkle effect at center
      sparkleX.value = 50;
      sparkleY.value = 50;
      setSparkleKey((k) => k + 1);

      try {
        await playSuccess();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        speakTTS('Perfect!', 0.78);
      } catch {}

      // Next round or finish
      if (roundRef.current >= TOTAL_ROUNDS) {
        const timeout1 = setTimeout(() => {
          endGame();
        }, 1500);
        timeoutRefs.current.push(timeout1);
      } else {
        const timeout1 = setTimeout(() => {
          setShowFeedback(false);
          feedbackOpacity.value = 0;
          setRound((r) => r + 1);
          const timeout2 = setTimeout(() => {
            startRound();
          }, 500);
          timeoutRefs.current.push(timeout2);
        }, 1500);
        timeoutRefs.current.push(timeout1);
      }
    } else {
      // Circle already disappeared - too late
      handleMiss('Too late! Tap before it disappears!');
    }
  }, [done, circleSize, circleScale, circleOpacity, feedbackOpacity, playSuccess, endGame, startRound, handleMiss]);

  // Set ref after startRound is defined
  useEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  // Start first round
  useEffect(() => {
    if (startRoundRef.current) {
      startRoundRef.current();
    } else {
      // Fallback: call startRound directly if ref not set yet
      startRound();
    }
    return () => {
      // Clear all timeouts
      timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
      timeoutRefs.current = [];
      // Stop TTS and sounds
      stopAllSpeech();
      cleanupSounds();
      // Stop animations
      if (animationRef.current) {
        animationRef.current.stop();
      }
    };
  }, [startRound]);

  // Animated styles
  const circleAnimatedStyle = useAnimatedStyle(() => {
    return {
      width: circleSize.value,
      height: circleSize.value,
      opacity: circleOpacity.value,
      transform: [{ scale: circleScale.value }],
    };
  });

  const timerBarStyle = useAnimatedStyle(() => {
    return {
      width: `${timerProgress.value * 100}%`,
    };
  });

  const circlePositionStyle = useAnimatedStyle(() => {
    const size = circleSize.value;
    return {
      left: `${circleX.value}%`,
      top: `${circleY.value}%`,
      width: size + 40, // Larger hit area
      height: size + 40,
      transform: [
        { translateX: -(size + 40) / 2 },
        { translateY: -(size + 40) / 2 },
      ],
    };
  });

  const feedbackStyle = useAnimatedStyle(() => {
    return {
      opacity: feedbackOpacity.value,
    };
  });

  useEffect(() => {
    if (!done) {
      try {
        speakTTS('Tap the circle as it shrinks!', 0.78);
      } catch {}
    }
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  const handleBack = useCallback(() => {
    // Clear all timeouts
    timeoutRefs.current.forEach(timeout => clearTimeout(timeout));
    timeoutRefs.current = [];
    // Stop animations
    if (animationRef.current) {
      animationRef.current.stop();
    }
    // Stop round activity
    roundActiveRef.current = false;
    setRoundActive(false);
    // Stop TTS and sounds
    stopAllSpeech();
    cleanupSounds();
    if (onBack) {
      onBack();
    } else {
      // Safe fallback: try to go back, but catch errors
      try {
        if (router.canGoBack()) {
          router.back();
        } else {
          // If can't go back, navigate to a safe route
          router.replace('/(tabs)/Games');
        }
      } catch (error) {
        // If navigation fails, try to navigate to Games tab
        try {
          router.replace('/(tabs)/Games');
        } catch (e) {
          console.warn('Navigation error:', e);
        }
      }
    }
  }, [onBack, router]);

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Precision Master!"
        showButtons={true}
        onContinue={() => {
          // Continue - go back to games (no ResultCard screen needed)
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
        onHome={() => {
          stopAllSpeech();
          cleanupSounds();
          onBack?.();
        }}
      />
    );
  }

  // Prevent any rendering when game is done but congratulations hasn't shown yet
  if (done && finalStats && !showCongratulations) {
    return null; // Wait for showCongratulations to be set
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Shrinking Circle Tap</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.helper}>
          Tap the circle before it disappears!
        </Text>
      </View>

      {/* Timer bar */}
      <View style={styles.timerBarContainer}>
        <Animated.View style={[styles.timerBar, timerBarStyle]} />
      </View>

      {/* Play area */}
      <View style={styles.playArea}>
        {/* Circle with Pressable - only taps on circle count */}
        <Animated.View
          style={[
            styles.circleContainer,
            circlePositionStyle,
          ]}
        >
          <Pressable
            onPress={handleCircleTap}
            style={styles.circlePressable}
            disabled={!roundActive || done}
          >
            <Animated.View
              style={[
                styles.circle,
                circleAnimatedStyle,
              ]}
            />
          </Pressable>
        </Animated.View>

        {/* Feedback */}
        {showFeedback && lastResult && (
          <Animated.View style={[styles.feedbackContainer, feedbackStyle]}>
            <Text style={[
              styles.feedbackText,
              lastResult === 'hit' ? styles.feedbackSuccess : styles.feedbackError,
            ]}>
              {feedbackMessage || (lastResult === 'hit' ? 'Perfect timing!' : 'Try again!')}
            </Text>
          </Animated.View>
        )}

        {/* Sparkle effect */}
        {sparkleKey > 0 && (
          <SparkleBurst
            key={sparkleKey}
            x={sparkleX.value}
            y={sparkleY.value}
          />
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F4F8',
  },
  backChip: {
    alignSelf: 'flex-start',
    margin: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  backChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  headerBlock: {
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1E293B',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748B',
    marginBottom: 8,
  },
  helper: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
  },
  timerBarContainer: {
    height: TIMER_BAR_HEIGHT,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 4,
    overflow: 'hidden',
  },
  timerBar: {
    height: '100%',
    backgroundColor: '#3B82F6',
    borderRadius: 4,
  },
  playArea: {
    flex: 1,
    position: 'relative',
    margin: 20,
  },
  playAreaPressable: {
    flex: 1,
    width: '100%',
  },
  circleContainer: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  circlePressable: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  circle: {
    backgroundColor: '#3B82F6',
    borderRadius: 1000,
    borderWidth: 4,
    borderColor: '#2563EB',
  },
  feedbackContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -100 }, { translateY: -20 }],
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  feedbackText: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  feedbackSuccess: {
    color: '#22C55E',
  },
  feedbackError: {
    color: '#EF4444',
  },
  scrollContent: {
    padding: 20,
  },
});

export default ShrinkingCircleTapGame;

