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
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withTiming
} from 'react-native-reanimated';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const TOTAL_ROUNDS = 8;
const ARROW_SIZE = 100;

type ArrowDirection = 'up' | 'down' | 'left' | 'right';

const ARROW_EMOJIS: Record<ArrowDirection, string> = {
  up: '⬆️',
  down: '⬇️',
  left: '⬅️',
  right: '➡️',
};

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

const FollowTheArrowsGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [sequence, setSequence] = useState<ArrowDirection[]>([]);
  const [currentSequenceIndex, setCurrentSequenceIndex] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [showSequence, setShowSequence] = useState(true);
  const [showCongratulations, setShowCongratulations] = useState(false);

  // Animation values
  const upGlow = useSharedValue(0);
  const downGlow = useSharedValue(0);
  const leftGlow = useSharedValue(0);
  const rightGlow = useSharedValue(0);
  const upScale = useSharedValue(1);
  const downScale = useSharedValue(1);
  const leftScale = useSharedValue(1);
  const rightScale = useSharedValue(1);
  const upX = useSharedValue(0);
  const downX = useSharedValue(0);
  const leftX = useSharedValue(0);
  const rightX = useSharedValue(0);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  // End game function (defined before use)
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18; // 18 XP per successful sequence
      const accuracy = (finalScore / total) * 100;

      // Set all states together FIRST (like CatchTheBouncingStar)
      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);
      setShowCongratulations(true);
      
      speakTTS('Amazing work! You completed the game!', 0.78);

      // Log game in background (don't wait for it)
      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'followTheArrows',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['early-spatial-sequencing', 'directional-recall', 'writing-directionality'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log follow the arrows game:', e);
      }
    },
    [router],
  );

  // Generate random sequence
  const generateSequence = useCallback(() => {
    const directions: ArrowDirection[] = ['up', 'down', 'left', 'right'];
    const length = 2 + Math.floor(round / 3); // 2-3 arrows
    const newSequence: ArrowDirection[] = [];
    for (let i = 0; i < length; i++) {
      newSequence.push(directions[Math.floor(Math.random() * directions.length)]);
    }
    return newSequence;
  }, [round]);

  // Function to show sequence animation (can be called anytime)
  const showSequenceAnimation = useCallback((sequenceToShow: ArrowDirection[]) => {
    setShowSequence(true);
    setRoundActive(false);
    
    // Reset all glows
    upGlow.value = 0;
    downGlow.value = 0;
    leftGlow.value = 0;
    rightGlow.value = 0;

    // Animate sequence
    let index = 0;
    const showNext = () => {
      if (index >= sequenceToShow.length) {
        setShowSequence(false);
        setRoundActive(true);
        try {
          speakTTS('Watch the arrow sequence, then tap them in the same order!', { rate: 0.78 });
        } catch {}
        return;
      }

      const direction = sequenceToShow[index];
      const glowAnim = direction === 'up' ? upGlow : direction === 'down' ? downGlow : direction === 'left' ? leftGlow : rightGlow;
      
      glowAnim.value = withSequence(
        withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 400, easing: Easing.in(Easing.ease) }),
      );

      index++;
      setTimeout(showNext, 1000);
    };

    setTimeout(showNext, 500);
  }, [upGlow, downGlow, leftGlow, rightGlow]);

  // Show sequence animation on round change
  useEffect(() => {
    if (done) return;
    
    // Always show sequence when round changes or on initial load
    const newSequence = generateSequence();
    setSequence(newSequence);
    setCurrentSequenceIndex(0);
    showSequenceAnimation(newSequence);
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round, generateSequence, done, showSequenceAnimation]);

  // Handle tap
  const handleTap = useCallback(async (direction: ArrowDirection) => {
    if (!roundActive || done || isShaking || showSequence) return;

    const expectedDirection = sequence[currentSequenceIndex];

    if (direction === expectedDirection) {
      // Correct tap!
      const scaleAnim = direction === 'up' ? upScale : direction === 'down' ? downScale : direction === 'left' ? leftScale : rightScale;
      scaleAnim.value = withSequence(
        withTiming(1.3, { duration: 150, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 150, easing: Easing.in(Easing.ease) }),
      );

      const newIndex = currentSequenceIndex + 1;

      if (newIndex >= sequence.length) {
        // Sequence complete!
        sparkleX.value = 50;
        sparkleY.value = 50;

        setScore((s) => {
          const newScore = s + 1;
          if (newScore >= TOTAL_ROUNDS) {
            setTimeout(() => {
              endGame(newScore);
            }, 1000);
          } else {
            setTimeout(() => {
              setRound((r) => r + 1);
              setRoundActive(true);
            }, 1500);
          }
          return newScore;
        });

        try {
          playSuccess();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          speakTTS('Perfect sequence!', 0.78 );
        } catch {}
      } else {
        setCurrentSequenceIndex(newIndex);
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {}
      }
    } else {
      // Wrong tap - shake!
      setIsShaking(true);
      const shakeAnim = direction === 'up' ? upX : direction === 'down' ? downX : direction === 'left' ? leftX : rightX;
      shakeAnim.value = withSequence(
        withTiming(-10, { duration: 50 }),
        withTiming(10, { duration: 50 }),
        withTiming(-10, { duration: 50 }),
        withTiming(10, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );

      // Reset sequence
      setCurrentSequenceIndex(0);

      try {
        playError();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        speakTTS('Watch the sequence again!', 0.78 );
      } catch {}

      // Show sequence again - replay the same sequence
      setIsShaking(false);
      setTimeout(() => {
        showSequenceAnimation(sequence);
      }, 500);
    }
  }, [roundActive, done, isShaking, showSequence, currentSequenceIndex, sequence, playSuccess, playError, upScale, downScale, leftScale, rightScale, upX, downX, leftX, rightX, endGame, showSequenceAnimation]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles
  const upStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: upScale.value + (upGlow.value * 0.3) },
      { translateX: upX.value },
    ],
    opacity: 0.5 + (upGlow.value * 0.5),
  }));

  const downStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: downScale.value + (downGlow.value * 0.3) },
      { translateX: downX.value },
    ],
    opacity: 0.5 + (downGlow.value * 0.5),
  }));

  const leftStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: leftScale.value + (leftGlow.value * 0.3) },
      { translateX: leftX.value },
    ],
    opacity: 0.5 + (leftGlow.value * 0.5),
  }));

  const rightStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: rightScale.value + (rightGlow.value * 0.3) },
      { translateX: rightX.value },
    ],
    opacity: 0.5 + (rightGlow.value * 0.5),
  }));

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  // Get expected direction for highlighting
  const expectedDirection = sequence[currentSequenceIndex];

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Arrow Master!"
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
        <Text style={styles.title}>Follow The Arrows</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • ➡️ Score: {score}
        </Text>
        <Text style={styles.helper}>
          Watch the arrow sequence, then tap them in the same order!
        </Text>
      </View>

      <View style={styles.playArea}>
        <View style={styles.arrowsContainer}>
          {/* Up Arrow */}
          <Animated.View style={[styles.arrowContainer, upStyle]}>
            <Pressable
              onPress={() => handleTap('up')}
              style={[
                styles.arrow,
                {
                  backgroundColor: expectedDirection === 'up' ? '#22C55E' : '#3B82F6',
                  borderColor: expectedDirection === 'up' ? '#16A34A' : '#2563EB',
                  borderWidth: expectedDirection === 'up' ? 4 : 2,
                },
              ]}
              disabled={!roundActive || done || isShaking || showSequence}
            >
              <Text style={styles.arrowEmoji}>{ARROW_EMOJIS.up}</Text>
            </Pressable>
          </Animated.View>

          {/* Left and Right Arrows */}
          <View style={styles.horizontalArrows}>
            <Animated.View style={[styles.arrowContainer, leftStyle]}>
              <Pressable
                onPress={() => handleTap('left')}
                style={[
                  styles.arrow,
                  {
                    backgroundColor: expectedDirection === 'left' ? '#22C55E' : '#3B82F6',
                    borderColor: expectedDirection === 'left' ? '#16A34A' : '#2563EB',
                    borderWidth: expectedDirection === 'left' ? 4 : 2,
                  },
                ]}
                disabled={!roundActive || done || isShaking || showSequence}
              >
                <Text style={styles.arrowEmoji}>{ARROW_EMOJIS.left}</Text>
              </Pressable>
            </Animated.View>

            <Animated.View style={[styles.arrowContainer, rightStyle]}>
              <Pressable
                onPress={() => handleTap('right')}
                style={[
                  styles.arrow,
                  {
                    backgroundColor: expectedDirection === 'right' ? '#22C55E' : '#3B82F6',
                    borderColor: expectedDirection === 'right' ? '#16A34A' : '#2563EB',
                    borderWidth: expectedDirection === 'right' ? 4 : 2,
                  },
                ]}
                disabled={!roundActive || done || isShaking || showSequence}
              >
                <Text style={styles.arrowEmoji}>{ARROW_EMOJIS.right}</Text>
              </Pressable>
            </Animated.View>
          </View>

          {/* Down Arrow */}
          <Animated.View style={[styles.arrowContainer, downStyle]}>
            <Pressable
              onPress={() => handleTap('down')}
              style={[
                styles.arrow,
                {
                  backgroundColor: expectedDirection === 'down' ? '#22C55E' : '#3B82F6',
                  borderColor: expectedDirection === 'down' ? '#16A34A' : '#2563EB',
                  borderWidth: expectedDirection === 'down' ? 4 : 2,
                },
              ]}
              disabled={!roundActive || done || isShaking || showSequence}
            >
              <Text style={styles.arrowEmoji}>{ARROW_EMOJIS.down}</Text>
            </Pressable>
          </Animated.View>
        </View>

        {/* Status indicator */}
        {showSequence && (
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>Watch the sequence! 👀</Text>
          </View>
        )}

        {!showSequence && roundActive && (
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>
              Tap {currentSequenceIndex + 1} of {sequence.length}
            </Text>
          </View>
        )}

        {/* Sparkle burst on success */}
        {score > 0 && !isShaking && !showSequence && (
          <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
            <SparkleBurst />
          </Animated.View>
        )}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: early spatial sequencing • directional recall • prepares for writing directionality
        </Text>
        <Text style={styles.footerSub}>
          Follow the arrow directions! This prepares children for writing directionality.
        </Text>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backChip: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  backChipText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerBlock: {
    marginTop: 72,
    marginBottom: 16,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    position: 'relative',
  },
  arrowsContainer: {
    alignItems: 'center',
    gap: 20,
  },
  horizontalArrows: {
    flexDirection: 'row',
    gap: 40,
  },
  arrowContainer: {
    margin: 5,
  },
  arrow: {
    width: ARROW_SIZE,
    height: ARROW_SIZE,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  arrowEmoji: {
    fontSize: 60,
  },
  statusBox: {
    marginTop: 40,
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  statusText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  sparkleContainer: {
    position: 'absolute',
    transform: [{ translateX: -20 }, { translateY: -20 }],
    zIndex: 4,
  },
  footerBox: {
    paddingVertical: 14,
    marginBottom: 20,
  },
  footerMain: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  footerSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  resultTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
  },
  resultSubtitle: {
    fontSize: 16,
    color: '#475569',
    marginBottom: 16,
    textAlign: 'center',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default FollowTheArrowsGame;

