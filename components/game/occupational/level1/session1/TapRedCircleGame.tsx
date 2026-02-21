import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Platform, Pressable, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

type ShapePosition = "left" | "right";

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/coin.ogg';
const ERROR_SOUND = 'https://actions.google.com/sounds/v1/cartoon/slide_whistle_down.ogg';

const useSoundEffect = (uri: string) => {
  const soundRef = useRef<ExpoAudio.Sound | null>(null);

  const ensureSound = useCallback(async () => {
    if (soundRef.current) return;
    try {
      const { sound } = await ExpoAudio.Sound.createAsync({ uri }, { volume: 0.5, shouldPlay: false });
      soundRef.current = sound;
    } catch {
      console.warn('Failed to load sound:', uri);
    }
  }, [uri]);

  useEffect(() => {
    return () => { soundRef.current?.unloadAsync().catch(() => {}); };
  }, []);

  const play = useCallback(async () => {
    try {
      if (Platform.OS === 'web') return;
      await ensureSound();
      if (soundRef.current) await soundRef.current.replayAsync();
    } catch { }
  }, [ensureSound]);

  return play;
};

const TapRedCircleGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();
  const [round, setRound] = useState(1);
  const [stars, setStars] = useState(0);
  const [redPosition, setRedPosition] = useState<ShapePosition>("left");
  const [isDisabled, setIsDisabled] = useState(false);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);

  // Glow animation for red circle
  const glowAnim = useRef(new Animated.Value(0)).current;

  // Shake animation for wrong tap
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const startGlow = useCallback(() => {
    glowAnim.setValue(0);
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [glowAnim]);

  useEffect(() => {
    startGlow();
  }, [round, startGlow]);

  // Initial TTS instruction when game opens
  useEffect(() => {
    let mounted = true;
    
    const initializeGame = async () => {
      try {
        // Wait for TTS to initialize and start speaking
        await speakTTS('Tap the BIG RED CIRCLE. Look! The red circle is glowing. Tap the red circle!', 0.78);
        // Add a small delay to ensure TTS has started speaking
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.warn('TTS initialization error:', error);
      }
    };

    initializeGame();

    return () => {
      mounted = false;
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
    };
  }, []);

  const triggerShake = () => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, {
        toValue: 1,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: -1,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 1,
        duration: 60,
        useNativeDriver: true,
      }),
      Animated.timing(shakeAnim, {
        toValue: 0,
        duration: 60,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const nextRound = async () => {
    // randomize red circle position
    const newPos: ShapePosition = Math.random() > 0.5 ? "left" : "right";
    setRedPosition(newPos);
    setRound((r) => r + 1);
    setIsDisabled(false);
    try {
      // Wait for TTS to complete before allowing next interaction
      await speakTTS('Look! The red circle is glowing. Tap the red circle!', 0.78);
      // Small delay to ensure TTS has started
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.warn('TTS error in nextRound:', error);
    }
  };

  const playSuccessSound = useSoundEffect(SUCCESS_SOUND);
  const playErrorSound = useSoundEffect(ERROR_SOUND);

  const handleTap = async (shape: "red" | "blue") => {
    if (isDisabled) return;
    setIsDisabled(true);

    const isCorrect = shape === "red";

    if (isCorrect) {
      setStars((s) => s + 1);
      playSuccessSound();
      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch { }
    } else {
      triggerShake();
      playErrorSound();
      try { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch { }
    }

    // Check if we've reached round 8 (game end)
    if (round >= 8) {
      const finalCorrect = stars + (isCorrect ? 1 : 0);
      const xp = finalCorrect * 15;
      const stats = { correct: finalCorrect, total: 8, xp };
      
      // Set all states together FIRST (like CatchTheBouncingStar)
      setFinalStats(stats);
      setDone(true);
      setShowCongratulations(true);
      
      // Speak completion message (don't await to avoid blocking)
      speakTTS('Amazing work! You completed the game!', 0.78).catch(() => {});

      // Log game in background (don't wait for it)
      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'tapRedCircle' as any,
          correct: finalCorrect,
          total: 8,
          accuracy: (finalCorrect / 8) * 100,
          xpAwarded: xp,
          skillTags: ['shape-discrimination', 'motor-control', 'attention'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log game:', e);
      }
      return;
    }

    // small delay before next round
    setTimeout(async () => {
      await nextRound();
    }, 500);
  };

  const glowScale = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.1],
  });

  const shakeTranslateX = shakeAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: [-10, 10],
  });

  const renderShape = (type: "red" | "blue") => {
    const isRed = type === "red";
    const isRedTarget = isRed;

    const baseShape = isRed ? (
      <LinearGradient
        colors={['#EF4444', '#DC2626', '#B91C1C']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.shape}
      >
        <View style={styles.shapeInnerGlow} />
      </LinearGradient>
    ) : (
      <LinearGradient
        colors={['#3B82F6', '#2563EB', '#1D4ED8']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.shape}
      />
    );

    const content = isRedTarget ? (
      <Animated.View
        style={[
          styles.glowWrapper,
          {
            transform: [{ scale: glowScale }],
          },
        ]}
      >
        {baseShape}
      </Animated.View>
    ) : (
      baseShape
    );

    return (
      <Pressable
        onPress={() => handleTap(type)}
        style={styles.shapeTouchArea}
      >
        {content}
      </Pressable>
    );
  };

  const leftShape = redPosition === "left" ? renderShape("red") : renderShape("blue");
  const rightShape = redPosition === "right" ? renderShape("red") : renderShape("blue");

  const handleBack = useCallback(() => {
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Cleanup: Stop all sounds and speech when component unmounts
  useEffect(() => {
    return () => {
      stopAllSpeech();
      cleanupSounds();
    };
  }, []);

  // Congratulations screen FIRST (like CatchTheBouncingStar)
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Game Complete!"
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
      <LinearGradient
        colors={['#FEF2F2', '#FEE2E2', '#FECACA']}
        style={StyleSheet.absoluteFillObject}
      />
      <TouchableOpacity
        onPress={handleBack}
        style={styles.backButton}
      >
        <LinearGradient
          colors={['#1E293B', '#0F172A']}
          style={styles.backButtonGradient}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </LinearGradient>
      </TouchableOpacity>

      <View style={styles.headerSection}>
        <Text style={styles.title}>🎯 Tap the BIG RED CIRCLE 🎯</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBadge}>
            <Text style={styles.statLabel}>Round</Text>
            <Text style={styles.statValue}>{round}/8</Text>
          </View>
          <View style={[styles.statBadge, styles.starBadge]}>
            <Text style={styles.statLabel}>⭐ Stars</Text>
            <Text style={styles.statValue}>{stars}</Text>
          </View>
        </View>
      </View>

      <Animated.View
        style={[
          styles.shapesRow,
          { transform: [{ translateX: shakeTranslateX }] },
        ]}
      >
        {leftShape}
        {rightShape}
      </Animated.View>

      <View style={styles.instructionBox}>
        <LinearGradient
          colors={['#FFFFFF', '#FEF2F2']}
          style={styles.instructionGradient}
        >
          <Text style={styles.instructionText}>
            ✨ Look! The red circle is glowing. Tap the red circle! ✨
          </Text>
          <Text style={styles.helperText}>
            Wrong taps will just gently shake the screen – no problem 🙂
          </Text>
        </LinearGradient>
      </View>
    </SafeAreaView>
  );
};

const SHAPE_SIZE = 140;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F0F9FF",
    paddingHorizontal: 16,
    paddingTop: 48,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  backButtonGradient: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  headerSection: {
    alignItems: 'center',
    marginTop: 70,
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: 16,
    color: '#991B1B',
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  starBadge: {
    backgroundColor: '#FEF3C7',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
  },
  shapesRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    flex: 1,
  },
  shapeTouchArea: {
    padding: 12,
  },
  shape: {
    width: SHAPE_SIZE,
    height: SHAPE_SIZE,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: SHAPE_SIZE / 2,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  shapeInnerGlow: {
    width: '50%',
    height: '50%',
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
    shadowColor: '#fff',
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  glowWrapper: {
    shadowColor: "#EF4444",
    shadowOpacity: 1,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 0 },
    elevation: 15,
  },
  instructionBox: {
    marginBottom: 24,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  instructionGradient: {
    padding: 16,
  },
  instructionText: {
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
    color: '#991B1B',
    textAlign: 'center',
  },
  helperText: {
    fontSize: 14,
    color: "#64748B",
    textAlign: 'center',
    fontWeight: '500',
  },
});

export default TapRedCircleGame;
