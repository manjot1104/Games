/**
 * Blow the Bubble Game
 * Child blows to make bubble grow, then it pops
 */

import BlowMeter from '@/components/game/BlowMeter';
import CongratulationsScreen from '@/components/game/CongratulationsScreen';
import RoundSuccessAnimation from '@/components/game/RoundSuccessAnimation';
import { useJawDetection } from '@/hooks/useJawDetection';
import { logGameAndAward } from '@/utils/api';
import { BlowDetector } from '@/utils/blowDetection';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    Platform,
    Pressable,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
    useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

type Props = {
  onBack: () => void;
  onComplete?: () => void;
  requiredRounds?: number;
};

interface RoundResult {
  round: number;
  stars: number;
  maxSize: number; // Percentage of max size reached
  timeElapsed: number;
}

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 30000; // 30 seconds per round
const MAX_BUBBLE_SIZE = 200; // pixels
const MIN_BUBBLE_SIZE = 40; // pixels
const DEFAULT_TTS_RATE = 0.75;

let scheduledSpeechTimers: Array<ReturnType<typeof setTimeout>> = [];

function clearScheduledSpeech() {
  scheduledSpeechTimers.forEach(t => clearTimeout(t));
  scheduledSpeechTimers = [];
  try {
    Speech.stop();
  } catch {}
}

function speak(text: string, rate = DEFAULT_TTS_RATE) {
  try {
    clearScheduledSpeech();
    Speech.speak(text, { rate });
  } catch (e) {
    console.warn('speak error', e);
  }
}

export function BlowTheBubbleGame({ onBack, onComplete, requiredRounds = TOTAL_ROUNDS }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const isMobile = screenWidth < 600;
  const jawDetection = useJawDetection(Platform.OS === 'web' ? true : true);

  const {
    isOpen,
    ratio,
    isDetecting,
    hasCamera,
    error: jawError,
  } = jawDetection;

  // Web-only properties (type assertion needed)
  const protrusion = (jawDetection as any).protrusion as number | undefined;
  const previewContainerId = (jawDetection as any).previewContainerId as string | undefined;

  // Game state
  const [gameState, setGameState] = useState<'calibration' | 'countdown' | 'playing' | 'roundComplete' | 'gameComplete'>('calibration');
  const [currentRound, setCurrentRound] = useState(1);
  const [countdown, setCountdown] = useState(0);
  const [bubbleSize, setBubbleSize] = useState(MIN_BUBBLE_SIZE);
  const [bubblePopped, setBubblePopped] = useState(false);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [totalStars, setTotalStars] = useState(0);
  const [showCongratulations, setShowCongratulations] = useState(false);
  const [showRoundSuccess, setShowRoundSuccess] = useState(false);
  const [gameFinished, setGameFinished] = useState(false);
  const [finalStats, setFinalStats] = useState<{
    totalRounds: number;
    averageSize: number;
    totalStars: number;
    accuracy: number;
  } | null>(null);
  const [logTimestamp, setLogTimestamp] = useState<string | null>(null);
  const [timeElapsed, setTimeElapsed] = useState(0);

  // Refs
  const blowDetector = useRef(new BlowDetector(800, 0.4));
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bubbleSizeAnim = useRef(new Animated.Value(MIN_BUBBLE_SIZE)).current;
  const bubbleOpacity = useRef(new Animated.Value(1)).current;
  const popParticles = useRef<Array<{ id: number; x: number; y: number; vx: number; vy: number; opacity: Animated.Value }>>([]).current;

  // Update blow detection
  useEffect(() => {
    if (gameState !== 'playing' || !isDetecting) return;

    const protrusionValue = (protrusion as number) || 0;
    const blowState = blowDetector.current.update(isOpen || false, protrusionValue, ratio || 0);

    if (blowState.isSustained && !bubblePopped) {
      // Grow bubble based on blow intensity
      const growthRate = blowState.intensity * 2; // pixels per frame
      setBubbleSize(prev => {
        const newSize = Math.min(MAX_BUBBLE_SIZE, prev + growthRate);
        if (newSize >= MAX_BUBBLE_SIZE && !bubblePopped) {
          // Bubble reached max size, pop it
          setTimeout(() => {
            popBubble();
          }, 100);
        }
        return newSize;
      });
    }
  }, [isOpen, protrusion, ratio, isDetecting, gameState, bubblePopped]);

  // Animate bubble size
  useEffect(() => {
    Animated.timing(bubbleSizeAnim, {
      toValue: bubbleSize,
      duration: 150,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [bubbleSize]);

  // Pop bubble function
  const popBubble = useCallback(() => {
    if (bubblePopped) return;
    setBubblePopped(true);

    // Create pop particles
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;
    for (let i = 0; i < 20; i++) {
      const angle = (Math.PI * 2 * i) / 20;
      const speed = 3 + Math.random() * 2;
      popParticles.push({
        id: i,
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        opacity: new Animated.Value(1),
      });
    }

    // Animate bubble pop
    Animated.sequence([
      Animated.timing(bubbleSizeAnim, {
        toValue: bubbleSize * 1.3,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.parallel([
        Animated.timing(bubbleOpacity, {
          toValue: 0,
          duration: 300,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bubbleSizeAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.in(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    ]).start();

    // Animate particles
    popParticles.forEach(particle => {
      Animated.parallel([
        Animated.timing(particle.opacity, {
          toValue: 0,
          duration: 1000,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    });

    speak('Pop! Great job!');
    endRound();
  }, [bubbleSize, bubblePopped, screenWidth, screenHeight]);

  // Start calibration
  const startCalibration = useCallback(() => {
    setGameState('calibration');
    blowDetector.current.reset();
    setBubbleSize(MIN_BUBBLE_SIZE);
    setBubblePopped(false);
    setTimeElapsed(0);
    bubbleSizeAnim.setValue(MIN_BUBBLE_SIZE);
    bubbleOpacity.setValue(1);
    popParticles.length = 0;

    if (currentRound === 1) {
      speak(
        'Welcome to Blow the Bubble! Blow into your device to make the bubble grow. ' +
        'Keep blowing until the bubble pops! Show your face to the camera to start!'
      );
    } else {
      speak(`Round ${currentRound}! Show your face to the camera to start!`);
    }
  }, [currentRound]);

  // Start countdown
  const startCountdown = useCallback(() => {
    setGameState('countdown');
    setCountdown(3);
    speak('Get ready!');

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          startRound();
          return 0;
        }
        speak(prev - 1 === 0 ? 'Go! Blow the bubble!' : String(prev - 1));
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Start round
  const startRound = useCallback(() => {
    setGameState('playing');
    setBubbleSize(MIN_BUBBLE_SIZE);
    setBubblePopped(false);
    setTimeElapsed(0);
    bubbleSizeAnim.setValue(MIN_BUBBLE_SIZE);
    bubbleOpacity.setValue(1);
    popParticles.length = 0;
    blowDetector.current.reset();

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      setTimeElapsed(elapsed);

      // Timeout after 30 seconds
      if (elapsed >= ROUND_TIME_MS / 1000 && !bubblePopped) {
        endRound();
      }
    }, 100);
  }, [bubblePopped]);

  // End round
  const endRound = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const maxSizePercent = (bubbleSize / MAX_BUBBLE_SIZE) * 100;
    let stars = 0;

    if (bubblePopped && timeElapsed < 10) {
      stars = 3;
    } else if (bubblePopped && timeElapsed < 20) {
      stars = 2;
    } else if (maxSizePercent >= 75) {
      stars = 1;
    }

    const result: RoundResult = {
      round: currentRound,
      stars,
      maxSize: maxSizePercent,
      timeElapsed,
    };

    setRoundResults(prev => [...prev, result]);
    setTotalStars(prev => prev + stars);

    // Show success animation instead of TTS
    setShowRoundSuccess(true);
    setGameState('roundComplete');

    // Wait for animation to complete before moving to next round
    setTimeout(() => {
      setShowRoundSuccess(false);
      if (currentRound < requiredRounds) {
        setCurrentRound(prev => prev + 1);
        startCalibration();
      } else {
        finishGame();
      }
    }, 2500);
  }, [currentRound, bubbleSize, bubblePopped, timeElapsed, requiredRounds, startCalibration]);

  // Finish game
  const finishGame = useCallback(async () => {
    setGameState('gameComplete');
    setGameFinished(true);

    const averageSize = roundResults.reduce((sum, r) => sum + r.maxSize, 0) / roundResults.length;
    const accuracy = Math.round(averageSize);

    const stats = {
      totalRounds: requiredRounds,
      averageSize,
      totalStars,
      accuracy,
    };

    setFinalStats(stats);
    setShowCongratulations(true);

    speak(`Amazing! You completed all ${requiredRounds} rounds with ${totalStars} total stars!`);

    try {
      const xpAwarded = totalStars * 50;
      const result = await logGameAndAward({
        type: 'blow-the-bubble',
        correct: totalStars,
        total: requiredRounds * 3,
        accuracy,
        xpAwarded,
        skillTags: ['airflow', 'oral-motor', 'breath-control', 'coordination'],
        meta: {
          totalRounds: requiredRounds,
          averageSize,
          totalStars,
          roundResults,
        },
      });
      setLogTimestamp(result?.last?.at ?? null);
      onComplete?.();
    } catch (e) {
      console.error('Failed to save game:', e);
    }
  }, [roundResults, totalStars, onComplete, requiredRounds]);

  // Check for face detection to start countdown
  useEffect(() => {
    if (gameState === 'calibration' && isDetecting && hasCamera) {
      setTimeout(() => {
        startCountdown();
      }, 1000);
    }
  }, [gameState, isDetecting, hasCamera, startCountdown]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      clearScheduledSpeech();
    };
  }, []);

  // Initialize
  useEffect(() => {
    startCalibration();
  }, [startCalibration]);

  const blowState = blowDetector.current.update(
    isOpen || false,
    (protrusion as number) || 0,
    ratio || 0
  );

  // Show congratulations screen with stats
  if (gameFinished && finalStats) {
    return (
      <CongratulationsScreen
        message="Amazing Blowing!"
        showButtons={true}
        correct={finalStats.totalStars}
        total={requiredRounds * 3}
        accuracy={finalStats.accuracy}
        xpAwarded={finalStats.totalStars * 50}
        onContinue={() => {
          onComplete?.();
        }}
        onHome={onBack}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#87CEEB', '#E0F6FF', '#B0E0E6']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Camera Preview */}
      {Platform.OS === 'web' && previewContainerId && (
        <View
          nativeID={previewContainerId}
          style={StyleSheet.absoluteFillObject}
        />
      )}

      {/* Game Overlay */}
      <View style={styles.overlay}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#FFF" />
          </Pressable>
          <View style={styles.headerInfo}>
            <Text style={styles.roundText}>Round {currentRound} of {requiredRounds}</Text>
            <View style={styles.starsContainer}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name="star"
                  size={20}
                  color={i < Math.floor(totalStars / currentRound) ? '#FFD700' : '#FFF'}
                />
              ))}
            </View>
          </View>
        </View>

        {/* Blow Meter */}
        {gameState === 'playing' && (
          <View style={styles.meterContainer}>
            <BlowMeter intensity={blowState.intensity} isBlowing={blowState.isBlowing} />
          </View>
        )}

        {/* Calibration */}
        {gameState === 'calibration' && (
          <View style={styles.calibrationContainer}>
            <View style={styles.calibrationBox}>
              <Ionicons name="camera" size={48} color="#FFF" />
              <Text style={styles.calibrationText}>
                {isDetecting ? 'Face detected! Starting soon...' : 'Show your face to the camera'}
              </Text>
            </View>
          </View>
        )}

        {/* Countdown */}
        {gameState === 'countdown' && (
          <View style={styles.countdownContainer}>
            <Animated.Text
              style={[
                styles.countdownText,
                {
                  transform: [{ scale: countdown > 0 ? 1.5 : 1 }],
                },
              ]}
            >
              {countdown > 0 ? countdown : 'GO!'}
            </Animated.Text>
          </View>
        )}

        {/* Game */}
        {gameState === 'playing' && (
          <View style={styles.gameContainer}>
            <View style={styles.bubbleContainer}>
              <Animated.View
                style={{
                  opacity: bubbleOpacity,
                  transform: [{ scale: bubbleSizeAnim.interpolate({
                    inputRange: [0, MAX_BUBBLE_SIZE],
                    outputRange: [0, 1],
                  }) }],
                }}
              >
                <Svg width={MAX_BUBBLE_SIZE} height={MAX_BUBBLE_SIZE}>
                  <Defs>
                    <RadialGradient id="bubbleGradient" cx="50%" cy="30%" r="50%">
                      <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
                      <Stop offset="100%" stopColor="#E0F6FF" stopOpacity="0.6" />
                    </RadialGradient>
                  </Defs>
                  <Circle
                    cx={MAX_BUBBLE_SIZE / 2}
                    cy={MAX_BUBBLE_SIZE / 2}
                    r={bubbleSize / 2}
                    fill="url(#bubbleGradient)"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                  />
                </Svg>
              </Animated.View>
            </View>
            <Text style={styles.instructionText}>
              {bubblePopped ? 'Pop!' : 'Blow to make the bubble grow!'}
            </Text>
          </View>
        )}

        {/* Round Success Animation */}
        <RoundSuccessAnimation
          visible={showRoundSuccess}
          stars={roundResults[roundResults.length - 1]?.stars}
        />

        {/* Round Complete - Keep for UI state but animation is shown above */}
        {gameState === 'roundComplete' && !showRoundSuccess && (
          <View style={styles.roundCompleteContainer}>
            <Text style={styles.roundCompleteText}>
              Round {currentRound} Complete!
            </Text>
            <View style={styles.starsDisplay}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name="star"
                  size={40}
                  color={i < roundResults[roundResults.length - 1]?.stars ? '#FFD700' : '#CCC'}
                />
              ))}
            </View>
          </View>
        )}

        {/* Error */}
        {jawError && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{jawError}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    position: 'relative',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    paddingTop: Platform.OS === 'web' ? 16 : 8,
  },
  backButton: {
    padding: 8,
  },
  headerInfo: {
    flex: 1,
    alignItems: 'center',
  },
  roundText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 4,
  },
  meterContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  calibrationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calibrationBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 32,
    borderRadius: 20,
    alignItems: 'center',
  },
  calibrationText: {
    fontSize: 18,
    color: '#FFF',
    marginTop: 16,
    textAlign: 'center',
  },
  countdownContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countdownText: {
    fontSize: 120,
    fontWeight: '900',
    color: '#FFF',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 8,
  },
  gameContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bubbleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructionText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
    marginTop: 32,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  roundCompleteContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roundCompleteText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 24,
  },
  starsDisplay: {
    flexDirection: 'row',
    gap: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 18,
    color: '#FFF',
    textAlign: 'center',
  },
});

