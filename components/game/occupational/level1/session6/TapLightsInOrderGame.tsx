import { SparkleBurst } from '@/components/game/FX';
import ResultCard from '@/components/game/ResultCard';
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
const SHAPE_SIZE = 100;

type ShapeType = 'circle' | 'square' | 'star';

const SHAPE_EMOJIS: Record<ShapeType, string> = {
  circle: '⭕',
  square: '⬜',
  star: '⭐',
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

const TapLightsInOrderGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [sequence, setSequence] = useState<ShapeType[]>([]);
  const [userSequence, setUserSequence] = useState<ShapeType[]>([]);
  const [isShowingSequence, setIsShowingSequence] = useState(true);
  const [isShaking, setIsShaking] = useState(false);
  const [sequenceLength, setSequenceLength] = useState(2);

  // Animation values
  const circleGlow = useSharedValue(0);
  const squareGlow = useSharedValue(0);
  const starGlow = useSharedValue(0);
  const circleScale = useSharedValue(1);
  const squareScale = useSharedValue(1);
  const starScale = useSharedValue(1);
  const circleX = useSharedValue(0);
  const squareX = useSharedValue(0);
  const starX = useSharedValue(0);
  const sparkleX = useSharedValue(0);
  const sparkleY = useSharedValue(0);

  // End game function (defined before use)
  const endGame = useCallback(
    async (finalScore: number) => {
      const total = TOTAL_ROUNDS;
      const xp = finalScore * 18; // 18 XP per successful sequence
      const accuracy = (finalScore / total) * 100;

      setFinalStats({ correct: finalScore, total, xp });
      setDone(true);
      setRoundActive(false);

      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'tapLightsInOrder',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['visual-memory', 'imitation-of-visual-sequence', 'attention-to-order'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap lights in order game:', e);
      }

      speakTTS('Great memory!', 0.78 );
    },
    [router],
  );

  // Generate random sequence
  const generateSequence = useCallback(() => {
    const shapes: ShapeType[] = ['circle', 'square', 'star'];
    const newSequence: ShapeType[] = [];
    for (let i = 0; i < sequenceLength; i++) {
      newSequence.push(shapes[Math.floor(Math.random() * shapes.length)]);
    }
    return newSequence;
  }, [sequenceLength]);

  // Function to show sequence animation
  const showSequenceAnimation = useCallback((sequenceToShow: ShapeType[]) => {
    setIsShowingSequence(true);
    setRoundActive(false);
    
    // Reset all glows
    circleGlow.value = 0;
    squareGlow.value = 0;
    starGlow.value = 0;
    circleScale.value = 1;
    squareScale.value = 1;
    starScale.value = 1;

    // Animate sequence
    let index = 0;
    const showNext = () => {
      if (index >= sequenceToShow.length) {
        setIsShowingSequence(false);
        setRoundActive(true);
        try {
          speakTTS('Watch the sequence, then tap the shapes in the same order!', { rate: 0.78 });
        } catch {}
        return;
      }

      const shape = sequenceToShow[index];
      const glowAnim = shape === 'circle' ? circleGlow : shape === 'square' ? squareGlow : starGlow;
      const scaleAnim = shape === 'circle' ? circleScale : shape === 'square' ? squareScale : starScale;
      
      // Make it VERY visible: bright glow + big scale pulse
      // First, scale up and glow bright
      scaleAnim.value = withTiming(1.6, { duration: 400, easing: Easing.out(Easing.ease) });
      glowAnim.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) });
      
      // Then scale down and fade out
      setTimeout(() => {
        scaleAnim.value = withTiming(1, { duration: 400, easing: Easing.in(Easing.ease) });
        glowAnim.value = withTiming(0, { duration: 400, easing: Easing.in(Easing.ease) });
      }, 600);

      index++;
      setTimeout(showNext, 1500); // More time between shapes to see clearly
    };

    setTimeout(showNext, 500);
  }, [circleGlow, squareGlow, starGlow, circleScale, squareScale, starScale]);

  // Show sequence animation on round change
  useEffect(() => {
    if (done) return;
    
    // Always show sequence when round changes or on initial load
    const newSequence = generateSequence();
    setSequence(newSequence);
    setUserSequence([]);
    showSequenceAnimation(newSequence);
    
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, [round, sequenceLength, generateSequence, done, showSequenceAnimation]);

  // Handle tap
  const handleTap = useCallback(async (shape: ShapeType) => {
    if (!roundActive || done || isShaking || isShowingSequence) return;

    const newUserSequence = [...userSequence, shape];
    setUserSequence(newUserSequence);

    // Animate tap
    const scaleAnim = shape === 'circle' ? circleScale : shape === 'square' ? squareScale : starScale;
    scaleAnim.value = withSequence(
      withTiming(1.3, { duration: 150, easing: Easing.out(Easing.ease) }),
      withTiming(1, { duration: 150, easing: Easing.in(Easing.ease) }),
    );

    // Check if correct
    const expectedShape = sequence[newUserSequence.length - 1];
    if (shape === expectedShape) {
      // Correct!
      if (newUserSequence.length >= sequence.length) {
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
            // Increase sequence length every 2 rounds
            const newLength = newScore % 2 === 0 && sequenceLength < 3 ? sequenceLength + 1 : sequenceLength;
            setSequenceLength(newLength);
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
          speakTTS('Perfect!', 0.78 );
        } catch {}
      } else {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } catch {}
      }
    } else {
      // Wrong tap - shake!
      setIsShaking(true);
      const shakeAnim = shape === 'circle' ? circleX : shape === 'square' ? squareX : starX;
      shakeAnim.value = withSequence(
        withTiming(-10, { duration: 50 }),
        withTiming(10, { duration: 50 }),
        withTiming(-10, { duration: 50 }),
        withTiming(10, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );

      setUserSequence([]);

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
  }, [roundActive, done, isShaking, isShowingSequence, userSequence, sequence, sequenceLength, playSuccess, playError, circleScale, squareScale, starScale, circleX, squareX, starX, endGame]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles - make sequence VERY visible with bright glow
  const circleStyle = useAnimatedStyle(() => {
    const glowIntensity = circleGlow.value;
    return {
      transform: [
        { scale: circleScale.value }, // Scale is handled separately
        { translateX: circleX.value },
      ],
      opacity: 0.2 + (glowIntensity * 0.8), // Very bright when glowing
    };
  });

  const squareStyle = useAnimatedStyle(() => {
    const glowIntensity = squareGlow.value;
    return {
      transform: [
        { scale: squareScale.value }, // Scale is handled separately
        { translateX: squareX.value },
      ],
      opacity: 0.2 + (glowIntensity * 0.8), // Very bright when glowing
    };
  });

  const starStyle = useAnimatedStyle(() => {
    const glowIntensity = starGlow.value;
    return {
      transform: [
        { scale: starScale.value }, // Scale is handled separately
        { translateX: starX.value },
      ],
      opacity: 0.2 + (glowIntensity * 0.8), // Very bright when glowing
    };
  });
  
  // Animated background colors for shapes during sequence
  const circleBgStyle = useAnimatedStyle(() => {
    const glowIntensity = circleGlow.value;
    return {
      backgroundColor: glowIntensity > 0.5 ? '#FCD34D' : '#3B82F6', // Yellow when glowing
    };
  });

  const squareBgStyle = useAnimatedStyle(() => {
    const glowIntensity = squareGlow.value;
    return {
      backgroundColor: glowIntensity > 0.5 ? '#FCD34D' : '#3B82F6', // Yellow when glowing
    };
  });

  const starBgStyle = useAnimatedStyle(() => {
    const glowIntensity = starGlow.value;
    return {
      backgroundColor: glowIntensity > 0.5 ? '#FCD34D' : '#3B82F6', // Yellow when glowing
    };
  });

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  // Result screen
  if (done && finalStats) {
    const accuracyPct = Math.round((finalStats.correct / finalStats.total) * 100);
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={handleBack} style={styles.backChip}>
          <Text style={styles.backChipText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
        >
          <View style={styles.resultCard}>
            <Text style={{ fontSize: 64, marginBottom: 16 }}>💡</Text>
            <Text style={styles.resultTitle}>Memory master!</Text>
            <Text style={styles.resultSubtitle}>
              You completed {finalStats.correct} sequences out of {finalStats.total}!
            </Text>
            <ResultCard
              correct={finalStats.correct}
              total={finalStats.total}
              xpAwarded={finalStats.xp}
              accuracy={accuracyPct}
              logTimestamp={logTimestamp}
              onPlayAgain={() => {
                setRound(1);
                setScore(0);
                setDone(false);
                setFinalStats(null);
                setLogTimestamp(null);
                setSequenceLength(2);
                setUserSequence([]);
                setRoundActive(true);
                circleGlow.value = 0;
                squareGlow.value = 0;
                starGlow.value = 0;
                circleScale.value = 1;
                squareScale.value = 1;
                starScale.value = 1;
              }}
            />
            <Text style={styles.savedText}>Saved! XP updated ✅</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <Text style={styles.backChipText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>Tap The Lights In Order</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 💡 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Watch the sequence, then tap the shapes in the same order!
        </Text>
      </View>

      <View style={styles.playArea}>
        <View style={styles.shapesContainer}>
          {/* Circle */}
          <Animated.View style={[styles.shapeContainer, circleStyle]}>
            <Animated.View style={[styles.shape, circleBgStyle]}>
              <Pressable
                onPress={() => handleTap('circle')}
                style={styles.shapePressable}
                disabled={!roundActive || done || isShaking || isShowingSequence}
              >
                <Text style={styles.shapeEmoji}>{SHAPE_EMOJIS.circle}</Text>
              </Pressable>
            </Animated.View>
          </Animated.View>

          {/* Square */}
          <Animated.View style={[styles.shapeContainer, squareStyle]}>
            <Animated.View style={[styles.shape, squareBgStyle]}>
              <Pressable
                onPress={() => handleTap('square')}
                style={styles.shapePressable}
                disabled={!roundActive || done || isShaking || isShowingSequence}
              >
                <Text style={styles.shapeEmoji}>{SHAPE_EMOJIS.square}</Text>
              </Pressable>
            </Animated.View>
          </Animated.View>

          {/* Star */}
          <Animated.View style={[styles.shapeContainer, starStyle]}>
            <Animated.View style={[styles.shape, starBgStyle]}>
              <Pressable
                onPress={() => handleTap('star')}
                style={styles.shapePressable}
                disabled={!roundActive || done || isShaking || isShowingSequence}
              >
                <Text style={styles.shapeEmoji}>{SHAPE_EMOJIS.star}</Text>
              </Pressable>
            </Animated.View>
          </Animated.View>
        </View>

        {/* Status indicator */}
        {isShowingSequence && (
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>Watch the sequence! 👀</Text>
          </View>
        )}

        {!isShowingSequence && roundActive && (
          <View style={styles.statusBox}>
            <Text style={styles.statusText}>
              Tap {userSequence.length + 1} of {sequence.length}
            </Text>
          </View>
        )}

        {/* Sparkle burst on success */}
        {score > 0 && !isShaking && !isShowingSequence && (
          <Animated.View style={[styles.sparkleContainer, sparkleStyle]} pointerEvents="none">
            <SparkleBurst />
          </Animated.View>
        )}
      </View>

      <View style={styles.footerBox}>
        <Text style={styles.footerMain}>
          Skills: visual memory • imitation of visual sequence • attention to order
        </Text>
        <Text style={styles.footerSub}>
          Watch and remember! This is a toddler-friendly version of SIMON Says.
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
  shapesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    flexWrap: 'wrap',
  },
  shapeContainer: {
    margin: 10,
  },
  shape: {
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  shapePressable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shapeEmoji: {
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

export default TapLightsInOrderGame;

