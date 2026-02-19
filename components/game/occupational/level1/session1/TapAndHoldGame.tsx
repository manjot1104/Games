import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { logGameAndAward, recordGame } from '@/utils/api';
import { cleanupSounds, stopAllSpeech } from '@/utils/soundPlayer';
import { Audio as ExpoAudio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { speak as speakTTS, DEFAULT_TTS_RATE, stopTTS } from '@/utils/tts';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';

const SUCCESS_SOUND = 'https://actions.google.com/sounds/v1/cartoon/balloon_pop.ogg';
const HOLD_TARGET_MS = 2000; // 2 seconds
const TOTAL_ROUNDS = 6;
const BUTTON_SIZE = 180;

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
      // Cleanup: Stop speech when component unmounts
      try {
        stopTTS();
      } catch (e) {
        // Ignore errors
      }
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

const TapAndHoldGame: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  const router = useRouter();

  const [round, setRound] = useState(1);
  const [successfulHolds, setSuccessfulHolds] = useState(0);
  const [done, setDone] = useState(false);
  const [finalStats, setFinalStats] = useState<{ correct: number; total: number; xp: number } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [showCongratulations, setShowCongratulations] = useState(false);
  
  // Hold state
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0); // 0 to 1
  const [isComplete, setIsComplete] = useState(false);
  const [roundActive, setRoundActive] = useState(true);

  const holdStartTimeRef = useRef<number | null>(null);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Animations
  const buttonScale = useRef(new Animated.Value(1)).current;
  const buttonGlow = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const playSuccess = useSoundEffect(SUCCESS_SOUND);

  // Initial instruction - only once
  useEffect(() => {
    try {
      speakTTS('Tap and hold the button for 2 seconds. Don\'t let go!', 0.78 );
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Reset round state
  const resetRound = useCallback(() => {
    setIsHolding(false);
    setHoldProgress(0);
    setIsComplete(false);
    setRoundActive(true);
    holdStartTimeRef.current = null;
    progressAnim.setValue(0);
    buttonGlow.setValue(0);
    buttonScale.setValue(1);
    
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, [progressAnim, buttonGlow, buttonScale]);

  // Start hold
  const handlePressIn = () => {
    if (!roundActive || isComplete || done) return;

    setIsHolding(true);
    setRoundActive(false);
    holdStartTimeRef.current = Date.now();

    // Animate button press
    Animated.spring(buttonScale, {
      toValue: 0.95,
      damping: 12,
      stiffness: 200,
      useNativeDriver: true,
    }).start();

    // Start progress animation
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: HOLD_TARGET_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    // Update progress state for visual feedback
    const startTime = Date.now();
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / HOLD_TARGET_MS, 1);
      setHoldProgress(progress);

      if (progress >= 1 && !isComplete) {
        handleHoldComplete();
      }
    }, 16); // ~60fps updates

    // Set timeout for completion
    holdTimerRef.current = setTimeout(() => {
      if (!isComplete) {
        handleHoldComplete();
      }
    }, HOLD_TARGET_MS);
  };

  // Release hold
  const handlePressOut = () => {
    if (!isHolding || isComplete) return;

    // Reset if not complete
    Animated.sequence([
      Animated.spring(buttonScale, {
        toValue: 1,
        damping: 12,
        stiffness: 200,
        useNativeDriver: true,
      }),
    ]).start();

    resetRound();
  };

  // Handle successful 2-second hold
  const handleHoldComplete = async () => {
    if (isComplete) return;

    setIsComplete(true);
    setHoldProgress(1);

    // Stop timers
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }

    // Animate success: glow and scale
    Animated.parallel([
      Animated.timing(buttonGlow, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.spring(buttonScale, {
          toValue: 1.15,
          damping: 8,
          stiffness: 200,
          useNativeDriver: true,
        }),
        Animated.spring(buttonScale, {
          toValue: 1,
          damping: 12,
          stiffness: 200,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // Feedback
    try {
      await playSuccess();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      speakTTS('Great hold!', 0.78 );
    } catch {}

    // Move to next round or finish
    setTimeout(() => {
      const newSuccessCount = successfulHolds + 1;
      setSuccessfulHolds(newSuccessCount);

      if (round >= TOTAL_ROUNDS) {
        endGame(newSuccessCount);
      } else {
        setRound((r) => r + 1);
        setTimeout(() => {
          resetRound();
        }, 800);
      }
    }, 600);
  };

  // End game
  const endGame = useCallback(
    async (finalHolds: number) => {
      const xp = finalHolds * 20; // 20 XP per successful hold
      const total = TOTAL_ROUNDS;
      const accuracy = (finalHolds / total) * 100;

      const stats = { correct: finalHolds, total, xp };
      
      // Set all states together FIRST (like CatchTheBouncingStar)
      setFinalStats(stats);
      setDone(true);
      setShowCongratulations(true);
      
      speakTTS('Amazing work! You completed the game!', 0.78 );

      // Log game in background (don't wait for it)
      try {
        await recordGame(xp);
        const result = await logGameAndAward({
          type: 'tapAndHold' as any,
          correct: finalHolds,
          total,
          accuracy,
          xpAwarded: xp,
          skillTags: ['finger-isolation', 'force-control', 'motor-endurance', 'proprioception'],
        });
        setLogTimestamp(result?.last?.at ?? null);
        router.setParams({ refreshStats: Date.now().toString() });
      } catch (e) {
        console.error('Failed to log tap and hold game:', e);
      }
    },
    [router],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  const handleBack = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    stopAllSpeech();
    cleanupSounds();
    onBack?.();
  }, [onBack]);

  // Congratulations screen FIRST (like CatchTheBouncingStar)
  // This is the ONLY completion screen - no ResultCard needed for OT games
  if (showCongratulations && done && finalStats) {
    return (
      <CongratulationsScreen
        message="Excellent Holding!"
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

  // Progress ring animation handled via transform rotate

  const glowOpacity = buttonGlow.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.8],
  });

  const buttonStyle = {
    transform: [{ scale: buttonScale }],
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#EFF6FF', '#DBEAFE', '#BFDBFE']}
        style={StyleSheet.absoluteFillObject}
      />
      <TouchableOpacity onPress={handleBack} style={styles.backChip}>
        <LinearGradient
          colors={['#1E293B', '#0F172A']}
          style={styles.backChipGradient}
        >
          <Text style={styles.backChipText}>← Back</Text>
        </LinearGradient>
      </TouchableOpacity>

      <View style={styles.headerBlock}>
        <Text style={styles.title}>✨ Tap and Hold ✨</Text>
        <View style={styles.statsRow}>
          <View style={styles.statBadge}>
            <Text style={styles.statLabel}>Round</Text>
            <Text style={styles.statValue}>{round}/{TOTAL_ROUNDS}</Text>
          </View>
          <View style={[styles.statBadge, styles.holdBadge]}>
            <Text style={styles.statLabel}>✨ Holds</Text>
            <Text style={styles.statValue}>{successfulHolds}</Text>
          </View>
        </View>
        <Text style={styles.helper}>
          Tap and hold the button for 2 seconds. Don't let go! 💪
        </Text>
      </View>

      <View style={styles.playArea}>
        <View style={styles.buttonContainer}>
          {/* Progress ring background */}
          <View style={styles.progressRingBg}>
            {/* Background circle */}
            <View
              style={[
                styles.progressRingBgCircle,
                {
                  borderColor: '#E5E7EB',
                  borderWidth: 8,
                },
              ]}
            />
            {/* Progress circle */}
            <Animated.View
              style={[
                styles.progressRingContainer,
                {
                  transform: [{ rotate: '-90deg' }],
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.progressRing,
                  {
                    borderColor: isComplete ? '#22C55E' : '#3B82F6',
                    borderWidth: 8,
                    borderRightColor: 'transparent',
                    borderBottomColor: 'transparent',
                    transform: [
                      {
                        rotate: progressAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0deg', '360deg'],
                        }),
                      },
                    ],
                  },
                ]}
              />
            </Animated.View>
          </View>

          {/* Main button */}
          <Animated.View style={[styles.buttonWrapper, buttonStyle]}>
            <Animated.View
              style={[
                styles.buttonGlow,
                {
                  opacity: glowOpacity,
                  backgroundColor: isComplete ? '#22C55E' : '#3B82F6',
                },
              ]}
            />
            <Pressable
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              style={[
                styles.button,
                {
                  backgroundColor: isComplete
                    ? '#22C55E'
                    : isHolding
                      ? '#60A5FA'
                      : '#3B82F6',
                },
              ]}
              disabled={!roundActive || isComplete}
            >
              <Text style={styles.buttonText}>
                {isComplete ? '✓' : isHolding ? 'Hold!' : 'Tap & Hold'}
              </Text>
              {isHolding && !isComplete && (
                <Text style={styles.progressText}>
                  {Math.round(holdProgress * 100)}%
                </Text>
              )}
            </Pressable>
          </Animated.View>
        </View>
      </View>

      <View style={styles.footerBox}>
        <LinearGradient
          colors={['#FFFFFF', '#EFF6FF']}
          style={styles.footerGradient}
        >
          <Text style={styles.footerMain}>
            Skills: finger isolation • force control • motor endurance • proprioception
          </Text>
          <Text style={styles.footerSub}>
            Important for pencil grasp and feeding skills.
          </Text>
        </LinearGradient>
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
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  backChipGradient: {
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    fontSize: 28,
    fontWeight: '900',
    color: '#1E40AF',
    marginBottom: 12,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
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
  holdBadge: {
    backgroundColor: '#DBEAFE',
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
  subtitle: {
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 6,
  },
  helper: {
    fontSize: 15,
    color: '#1E40AF',
    textAlign: 'center',
    paddingHorizontal: 18,
    fontWeight: '600',
  },
  playArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonContainer: {
    width: BUTTON_SIZE + 40,
    height: BUTTON_SIZE + 40,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  progressRingBg: {
    position: 'absolute',
    width: BUTTON_SIZE + 40,
    height: BUTTON_SIZE + 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressRingBgCircle: {
    width: BUTTON_SIZE + 40,
    height: BUTTON_SIZE + 40,
    borderRadius: (BUTTON_SIZE + 40) / 2,
    position: 'absolute',
  },
  progressRingContainer: {
    width: BUTTON_SIZE + 40,
    height: BUTTON_SIZE + 40,
    position: 'absolute',
  },
  progressRing: {
    width: BUTTON_SIZE + 40,
    height: BUTTON_SIZE + 40,
    borderRadius: (BUTTON_SIZE + 40) / 2,
    position: 'absolute',
  },
  buttonWrapper: {
    position: 'relative',
  },
  buttonGlow: {
    position: 'absolute',
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.6,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  buttonText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  progressText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    opacity: 0.9,
  },
  footerBox: {
    marginBottom: 20,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  footerGradient: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  footerMain: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E40AF',
    textAlign: 'center',
    marginBottom: 6,
  },
  footerSub: {
    fontSize: 13,
    color: '#3B82F6',
    textAlign: 'center',
    fontWeight: '500',
  },
  resultCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    padding: 32,
    alignItems: 'center',
    marginTop: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  resultTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#1E40AF',
    marginBottom: 12,
    textShadowColor: 'rgba(255, 255, 255, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  resultSubtitle: {
    fontSize: 18,
    color: '#64748B',
    marginBottom: 24,
    textAlign: 'center',
    fontWeight: '600',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default TapAndHoldGame;

