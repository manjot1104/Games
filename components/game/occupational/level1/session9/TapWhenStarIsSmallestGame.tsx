import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { SparkleBurst } from '@/components/game/FX';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
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
const INITIAL_STAR_SIZE = 180; // Big
const MEDIUM_STAR_SIZE = 100; // Medium
const MIN_STAR_SIZE = 50; // Smallest
const SHRINK_DURATION = 5000; // 5 seconds to shrink from big to smallest - slow and visible

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

const TapWhenStarIsSmallestGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
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
  const [sparkleKey, setSparkleKey] = useState(0);
  const [isSmallest, setIsSmallest] = useState(false);

  // Animation values
  const starSize = useSharedValue(INITIAL_STAR_SIZE);
  const starOpacity = useSharedValue(1);
  const starScale = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const feedbackOpacity = useSharedValue(0);

  const animationRef = useRef<any>(null);
  const roundActiveRef = useRef(false);
  const roundRef = useRef(1);
  const scoreRef = useRef(0);
  const starX = useSharedValue(50);
  const starY = useSharedValue(50);
  const isSmallestRef = useRef(false);
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
        type: 'tapWhenStarIsSmallest',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
      });

      await logGameAndAward({
        gameType: 'tapWhenStarIsSmallest',
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

  // Handle miss (defined before startRound)
  const handleMiss = useCallback(async () => {
    if (!roundActiveRef.current || done) return;

    setLastResult('miss');
    setShowFeedback(true);
    setRoundActive(false);
    roundActiveRef.current = false;

    if (animationRef.current) {
      animationRef.current.stop();
    }

    // Shake animation
    starScale.value = withSequence(
      withTiming(0.9, { duration: 100, easing: Easing.out(Easing.ease) }),
      withTiming(1, { duration: 100, easing: Easing.in(Easing.ease) })
    );

    feedbackOpacity.value = withTiming(1, { duration: 200 });

    try {
      await playError();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speakTTS('Wait until it\'s smallest!', 0.78 );
    } catch {}

    const timeout1 = setTimeout(() => {
      setShowFeedback(false);
      feedbackOpacity.value = 0;
      const timeout2 = setTimeout(() => {
        if (startRoundRef.current) {
          startRoundRef.current();
        }
      }, 500);
      timeoutRefs.current.push(timeout2);
    }, 1500);
    timeoutRefs.current.push(timeout1);
  }, [done, starScale, feedbackOpacity, playError]);

  // Start a new round
  const startRound = useCallback(() => {
    if (done) return;

    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    setIsSmallest(false);
    isSmallestRef.current = false;
    feedbackOpacity.value = 0;

    // Random position for star
    const margin = 20;
    starX.value = margin + Math.random() * (100 - margin * 2);
    starY.value = margin + Math.random() * (100 - margin * 2);

    // Reset star first
    starOpacity.value = 1;
    starScale.value = 1;

    // Shrink animation: big → medium → smallest - slow and visible
    // Use linear easing for consistent, clearly visible shrinking
    const shrinkToMedium = withTiming(
      MEDIUM_STAR_SIZE,
      {
        duration: SHRINK_DURATION * 0.4,
        easing: Easing.linear, // Linear for consistent, clearly visible shrinking
      }
    );

    const shrinkToSmallest = withTiming(
      MIN_STAR_SIZE,
      {
        duration: SHRINK_DURATION * 0.6,
        easing: Easing.linear, // Linear for consistent, clearly visible shrinking
      },
      (finished) => {
        if (finished) {
          runOnJS(() => {
            setIsSmallest(true);
            isSmallestRef.current = true;
          })();
          
          // Hold at smallest for 1 second, then disappear
          const stopTimeout = setTimeout(() => {
            if (roundActiveRef.current && !isSmallestRef.current) {
              // Still not tapped - too late
              runOnJS(handleMiss)();
            }
          }, 1000);
          timeoutRefs.current.push(stopTimeout);
        }
      }
    );

    // Start animation from INITIAL_STAR_SIZE using withSequence
    starSize.value = withSequence(
      withTiming(INITIAL_STAR_SIZE, { duration: 0 }), // Set initial size immediately
      shrinkToMedium,
      shrinkToSmallest
    );

    animationRef.current = { stop: () => {
      starSize.value = withTiming(MIN_STAR_SIZE, { duration: 0 });
    }};
  }, [done, starSize, starOpacity, starScale, starX, starY, feedbackOpacity, handleMiss]);
  
  // Set ref after startRound is defined
  useEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  // Handle star tap
  const handleStarTap = useCallback(async () => {
    if (!roundActiveRef.current || done) return;

    const currentSize = starSize.value;

    // Check if tapped at smallest size
    if (currentSize <= MIN_STAR_SIZE + 10 && isSmallestRef.current) {
      // Perfect! Tapped at smallest
      setLastResult('hit');
      setShowFeedback(true);
      setRoundActive(false);
      roundActiveRef.current = false;
      setScore((s) => s + 1);

      if (animationRef.current) {
        animationRef.current.stop();
      }

      // Success animation
      starScale.value = withSequence(
        withTiming(1.5, { duration: 150, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) })
      );

      starOpacity.value = withTiming(0, { duration: 200 });
      feedbackOpacity.value = withTiming(1, { duration: 200 });

      sparkleX.value = starX.value;
      sparkleY.value = starY.value;
      setSparkleKey((k) => k + 1);

      try {
        await playSuccess();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        speakTTS('Perfect! You waited!', 0.78 );
      } catch {}

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
      // Tapped too early - not at smallest yet
      handleMiss();
    }
  }, [done, starSize, starScale, starOpacity, feedbackOpacity, starX, starY, playSuccess, endGame, startRound, handleMiss]);

  // Start first round
  useEffect(() => {
    startRound();
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
  }, []);

  // Animated styles
  const starAnimatedStyle = useAnimatedStyle(() => {
    return {
      width: starSize.value,
      height: starSize.value,
      opacity: starOpacity.value,
      transform: [{ scale: starScale.value }],
    };
  });

  const starPositionStyle = useAnimatedStyle(() => {
    return {
      left: `${starX.value}%`,
      top: `${starY.value}%`,
      transform: [
        { translateX: -starSize.value / 2 },
        { translateY: -starSize.value / 2 },
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
        speakTTS('Tap when the star is smallest!', 0.78 );
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
          router.replace('/(tabs)/Games');
        }
      } catch (error) {
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
        message="Timing Master!"
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
        <Text style={styles.title}>Tap When Star Is Smallest</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.helper}>
          Wait until the star is smallest, then tap!
        </Text>
      </View>

      {/* Play area */}
      <View style={styles.playArea}>
        {/* Star with Pressable - only taps on star count */}
        <Animated.View
          style={[
            styles.star,
            starAnimatedStyle,
            starPositionStyle,
          ]}
        >
          <Pressable
            onPress={handleStarTap}
            style={styles.starPressable}
            disabled={!roundActive || done}
          >
            <Text style={styles.starText}>⭐</Text>
          </Pressable>
        </Animated.View>

        {/* Feedback */}
        {showFeedback && lastResult && (
          <Animated.View style={[styles.feedbackContainer, feedbackStyle]}>
            <Text style={[
              styles.feedbackText,
              lastResult === 'hit' ? styles.feedbackSuccess : styles.feedbackError,
            ]}>
              {lastResult === 'hit' ? 'Perfect! You waited!' : 'Wait until it\'s smallest!'}
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
  playArea: {
    flex: 1,
    position: 'relative',
    margin: 20,
  },
  star: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  starPressable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  starText: {
    fontSize: 100,
    textAlign: 'center',
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

export default TapWhenStarIsSmallestGame;

