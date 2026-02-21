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
const INITIAL_SIZE = 80;
const MIN_SIZE = 30;
const SHRINK_DURATION = 6000; // 6 seconds to shrink - slow and visible
const MOVE_DURATION = 7000; // 7 seconds to move across screen
const MOVE_SPEED = 50; // pixels per second

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

const ShrinkingObjectMovementGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
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
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [playAreaLayout, setPlayAreaLayout] = useState<{ width: number; height: number; x: number; y: number } | null>(null);

  // Animation values
  const objectSize = useSharedValue(INITIAL_SIZE);
  const objectX = useSharedValue(0); // Pixels from left
  const objectY = useSharedValue(0); // Pixels from top
  const objectScale = useSharedValue(1);
  const objectOpacity = useSharedValue(1);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);
  const feedbackOpacity = useSharedValue(0);

  const animationRef = useRef<any>(null);
  const roundActiveRef = useRef(false);
  const roundRef = useRef(1);
  const scoreRef = useRef(0);
  const objectXRef = useRef(0);
  const objectYRef = useRef(0);
  const timeoutRefs = useRef<NodeJS.Timeout[]>([]);

  // Keep refs in sync
  useEffect(() => {
    roundRef.current = round;
    scoreRef.current = score;
  }, [round, score]);

  // Handle play area layout
  const handlePlayAreaLayout = useCallback((event: any) => {
    const { width, height, x, y } = event.nativeEvent.layout;
    setPlayAreaLayout({ width, height, x, y });
  }, []);

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
        type: 'shrinkingObjectMovement',
        score: finalScore,
        totalRounds,
        correct: finalScore,
        incorrect: totalRounds - finalScore,
      });

      await logGameAndAward({
        gameType: 'shrinkingObjectMovement',
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

  // Handle miss
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
    objectScale.value = withSequence(
      withTiming(0.9, { duration: 100, easing: Easing.out(Easing.ease) }),
      withTiming(1, { duration: 100, easing: Easing.in(Easing.ease) })
    );

    feedbackOpacity.value = withTiming(1, { duration: 200 });

    try {
      await playError();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speakTTS('Try again!', 0.78 );
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
  }, [done, objectScale, feedbackOpacity, playError]);

  // Start a new round
  const startRound = useCallback(() => {
    if (done || !playAreaLayout) return;

    setRoundActive(true);
    roundActiveRef.current = true;
    setLastResult(null);
    setShowFeedback(false);
    feedbackOpacity.value = 0;

    // Random starting position (left side) - use pixels
    // Start slightly off-screen on the left
    const startX = -INITIAL_SIZE / 2;
    const startYPercent = 20 + Math.random() * 60; // 20% to 80% vertically
    const startY = (startYPercent / 100) * playAreaLayout.height;

    // Random end position (right side) - use pixels
    // End slightly off-screen on the right
    const endX = playAreaLayout.width + INITIAL_SIZE / 2;
    const endYPercent = 20 + Math.random() * 60;
    const endY = (endYPercent / 100) * playAreaLayout.height;

    objectX.value = startX;
    objectY.value = startY; // Store as pixels, not percentage
    objectXRef.current = startX;
    objectYRef.current = startY;

    // Reset object first
    objectSize.value = INITIAL_SIZE;
    objectOpacity.value = 1;
    objectScale.value = 1;

    // Calculate movement distance and duration
    const distance = Math.sqrt(
      Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2)
    );
    const moveDuration = (distance / MOVE_SPEED) * 1000; // Convert to ms

    // Move animation - animate X and Y separately
    const moveXAnim = withTiming(
      endX,
      {
        duration: moveDuration,
        easing: Easing.linear,
      },
      (finished) => {
        if (finished && roundActiveRef.current) {
          // Object moved off screen - too late
          runOnJS(handleMiss)();
        }
      }
    );

    const moveYAnim = withTiming(
      endY,
      {
        duration: moveDuration,
        easing: Easing.linear,
      }
    );

    objectX.value = moveXAnim;
    objectY.value = moveYAnim;

    // Shrink animation (simultaneous with movement) - slow and visible
    // Use linear easing for consistent, clearly visible shrinking
    const shrinkAnim = withTiming(
      MIN_SIZE,
      {
        duration: SHRINK_DURATION,
        easing: Easing.linear, // Linear for consistent, clearly visible shrinking
      }
    );

    objectSize.value = shrinkAnim;

    // Update position refs initially
    objectXRef.current = startX;
    objectYRef.current = startY;

    animationRef.current = {
      stop: () => {
        objectSize.value = withTiming(MIN_SIZE, { duration: 0 });
        objectX.value = withTiming(endX, { duration: 0 });
        objectY.value = withTiming(endY, { duration: 0 });
      },
    };
  }, [done, playAreaLayout, objectSize, objectX, objectY, objectOpacity, objectScale, feedbackOpacity, handleMiss]);

  // Handle object tap
  const handleObjectTap = useCallback(async (event: any) => {
    if (!roundActiveRef.current || done || !playAreaLayout) return;

    const { locationX, locationY } = event.nativeEvent;
    
    // Get current object position and size from shared values
    // These are reactive and will have the current animated values
    const currentX = objectX.value;
    const currentY = objectY.value;
    const currentSize = objectSize.value;

    // Object center position relative to play area (object is positioned at center via translate)
    const objectCenterX = currentX;
    const objectCenterY = currentY;

    // Check if tap is near object center
    const tapDistance = Math.sqrt(
      Math.pow(locationX - objectCenterX, 2) + Math.pow(locationY - objectCenterY, 2)
    );
    // More forgiving threshold - especially when object is small
    // When object is smallest (30px), threshold will be at least 70px for easier tapping
    const tapThreshold = Math.max(currentSize / 2 + 55, 70);
    
    // Check if object is at smallest size (within tolerance)
    // Allow tolerance for animation timing - user should tap when object is smallest
    // Increased tolerance to 30px to account for animation timing and visual perception
    const isAtSmallestSize = currentSize <= MIN_SIZE + 30;

    if (tapDistance <= tapThreshold && isAtSmallestSize) {
      // Hit! - Only count if tapped on object AND object is at smallest size
      setLastResult('hit');
      setShowFeedback(true);
      setRoundActive(false);
      roundActiveRef.current = false;
      setScore((s) => s + 1);

      if (animationRef.current) {
        animationRef.current.stop();
      }

      // Success animation
      objectScale.value = withSequence(
        withTiming(1.5, { duration: 150, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 200, easing: Easing.in(Easing.ease) })
      );

      objectOpacity.value = withTiming(0, { duration: 200 });
      feedbackOpacity.value = withTiming(1, { duration: 200 });

      sparkleX.value = objectCenterX;
      sparkleY.value = objectCenterY;
      setSparkleKey((k) => k + 1);

      try {
        await playSuccess();
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        speakTTS('Perfect timing!', 0.78 );
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
      // Miss - either tap was outside object OR object wasn't at smallest size yet
      if (tapDistance <= tapThreshold && !isAtSmallestSize) {
        // Tap was on object but too early - give specific feedback
        try {
          speakTTS('Wait until it is smallest!', 0.78);
        } catch {}
      }
      handleMiss();
    }
  }, [done, playAreaLayout, objectSize, objectScale, objectOpacity, feedbackOpacity, sparkleX, sparkleY, playSuccess, endGame, startRound, handleMiss]);

  // Set ref after startRound is defined
  useEffect(() => {
    startRoundRef.current = startRound;
  }, [startRound]);

  // Start first round when layout is ready
  useEffect(() => {
    if (playAreaLayout && playAreaLayout.width > 0 && playAreaLayout.height > 0) {
      // Small delay to ensure layout is fully ready
      const timer = setTimeout(() => {
        startRound();
      }, 100);
      timeoutRefs.current.push(timer);
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
  }, [playAreaLayout, startRound]);

  // Animated styles
  const objectAnimatedStyle = useAnimatedStyle(() => {
    'worklet';
    const size = objectSize.value;
    return {
      width: size,
      height: size,
      left: objectX.value,
      top: objectY.value,
      transform: [
        { translateX: -size / 2 },
        { translateY: -size / 2 },
        { scale: objectScale.value },
      ],
      opacity: objectOpacity.value,
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
        speakTTS('Tap the moving object as it shrinks!', 0.78 );
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
        message="Dynamic Targeting Master!"
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
        <Text style={styles.title}>Shrinking Object + Movement</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • Score: {score}
        </Text>
        <Text style={styles.helper}>
          Track the moving object as it shrinks and tap it!
        </Text>
      </View>

      {/* Play area */}
      <Pressable
        onPress={handleObjectTap}
        onLayout={handlePlayAreaLayout}
        style={styles.playArea}
        disabled={!roundActive || done}
      >
        <Animated.View
          style={[
            styles.object,
            objectAnimatedStyle,
          ]}
        >
          <Text style={styles.objectEmoji}>🐝</Text>
        </Animated.View>

        {/* Feedback */}
        {showFeedback && lastResult && (
          <Animated.View style={[styles.feedbackContainer, feedbackStyle]}>
            <Text style={[
              styles.feedbackText,
              lastResult === 'hit' ? styles.feedbackSuccess : styles.feedbackError,
            ]}>
              {lastResult === 'hit' ? 'Perfect timing!' : 'Try again!'}
            </Text>
          </Animated.View>
        )}

        {/* Sparkle effect */}
        {sparkleKey > 0 && playAreaLayout && (
          <SparkleBurst
            key={sparkleKey}
            x={sparkleX.value}
            y={sparkleY.value}
          />
        )}
      </Pressable>
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
    overflow: 'visible', // Allow object to be visible even when slightly off-screen
  },
  object: {
    position: 'absolute',
    backgroundColor: '#FCD34D',
    borderRadius: 1000,
    borderWidth: 3,
    borderColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10, // Ensure object is above other elements
  },
  objectEmoji: {
    fontSize: 40,
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

export default ShrinkingObjectMovementGame;

