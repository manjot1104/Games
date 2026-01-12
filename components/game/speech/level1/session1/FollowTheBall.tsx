import { CameraConsent } from '@/components/game/CameraConsent';
import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import { EyeTrackingCamera } from '@/components/game/EyeTrackingCamera';
import { ResultToast, SparkleBurst } from '@/components/game/FX';
import { GazeVisualization } from '@/components/game/GazeVisualization';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { advanceTherapyProgress, logGameAndAward } from '@/utils/api';
import { BallPosition, EyeTrackingResult, isEyeTrackingAvailable } from '@/utils/eyeTracking';
import { stopAllSpeech } from '@/utils/soundPlayer';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedReaction,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

// Will use useWindowDimensions hook inside component for responsive sizing

const DEFAULT_TTS_RATE = 0.75;
let scheduledSpeechTimers: ReturnType<typeof setTimeout>[] = [];
let webSpeechSynthesis: SpeechSynthesis | null = null;
let webUtterance: SpeechSynthesisUtterance | null = null;
let webTTSActivated = false; // Track if TTS has been activated by user interaction

// Initialize web speech synthesis
if (Platform.OS === 'web' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
  webSpeechSynthesis = window.speechSynthesis;
}

// Wake up speech synthesis on web (required for browser autoplay policy)
function activateWebTTS(callback?: () => void) {
  if (Platform.OS === 'web' && webSpeechSynthesis) {
    if (!webTTSActivated) {
      try {
        // Speak a silent utterance to activate TTS (browser requires user interaction)
        const silentUtterance = new SpeechSynthesisUtterance('');
        silentUtterance.volume = 0;
        silentUtterance.onend = () => {
          webTTSActivated = true;
          if (callback) callback();
        };
        webSpeechSynthesis.speak(silentUtterance);
      } catch (e) {
        console.warn('Failed to activate web TTS:', e);
        webTTSActivated = true; // Mark as activated even if it fails
        if (callback) callback();
      }
    } else {
      // Already activated, call callback immediately
      if (callback) callback();
    }
  } else {
    // Not web, call callback immediately
    if (callback) callback();
  }
}

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    if (Platform.OS === 'web' && webSpeechSynthesis) {
      webSpeechSynthesis.cancel();
      webUtterance = null;
    } else {
      Speech.stop();
    }
  } catch { }
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    
    if (Platform.OS === 'web' && webSpeechSynthesis) {
      // If TTS is not activated yet, activate it first then speak
      if (!webTTSActivated) {
        activateWebTTS(() => {
          // TTS is now activated, speak the text
          if (webSpeechSynthesis) {
            webUtterance = new SpeechSynthesisUtterance(text);
            webUtterance.rate = Math.max(0.5, Math.min(2, rate * 1.33));
            webUtterance.pitch = 1;
            webUtterance.volume = 1;
            webUtterance.onerror = (e) => {
              console.warn('Web TTS error:', e);
            };
            webSpeechSynthesis.speak(webUtterance);
          }
        });
      } else {
        // TTS is already activated, speak directly
        webUtterance = new SpeechSynthesisUtterance(text);
        // Convert rate: expo-speech uses 0-1, browser uses 0.1-10, default 1
        // Map 0.75 (default) to ~0.75, scale appropriately
        webUtterance.rate = Math.max(0.5, Math.min(2, rate * 1.33)); // Scale to browser range
        webUtterance.pitch = 1;
        webUtterance.volume = 1;
        
        webUtterance.onerror = (e) => {
          console.warn('Web TTS error:', e);
        };
        
        webSpeechSynthesis.speak(webUtterance);
      }
    } else {
      // Use expo-speech for native platforms
      Speech.speak(text, { rate });
    }
  } catch (e) {
    console.warn('speak error', e);
  }
}

type Phase = 'moving' | 'glow' | 'feedback';

type Direction = 'leftToRight' | 'rightToLeft' | 'upToDown' | 'downToUp';

interface RoundResult {
  reactionTimeMs: number | null;
  tappedWhileMoving: boolean;
  timedOut: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

interface FollowTheBallProps {
  onBack: () => void;
  onComplete?: () => void;
  therapyId?: string;
  levelNumber?: number;
  sessionNumber?: number;
  gameId?: string; // e.g., 'game-1'
}

export const FollowTheBall: React.FC<FollowTheBallProps> = ({
  onBack,
  onComplete,
  therapyId,
  levelNumber,
  sessionNumber,
  gameId = 'game-1',
}) => {
  const router = useRouter();
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  
  // Ball size in pixels
  const BALL_SIZE = 80;
  const BALL_HALF = BALL_SIZE / 2; // 40px
  
  // Calculate safe boundaries (accounting for ball size and transform)
  // Ball is positioned using left/top percentages, then translated by -40px
  // So if left is X%, the actual left edge is at X% - 40px
  // We need: X% - 40px >= 0 and X% + 40px <= 100%
  // Convert 40px to percentage: (40 / SCREEN_WIDTH) * 100
  // Use a safety margin of 50px (more than ball half) to ensure full visibility
  const SAFETY_MARGIN = 50;
  const BALL_OFFSET_PCT_X = (SAFETY_MARGIN / SCREEN_WIDTH) * 100;
  const BALL_OFFSET_PCT_Y = (SAFETY_MARGIN / SCREEN_HEIGHT) * 100;
  
  // Clamp to reasonable bounds (at least 10% margin, at most 90% to ensure visibility)
  const MIN_X = Math.max(10, BALL_OFFSET_PCT_X);
  const MAX_X = Math.min(90, 100 - BALL_OFFSET_PCT_X);
  const MIN_Y = Math.max(10, BALL_OFFSET_PCT_Y);
  const MAX_Y = Math.min(90, 100 - BALL_OFFSET_PCT_Y);
  const [phase, setPhase] = useState<Phase>('moving');
  const [direction, setDirection] = useState<Direction>('leftToRight');
  const [attentionScore, setAttentionScore] = useState(50); // 0–100
  const [round, setRound] = useState(1);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    successfulRounds: number;
    avgReactionTime: number;
    tappedWhileMovingCount: number;
    timedOutCount: number;
    finalAttentionScore: number;
    avgGazeScore?: number;
    gazeSamples?: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);

  const tappedWhileMovingRef = useRef(false);
  const glowStartTimeRef = useRef<number | null>(null);
  const roundTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const roundResultsRef = useRef<RoundResult[]>([]);

  const TOTAL_ROUNDS = 8; // 8 rounds per game

  // Animation values
  const ballScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0);
  const ballX = useSharedValue(10);
  const ballY = useSharedValue(50);
  const ballPosRef = useRef({ x: 10, y: 50 });
  const attentionBarWidth = useSharedValue(50);
  const [sparkleKey, setSparkleKey] = useState(0);
  const [feedbackToast, setFeedbackToast] = useState<'success' | 'early' | 'timeout' | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  // Eye tracking state
  const [eyeTrackingEnabled, setEyeTrackingEnabled] = useState(false);
  const [showCameraConsent, setShowCameraConsent] = useState(false);
  const [eyeTrackingInitError, setEyeTrackingInitError] = useState<string | null>(null);
  const [gazeData, setGazeData] = useState<EyeTrackingResult | null>(null);
  const [gazeScore, setGazeScore] = useState(0); // 0-100 based on gaze-ball alignment
  const [gazeHistory, setGazeHistory] = useState<EyeTrackingResult[]>([]);
  const [showGazeVisualization, setShowGazeVisualization] = useState(false);
  const [practiceMode, setPracticeMode] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(false);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const [showStartOverlay, setShowStartOverlay] = useState(true);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);

  const ballAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ballScale.value }],
    left: `${ballX.value}%`,
    top: `${ballY.value}%`,
  }));

  const glowAnimatedStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const attentionBarStyle = useAnimatedStyle(() => ({
    width: `${attentionBarWidth.value}%`,
  }));

  // Update attention bar animation when score changes
  useEffect(() => {
    attentionBarWidth.value = withSpring(attentionScore, {
      damping: 15,
      stiffness: 100,
    });
  }, [attentionScore]);

  useAnimatedReaction(
    () => ({ x: ballX.value, y: ballY.value }),
    (pos) => {
      runOnJS(() => {
        ballPosRef.current = pos;
      })();
    }
  );

  const speakIfEnabled = (msg: string) => {
    if (soundOn) speak(msg, DEFAULT_TTS_RATE);
  };

  // Pick next direction randomly
  const pickNextDirection = (): Direction => {
    const dirs: Direction[] = ['leftToRight', 'rightToLeft', 'upToDown', 'downToUp'];
    return dirs[Math.floor(Math.random() * dirs.length)];
  };

  // Start a new round
  const startRound = (roundNumber?: number) => {
    const activeRound = roundNumber ?? round;
    if (isPaused || showStartOverlay) return; // Don't start if overlay is showing
    setPhase('moving');
    setFeedbackToast(null);
    setShowFeedback(false);
    tappedWhileMovingRef.current = false;
    glowStartTimeRef.current = null;
    glowOpacity.value = 0;
    ballScale.value = 1;

    const dir = pickNextDirection();
    setDirection(dir);

    // TTS: Announce new round
    if (activeRound === 1) {
      // Initial welcome message is handled by start overlay
      // Don't repeat it here
    } else {
      speakIfEnabled(`Round ${activeRound}. Watch the ball!`);
    }

    // Set starting position by direction (using safe boundaries)
    switch (dir) {
      case 'leftToRight':
        ballX.value = MIN_X;
        ballY.value = 50;
        break;
      case 'rightToLeft':
        ballX.value = MAX_X;
        ballY.value = 50;
        break;
      case 'upToDown':
        ballX.value = 50;
        ballY.value = MIN_Y;
        break;
      case 'downToUp':
        ballX.value = 50;
        ballY.value = MAX_Y;
        break;
    }

    // Animate the movement
    startMovement(dir);
  };

  const startMovement = (dir: Direction) => {
    const baseDuration = 3000;
    const speedFactor = 0.9 ** (round - 1); // slightly faster each round
    const durationMs = Math.max(1500, baseDuration * speedFactor);

    let targetX = ballX.value;
    let targetY = ballY.value;

    if (dir === 'leftToRight') {
      targetX = MAX_X;
      targetY = 50;
    } else if (dir === 'rightToLeft') {
      targetX = MIN_X;
      targetY = 50;
    } else if (dir === 'upToDown') {
      targetX = 50;
      targetY = MAX_Y;
    } else if (dir === 'downToUp') {
      targetX = 50;
      targetY = MIN_Y;
    }

    ballX.value = withTiming(targetX, { duration: durationMs, easing: Easing.inOut(Easing.ease) });
    ballY.value = withTiming(targetY, { duration: durationMs, easing: Easing.inOut(Easing.ease) });

    setTimeout(() => {
      if (isPaused) return;
      setPhase('glow');
      glowStartTimeRef.current = performance.now();
      if (hapticsOn) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      speakIfEnabled('Tap the ball now!');

      glowOpacity.value = withRepeat(
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      ballScale.value = withRepeat(
        withSpring(1.25, { damping: 8, stiffness: 200 }),
        -1,
        true
      );

      if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);
      roundTimeoutRef.current = (setTimeout(() => {
        setFeedbackToast('timeout');
        setShowFeedback(true);
        speakIfEnabled('Time is up. Let\'s try the next one!');
        setTimeout(() => setShowFeedback(false), 2000);
        handleRoundEnd({
          reactionTimeMs: null,
          tappedWhileMoving: tappedWhileMovingRef.current,
          timedOut: true,
        });
      }, 3500)) as unknown as NodeJS.Timeout;
    }, durationMs);
  };

  // Handle start overlay tap - activate TTS and start game
  const handleStartTap = () => {
    if (!userInteracted) {
      setUserInteracted(true);
      setShowStartOverlay(false);
      
      // Activate TTS first, then play welcome message and start round
      activateWebTTS(() => {
        // TTS is now activated, wait a bit then play welcome message
        setTimeout(() => {
          // Use direct speak to ensure it plays (soundOn check is in speakIfEnabled)
          if (soundOn) {
            speak('Welcome! Watch the ball with your eyes. When it glows, tap it!', DEFAULT_TTS_RATE);
          }
          // Start the first round after TTS starts playing
          setTimeout(() => {
            startRound(1);
          }, 1000);
        }, 100);
      });
    }
  };

  // Handle tap on ball
  const handleBallTap = () => {
    
    if (phase === 'moving') {
      // Tapped too early
      tappedWhileMovingRef.current = true;
      setFeedbackToast('early');
      setShowFeedback(true);
      speakIfEnabled('Wait for the ball to glow!');
      setTimeout(() => setShowFeedback(false), 1500);
      return;
    }

    if (phase === 'glow') {
      const now = performance.now();
      const rt = glowStartTimeRef.current != null ? now - glowStartTimeRef.current : null;

      if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);

      // Stop glow animations
      glowOpacity.value = withTiming(0, { duration: 200 });
      ballScale.value = withSpring(1, { damping: 12 });

      // Positive feedback based on reaction time
      if (rt && rt <= 800) {
        speakIfEnabled('Super fast! Great job!');
      } else if (rt && rt <= 1500) {
        speakIfEnabled('Good! Well done!');
      } else {
        speakIfEnabled('Nice!');
      }

      setFeedbackToast('success');
      setShowFeedback(true);
      
      // Show success animation instead of TTS
      setShowRoundSuccess(true);

      handleRoundEnd({
        reactionTimeMs: rt,
        tappedWhileMoving: tappedWhileMovingRef.current,
        timedOut: false,
      });
    }
  };

  // Handle gaze detection from camera
  const handleGazeDetected = (result: EyeTrackingResult) => {
    setGazeData(result);
    
    // Update gaze history
    setGazeHistory((prev) => {
      const newHistory = [...prev, result].slice(-100); // Keep last 100 samples
      return newHistory;
    });

    // Update gaze score if ball position is available
    if (result.attentionScore > 0) {
      setGazeScore((prev) => {
        // Smooth the gaze score with exponential moving average
        return prev * 0.7 + result.attentionScore * 0.3;
      });
    }
  };

  // Calculate combined attention score
  const calculateCombinedAttentionScore = (behavioralScore: number, gazeScoreValue: number): number => {
    if (!eyeTrackingEnabled || gazeScoreValue === 0) {
      return behavioralScore; // Fallback to behavioral only
    }
    // Combine: 60% behavioral, 40% gaze-based
    return (behavioralScore * 0.6) + (gazeScoreValue * 0.4);
  };

  const updateAttention = (result: RoundResult) => {
    let delta = 0;

    if (result.tappedWhileMoving) {
      delta -= 6; // impulsive / random tapping
    }

    if (result.timedOut) {
      delta -= 8; // didn't respond
    } else if (result.reactionTimeMs != null) {
      const rt = result.reactionTimeMs;
      if (rt <= 800) delta += 10; // super fast
      else if (rt <= 1500) delta += 6; // good
      else if (rt <= 2500) delta += 3; // okay
      else delta -= 2; // very slow
    }

    // Small bonus for completing a round at all
    delta += 1;

    setAttentionScore((prev) => {
      const newBehavioralScore = clamp(prev + delta, 0, 100);
      // Combine with gaze score
      return calculateCombinedAttentionScore(newBehavioralScore, gazeScore);
    });
  };

  const handleRoundEnd = (result: RoundResult) => {
    setPhase('feedback');
    updateAttention(result);
    roundResultsRef.current.push(result);

    // Show sparkle animation on success
    if (!result.timedOut && !result.tappedWhileMoving) {
      setSparkleKey(Date.now());
    }

    // Show feedback briefly then start next round or finish game
    setTimeout(() => {
      setShowFeedback(false);
      setShowRoundSuccess(false);
      if (round >= TOTAL_ROUNDS) {
        finishGame();
      } else {
        setRound((r) => {
          const next = r + 1;
          startRound(next);
          return next;
        });
      }
    }, result.timedOut ? 2000 : 2500);
  };

  const finishGame = async () => {
    const results = roundResultsRef.current;
    const successfulRounds = results.filter(
      (r) => !r.timedOut && !r.tappedWhileMoving && r.reactionTimeMs != null
    ).length;
    const reactionTimes = results
      .filter((r) => r.reactionTimeMs != null)
      .map((r) => r.reactionTimeMs!);
    const avgReactionTime =
      reactionTimes.length > 0
        ? reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length
        : 0;
    const tappedWhileMovingCount = results.filter((r) => r.tappedWhileMoving).length;
    const timedOutCount = results.filter((r) => r.timedOut).length;

    // Calculate average gaze score for this game
    const avgGazeScore = gazeHistory.length > 0
      ? gazeHistory.reduce((sum, r) => sum + (r.attentionScore || 0), 0) / gazeHistory.length
      : 0;

    const stats = {
      totalRounds: TOTAL_ROUNDS,
      successfulRounds,
      avgReactionTime: Math.round(avgReactionTime),
      tappedWhileMovingCount,
      timedOutCount,
      finalAttentionScore: attentionScore,
      avgGazeScore: Math.round(avgGazeScore),
      gazeSamples: gazeHistory.length,
    };

    console.log('🎮 FollowTheBall: finishGame called', { stats });
    
    // Set all states first to trigger congratulations screen
    setFinalStats(stats);
    setGameFinished(true);
    setShowCongratulations(true);
    
    console.log('🎮 FollowTheBall: States set', { 
      gameFinished: true, 
      showCongratulations: true, 
      hasFinalStats: !!stats 
    });

    // TTS: Celebrate completion
    if (successfulRounds >= TOTAL_ROUNDS * 0.8) {
      speakIfEnabled('Amazing! You did great!');
    } else if (successfulRounds >= TOTAL_ROUNDS * 0.5) {
      speakIfEnabled('Good job! You completed the game!');
    } else {
      speakIfEnabled('Well done! Keep practicing!');
    }

    // Skip logging if practice mode
    if (practiceMode) return;

    // Calculate XP based on performance
    const xpAwarded = successfulRounds * 10 + Math.floor(attentionScore / 10);

    try {
      // Log game with attention metrics
      const result = await logGameAndAward({
        type: 'follow-ball',
        correct: successfulRounds,
        total: TOTAL_ROUNDS,
        accuracy: (successfulRounds / TOTAL_ROUNDS) * 100,
        xpAwarded,
        skillTags: ['visual-tracking', 'attention', 'reaction-time'],
        meta: {
          attentionScore,
          avgReactionTimeMs: avgReactionTime,
          tappedWhileMovingCount,
          timedOutCount,
          eyeTrackingEnabled,
          avgGazeScore: Math.round(avgGazeScore),
          gazeSamples: gazeHistory.length,
          roundResults: results.map((r) => ({
            reactionTimeMs: r.reactionTimeMs,
            tappedWhileMoving: r.tappedWhileMoving,
            timedOut: r.timedOut,
          })),
        },
      });
      setLogTimestamp(result?.last?.at ?? null);

      // Update therapy progress if in therapy mode
      if (therapyId && levelNumber && sessionNumber) {
        await advanceTherapyProgress({
          therapy: therapyId,
          levelNumber,
          sessionNumber,
          gameId,
          markCompleted: false, // Don't auto-complete session
        });
      }

      // Tell Home to refetch stats
      router.setParams({ refreshStats: Date.now().toString() });
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  };

  // Show camera consent on mount if eye tracking is available
  useEffect(() => {
    if (Platform.OS === 'web' && isEyeTrackingAvailable()) {
      // Check if user has previously declined
      const hasDeclined = localStorage.getItem('eyeTrackingDeclined') === 'true';
      if (!hasDeclined) {
        setShowCameraConsent(true);
        // Don't start game yet - wait for consent
        return;
      }
    }
    // If no consent needed or already declined, start game
    startRound(1);
  }, []);

  // Cleanup effect
  useEffect(() => {
    // Don't start round immediately - wait for user to tap start overlay
    // startRound(1) will be called after handleStartTap
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);
      clearScheduledSpeech();
    };
  }, []);

  // Map attention score to label + emoji
  const getAttentionLabel = () => {
    if (attentionScore >= 81) return { label: 'Focus Hero', emoji: '🦸' };
    if (attentionScore >= 61) return { label: 'Super Focus', emoji: '🤩' };
    if (attentionScore >= 41) return { label: 'Good Focus', emoji: '😊' };
    if (attentionScore >= 21) return { label: 'Waking Up', emoji: '🙂' };
    return { label: 'Sleepy Eyes', emoji: '😴' };
  };

  const { label, emoji } = getAttentionLabel();

  // Get current ball position for eye tracking
  const currentBallPosition: BallPosition = {
    x: ballPosRef.current.x,
    y: ballPosRef.current.y,
    radius: 4, // 4% of screen (approximate ball size)
  };

  // Handle camera consent
  const handleAcceptCamera = () => {
    setShowCameraConsent(false);
    setEyeTrackingEnabled(true);
    setShowGazeVisualization(true);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('eyeTrackingDeclined');
    }
    // Start game after accepting consent
    startRound(1);
  };

  const handleDeclineCamera = () => {
    setShowCameraConsent(false);
    setEyeTrackingEnabled(false);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('eyeTrackingDeclined', 'true');
    }
    // Start game after declining consent
    startRound(1);
  };

  // Stop all timers/speech/animations before leaving
  const handleBack = () => {
    // Stop all speech immediately and aggressively - call multiple times
    try {
      Speech.stop();
      Speech.stop();
      Speech.stop();
    } catch {}
    
    // Clear all scheduled speech timers
    clearScheduledSpeech();
    
    // Use the utility function that also stops speech multiple times
    stopAllSpeech();
    
    // Stop all timers and animations
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);
    glowOpacity.value = 0;
    ballScale.value = 1;
    setIsPaused(true);
    
    // Navigate back immediately after stopping everything
    onBack();
  };

  // Debug logging
  useEffect(() => {
    console.log('🎮 FollowTheBall: Render state', {
      showCongratulations,
      gameFinished,
      hasFinalStats: !!finalStats,
      round,
    });
  }, [showCongratulations, gameFinished, finalStats, round]);

  // Show completion screen with stats (single screen, no ResultCard)
  if (gameFinished && finalStats) {
    const accuracyPct = Math.round((finalStats.successfulRounds / finalStats.totalRounds) * 100);
    console.log('🎮 FollowTheBall: Rendering Completion Screen with stats');
    return (
      <CongratulationsScreen
        message="Amazing Work!"
        showButtons={true}
        correct={finalStats.successfulRounds}
        total={finalStats.totalRounds}
        accuracy={accuracyPct}
        xpAwarded={finalStats.successfulRounds * 10 + Math.floor(finalStats.finalAttentionScore / 10)}
        onContinue={() => {
          clearScheduledSpeech();
          stopAllSpeech();
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }


  // Show camera consent screen
  if (showCameraConsent) {
    return (
      <SafeAreaView style={styles.container}>
        <CameraConsent
          onAccept={handleAcceptCamera}
          onDecline={handleDeclineCamera}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.backButton}>
        <Text style={styles.backButtonText}>← Back</Text>
      </TouchableOpacity>

      {/* Toggles */}
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleButton, soundOn ? styles.toggleOn : styles.toggleOff]}
          onPress={() => setSoundOn((v) => !v)}
        >
          <Text style={styles.toggleText}>Sound {soundOn ? 'On' : 'Off'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, hapticsOn ? styles.toggleOn : styles.toggleOff]}
          onPress={() => setHapticsOn((v) => !v)}
        >
          <Text style={styles.toggleText}>Haptics {hapticsOn ? 'On' : 'Off'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, practiceMode ? styles.toggleOn : styles.toggleOff]}
          onPress={() => setPracticeMode((v) => !v)}
        >
          <Text style={styles.toggleText}>Practice {practiceMode ? 'On' : 'Off'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleButton, isPaused ? styles.toggleOff : styles.toggleOn]}
          onPress={() => {
            if (!isPaused) {
              setIsPaused(true);
              if (roundTimeoutRef.current) clearTimeout(roundTimeoutRef.current);
              glowOpacity.value = 0;
              ballScale.value = 1;
            } else {
              setIsPaused(false);
              startRound();
            }
          }}
        >
          <Text style={styles.toggleText}>{isPaused ? 'Resume' : 'Pause'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toggleButton, eyeTrackingEnabled ? styles.toggleOn : styles.toggleOff]}
          onPress={() => {
            if (eyeTrackingEnabled) {
              setEyeTrackingEnabled(false);
              setShowGazeVisualization(false);
            } else {
              setShowCameraConsent(true);
            }
          }}
        >
          <Text style={styles.toggleText}>Eye Tracking {eyeTrackingEnabled ? 'On' : 'Off'}</Text>
        </TouchableOpacity>

        {eyeTrackingInitError && (
          <TouchableOpacity
            style={[styles.toggleButton, styles.toggleOff]}
            onPress={() => {
              setEyeTrackingInitError(null);
              setShowCameraConsent(true);
            }}
          >
            <Text style={styles.toggleText}>Retry Eye Tracking</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Eye Tracking Camera (hidden, processing frames) */}
      {eyeTrackingEnabled && Platform.OS === 'web' && (
        <EyeTrackingCamera
          onGazeDetected={handleGazeDetected}
          ballPosition={currentBallPosition}
          enabled={eyeTrackingEnabled && phase === 'moving'}
          showPreview={false}
          processingFps={10}
          onError={(msg) => setEyeTrackingInitError(msg)}
          onReady={() => setEyeTrackingInitError(null)}
        />
      )}

      {/* Gaze Visualization Overlay */}
      {showGazeVisualization && gazeData?.gazePoint && (
        <GazeVisualization
          gazePoint={gazeData.gazePoint}
          visible={eyeTrackingEnabled && phase === 'moving'}
          showTrail={false}
        />
      )}

      {/* Attention Meter */}
      <View style={styles.attentionMeter}>
        <View style={styles.attentionHeader}>
          <View style={styles.attentionTitleContainer}>
            <Text style={styles.attentionTitle}>🔋 FOCUS POWER</Text>
          </View>
          <View style={[styles.attentionBadge, { backgroundColor: getAttentionColor(attentionScore) + '20' }]}>
            <Text style={styles.attentionEmoji}>{emoji}</Text>
            <Text style={[styles.attentionLabel, { color: getAttentionColor(attentionScore) }]}>
              {label}
            </Text>
          </View>
        </View>
        <View style={styles.barContainer}>
          <Animated.View style={[styles.barFill, attentionBarStyle]}>
            <LinearGradient
              colors={getAttentionGradient(attentionScore)}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.barGradient}
            />
          </Animated.View>
        </View>
        <Text style={styles.attentionScoreText}>{Math.round(attentionScore)}/100</Text>
      </View>

      {/* Round Info */}
      <View style={styles.roundInfo}>
        <View style={styles.roundBadge}>
          <Text style={styles.roundText}>
            Round {round} of {TOTAL_ROUNDS}
          </Text>
        </View>
      </View>

      {/* Game Area */}
      <View style={styles.gameArea}>
        <LinearGradient
          colors={['#E0F2FE', '#DBEAFE', '#BFDBFE']}
          style={StyleSheet.absoluteFillObject}
        />
        
        <Animated.View
          style={[
            styles.ball,
            ballAnimatedStyle,
          ]}
        >
          <TouchableOpacity
            onPress={handleBallTap}
            activeOpacity={0.9}
            style={[
              styles.ballButton,
              phase === 'glow' && styles.ballGlow,
            ]}
          >
            <LinearGradient
              colors={phase === 'glow' ? ['#FCD34D', '#FBBF24'] : ['#3B82F6', '#2563EB']}
              style={StyleSheet.absoluteFillObject}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <Animated.View style={[styles.glowOverlay, glowAnimatedStyle]}>
              <LinearGradient
                colors={['#FCD34D', '#F59E0B']}
                style={StyleSheet.absoluteFillObject}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              />
            </Animated.View>
            {phase === 'glow' && (
              <View style={styles.sparkleContainer}>
                <Text style={styles.sparkleEmoji}>✨</Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Phase hint */}
        <View style={styles.hintContainer}>
          <View style={styles.hintBubble}>
            <Text style={styles.hintText}>
              {phase === 'moving'
                ? '👀 Watch the ball with your eyes…'
                : phase === 'glow'
                ? '✨ Now tap the glowing ball!'
                : '🎉 Great watching!'}
            </Text>
          </View>
        </View>

        {/* Feedback Toast */}
        {showFeedback && (
          <View style={styles.toastContainer} pointerEvents="none">
            <ResultToast
              text={
                feedbackToast === 'success'
                  ? 'Great job!'
                  : feedbackToast === 'early'
                  ? 'Wait for it to glow!'
                  : 'Time\'s up!'
              }
              type={feedbackToast === 'success' ? 'ok' : 'bad'}
              show={showFeedback}
            />
          </View>
        )}

        {/* Sparkle animation on success */}
        {phase === 'feedback' && !feedbackToast && (
          <SparkleBurst key={sparkleKey} visible color="#FCD34D" />
        )}

        {/* Start Overlay - shown before first interaction */}
        {showStartOverlay && (
          <TouchableOpacity
            style={styles.startOverlay}
            onPress={handleStartTap}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={['rgba(59, 130, 246, 0.95)', 'rgba(37, 99, 235, 0.95)']}
              style={styles.startOverlayGradient}
            >
              <View style={styles.startOverlayContent}>
                <Text style={styles.startOverlayEmoji}>👆</Text>
                <Text style={styles.startOverlayTitle}>Tap to Start!</Text>
                <Text style={styles.startOverlaySubtitle}>
                  Listen to instructions and play the game
                </Text>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {/* Round Success Animation */}
      <RoundSuccessAnimation
        visible={showRoundSuccess}
        stars={3}
      />
    </SafeAreaView>
  );
};

// Helper functions for attention meter colors
const getAttentionColor = (score: number): string => {
  if (score >= 81) return '#9333EA'; // Focus Hero - purple
  if (score >= 61) return '#F59E0B'; // Super Focus - amber
  if (score >= 41) return '#22C55E'; // Good Focus - green
  if (score >= 21) return '#3B82F6'; // Waking Up - blue
  return '#64748B'; // Sleepy Eyes - gray
};

const getAttentionGradient = (score: number): [string, string] => {
  if (score >= 81) return ['#9333EA', '#A855F7'];
  if (score >= 61) return ['#F59E0B', '#FBBF24'];
  if (score >= 41) return ['#22C55E', '#4ADE80'];
  if (score >= 21) return ['#3B82F6', '#60A5FA'];
  return ['#64748B', '#94A3B8'];
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F9FF',
    padding: 16,
  },
  backButton: {
    position: 'absolute',
    top: 50,
    left: 16,
    zIndex: 10,
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  attentionMeter: {
    marginTop: 60,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    marginBottom: 4,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  toggleOn: {
    backgroundColor: '#ECFDF3',
    borderColor: '#22C55E',
  },
  toggleOff: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  attentionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  attentionTitleContainer: {
    flex: 1,
  },
  attentionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  attentionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  attentionEmoji: {
    fontSize: 18,
  },
  attentionLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  barContainer: {
    width: '100%',
    height: 16,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 8,
  },
  barFill: {
    height: '100%',
    borderRadius: 10,
  },
  barGradient: {
    flex: 1,
    borderRadius: 10,
  },
  attentionScoreText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    textAlign: 'center',
  },
  roundInfo: {
    marginBottom: 16,
    alignItems: 'center',
  },
  roundBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  roundText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
  gameArea: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#BAE6FD',
    position: 'relative',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  ball: {
    position: 'absolute',
    width: 80,
    height: 80,
    transform: [{ translateX: -40 }, { translateY: -40 }],
    zIndex: 10,
  },
  ballButton: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 12,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  ballGlow: {
    shadowColor: '#FCD34D',
    shadowOpacity: 0.8,
  },
  glowOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 40,
  },
  sparkleContainer: {
    position: 'absolute',
    top: -10,
    right: -10,
  },
  sparkleEmoji: {
    fontSize: 24,
  },
  hintContainer: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
  },
  hintBubble: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    borderWidth: 2,
    borderColor: '#E2E8F0',
  },
  hintText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
    textAlign: 'center',
  },
  toastContainer: {
    position: 'absolute',
    top: '20%',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  completionContainer: {
    flex: 1,
    marginTop: 60,
  },
  completionScroll: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  completionContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  completionEmojiContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    borderWidth: 3,
    borderColor: '#DBEAFE',
  },
  completionEmoji: {
    fontSize: 64,
  },
  completionTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  completionSubtitle: {
    fontSize: 18,
    color: '#475569',
    marginBottom: 32,
    textAlign: 'center',
    fontWeight: '600',
  },
  statsContainer: {
    width: '100%',
    maxWidth: 400,
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  statIcon: {
    fontSize: 24,
  },
  statContent: {
    flex: 1,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  savedText: {
    color: '#22C55E',
    fontWeight: '700',
    fontSize: 14,
    marginTop: 16,
  },
  startOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startOverlayGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  startOverlayContent: {
    alignItems: 'center',
    padding: 32,
  },
  startOverlayEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  startOverlayTitle: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 12,
    textAlign: 'center',
  },
  startOverlaySubtitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#E0E7FF',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});

