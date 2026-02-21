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
const COLOR_SIZE = 100;

type ColorType = 'red' | 'green' | 'blue' | 'yellow' | 'purple';

const COLOR_DATA: Record<ColorType, { emoji: string; color: string; borderColor: string }> = {
  red: { emoji: '🔴', color: '#EF4444', borderColor: '#DC2626' },
  green: { emoji: '🟢', color: '#22C55E', borderColor: '#16A34A' },
  blue: { emoji: '🔵', color: '#3B82F6', borderColor: '#2563EB' },
  yellow: { emoji: '🟡', color: '#FCD34D', borderColor: '#FBBF24' },
  purple: { emoji: '🟣', color: '#A855F7', borderColor: '#9333EA' },
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

const TapColoursInOrderGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const playSuccess = useSoundEffect(SUCCESS_SOUND);
  const playError = useSoundEffect(ERROR_SOUND);

  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [roundActive, setRoundActive] = useState(true);
  const [sequence, setSequence] = useState<ColorType[]>([]);
  const [currentSequenceIndex, setCurrentSequenceIndex] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [showSequence, setShowSequence] = useState(true);
  const [showCongratulations, setShowCongratulations] = useState(false);

  // Animation values for each color
  const redGlow = useSharedValue(0);
  const greenGlow = useSharedValue(0);
  const blueGlow = useSharedValue(0);
  const redScale = useSharedValue(1);
  const greenScale = useSharedValue(1);
  const blueScale = useSharedValue(1);
  const redX = useSharedValue(0);
  const greenX = useSharedValue(0);
  const blueX = useSharedValue(0);
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
          type: 'tapColoursInOrder',
          correct: finalScore,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['sequencing', 'colour-discrimination', 'visual-scanning', 'memory-stability'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap colours in order game:', e);
      }
    },
    [router],
  );

  // Generate random sequence with changing positions
  const generateSequence = useCallback(() => {
    const colors: ColorType[] = ['red', 'green', 'blue'];
    const newSequence: ColorType[] = [];
    for (let i = 0; i < 3; i++) {
      newSequence.push(colors[Math.floor(Math.random() * colors.length)]);
    }
    return newSequence;
  }, []);

  // Function to show sequence animation (can be called anytime)
  const showSequenceAnimation = useCallback((sequenceToShow: ColorType[]) => {
    setShowSequence(true);
    setRoundActive(false);
    
    // Reset all glows and scales
    redGlow.value = 0;
    greenGlow.value = 0;
    blueGlow.value = 0;
    redScale.value = 1;
    greenScale.value = 1;
    blueScale.value = 1;

    // Animate sequence
    let index = 0;
    const showNext = () => {
      if (index >= sequenceToShow.length) {
        setShowSequence(false);
        setRoundActive(true);
        try {
          speakTTS('Watch the color sequence, then tap them in the same order!', { rate: 0.78 });
        } catch {}
        return;
      }

      const color = sequenceToShow[index];
      const glowAnim = color === 'red' ? redGlow : color === 'green' ? greenGlow : blueGlow;
      const scaleAnim = color === 'red' ? redScale : color === 'green' ? greenScale : blueScale;
      
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
      setTimeout(showNext, 1500); // More time between colors to see clearly
    };

    setTimeout(showNext, 500);
  }, [redGlow, greenGlow, blueGlow, redScale, greenScale, blueScale]);

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
  const handleTap = useCallback(async (color: ColorType) => {
    if (!roundActive || done || isShaking || showSequence) return;

    const expectedColor = sequence[currentSequenceIndex];

    if (color === expectedColor) {
      // Correct tap!
      const scaleAnim = color === 'red' ? redScale : color === 'green' ? greenScale : blueScale;
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
          speakTTS('Perfect colors!', 0.78 );
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
      const shakeAnim = color === 'red' ? redX : color === 'green' ? greenX : blueX;
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
  }, [roundActive, done, isShaking, showSequence, currentSequenceIndex, sequence, playSuccess, playError, redScale, greenScale, blueScale, redX, greenX, blueX, endGame, showSequenceAnimation]);

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Animated styles - make sequence VERY visible
  const redStyle = useAnimatedStyle(() => {
    const glowIntensity = redGlow.value;
    return {
      transform: [
        { scale: redScale.value }, // Scale handled separately
        { translateX: redX.value },
      ],
      opacity: 0.2 + (glowIntensity * 0.8), // Very bright when glowing
    };
  });

  const greenStyle = useAnimatedStyle(() => {
    const glowIntensity = greenGlow.value;
    return {
      transform: [
        { scale: greenScale.value }, // Scale handled separately
        { translateX: greenX.value },
      ],
      opacity: 0.2 + (glowIntensity * 0.8), // Very bright when glowing
    };
  });

  const blueStyle = useAnimatedStyle(() => {
    const glowIntensity = blueGlow.value;
    return {
      transform: [
        { scale: blueScale.value }, // Scale handled separately
        { translateX: blueX.value },
      ],
      opacity: 0.2 + (glowIntensity * 0.8), // Very bright when glowing
    };
  });
  
  // Animated border colors for colors during sequence
  const redBorderStyle = useAnimatedStyle(() => {
    const glowIntensity = redGlow.value;
    return {
      borderColor: glowIntensity > 0.5 ? '#FCD34D' : COLOR_DATA.red.borderColor, // Yellow border when glowing
      borderWidth: glowIntensity > 0.5 ? 6 : 2,
    };
  });

  const greenBorderStyle = useAnimatedStyle(() => {
    const glowIntensity = greenGlow.value;
    return {
      borderColor: glowIntensity > 0.5 ? '#FCD34D' : COLOR_DATA.green.borderColor, // Yellow border when glowing
      borderWidth: glowIntensity > 0.5 ? 6 : 2,
    };
  });

  const blueBorderStyle = useAnimatedStyle(() => {
    const glowIntensity = blueGlow.value;
    return {
      borderColor: glowIntensity > 0.5 ? '#FCD34D' : COLOR_DATA.blue.borderColor, // Yellow border when glowing
      borderWidth: glowIntensity > 0.5 ? 6 : 2,
    };
  });

  const sparkleStyle = useAnimatedStyle(() => ({
    left: `${sparkleX.value}%`,
    top: `${sparkleY.value}%`,
  }));

  // Get expected color for highlighting
  const expectedColor = sequence[currentSequenceIndex];

  // Randomize positions each round
  const positions = ['left', 'center', 'right'];
  const shuffledPositions = [...positions].sort(() => Math.random() - 0.5);

  // ---------- Congratulations screen FIRST (like CatchTheBouncingStar) ----------
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Color Master!"
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
        <Text style={styles.title}>Tap Colours In Order</Text>
        <Text style={styles.subtitle}>
          Round {round}/{TOTAL_ROUNDS} • 🎨 Score: {score}
        </Text>
        <Text style={styles.helper}>
          Watch the color sequence, then tap them in the same order!
        </Text>
      </View>

      <View style={styles.playArea}>
        <View style={styles.colorsContainer}>
          {/* Red */}
          <Animated.View style={[styles.colorContainer, redStyle]}>
            <Animated.View
              style={[
                styles.colorCircle,
                {
                  backgroundColor: COLOR_DATA.red.color,
                },
                redBorderStyle,
              ]}
            >
              <Pressable
                onPress={() => handleTap('red')}
                style={styles.colorPressable}
                disabled={!roundActive || done || isShaking || showSequence}
              >
                <Text style={styles.colorEmoji}>{COLOR_DATA.red.emoji}</Text>
              </Pressable>
            </Animated.View>
          </Animated.View>

          {/* Green */}
          <Animated.View style={[styles.colorContainer, greenStyle]}>
            <Animated.View
              style={[
                styles.colorCircle,
                {
                  backgroundColor: COLOR_DATA.green.color,
                },
                greenBorderStyle,
              ]}
            >
              <Pressable
                onPress={() => handleTap('green')}
                style={styles.colorPressable}
                disabled={!roundActive || done || isShaking || showSequence}
              >
                <Text style={styles.colorEmoji}>{COLOR_DATA.green.emoji}</Text>
              </Pressable>
            </Animated.View>
          </Animated.View>

          {/* Blue */}
          <Animated.View style={[styles.colorContainer, blueStyle]}>
            <Animated.View
              style={[
                styles.colorCircle,
                {
                  backgroundColor: COLOR_DATA.blue.color,
                },
                blueBorderStyle,
              ]}
            >
              <Pressable
                onPress={() => handleTap('blue')}
                style={styles.colorPressable}
                disabled={!roundActive || done || isShaking || showSequence}
              >
                <Text style={styles.colorEmoji}>{COLOR_DATA.blue.emoji}</Text>
              </Pressable>
            </Animated.View>
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
          Skills: sequencing + colour discrimination • visual scanning • memory stability
        </Text>
        <Text style={styles.footerSub}>
          Follow the color sequence! Colors change positions each time to increase difficulty.
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
  colorsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    flexWrap: 'wrap',
  },
  colorContainer: {
    margin: 10,
  },
  colorPressable: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorCircle: {
    borderWidth: 2, // Default, will be overridden by animated style
    width: COLOR_SIZE,
    height: COLOR_SIZE,
    borderRadius: COLOR_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  colorEmoji: {
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

export default TapColoursInOrderGame;

